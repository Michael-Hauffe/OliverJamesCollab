/**
 * Outbound proxy pool for direct LinkedIn requests.
 *
 * - Sticky: each LinkedIn session (keyed by a hash of its li_at cookie) keeps one exit IP, because a
 *   logged-in session that hops between IPs is far more likely to hit a verification checkpoint.
 * - Failover: a proxy that errors, rejects its credentials (407) or gets blocked (999/429) is benched
 *   with exponential backoff and the request is retried through the next healthy proxy.
 * - Never silently direct: once proxies are configured, requests only leave through them.
 *
 * Health state is per server instance and in memory only. Proxy credentials are never logged.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { type ProxyCheck, maskProxy, parseProxyList } from "./proxy";

export class ProxyError extends Error {}

const BASE_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const health = new Map<string, { until: number; fails: number; reason: string }>();
const sticky = new Map<string, string>();
const agents = new Map<string, ProxyAgent>();
let cursor = 0;

const benchedUntil = (p: string) => health.get(p)?.until ?? 0;

function agentFor(proxy: string) {
  let a = agents.get(proxy);
  if (!a) {
    a = new ProxyAgent(proxy);
    agents.set(proxy, a);
  }
  return a;
}

function bench(proxy: string, reason: string) {
  const fails = (health.get(proxy)?.fails ?? 0) + 1;
  const ms = Math.min(BASE_COOLDOWN_MS * 2 ** (fails - 1), MAX_COOLDOWN_MS);
  health.set(proxy, { until: Date.now() + ms, fails, reason });
}

/** Server-wide pool from PROXY_URLS (newline- or comma-separated). */
export const serverProxies = () => parseProxyList(process.env["PROXY_URLS"] ?? "").proxies;
export const proxyRequired = () => /^(1|true|yes)$/i.test(process.env["PROXY_REQUIRED"] ?? "");

/** Proxies sent with a request replace the server pool; otherwise the server pool applies. */
export const resolvePool = (requested: string[]) =>
  requested.length ? requested : serverProxies();

/* ---------------- request-supplied proxies must not point into the server's own network ---------------- */
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
}

/**
 * Validates proxies a browser sent. Rejects malformed entries and hosts that resolve to loopback or
 * private ranges (set ALLOW_PRIVATE_PROXIES=true for a proxy on your own network).
 */
export async function vetRequestProxies(raw: string[]): Promise<string[]> {
  const { proxies, invalid } = parseProxyList(raw.join("\n"));
  if (invalid.length)
    throw new ProxyError(
      `${invalid.length} proxy entr${invalid.length === 1 ? "y is" : "ies are"} not valid`,
    );
  if (/^(1|true|yes)$/i.test(process.env["ALLOW_PRIVATE_PROXIES"] ?? "")) return proxies;
  await Promise.all(
    proxies.map(async (p) => {
      const host = new URL(p).hostname.replace(/^\[|\]$/g, "");
      let addrs: string[];
      try {
        addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
      } catch {
        throw new ProxyError(`Proxy host could not be resolved: ${maskProxy(p)}`);
      }
      if (host === "localhost" || addrs.some(isPrivateAddress))
        throw new ProxyError(`Proxy points to a private network address: ${maskProxy(p)}`);
    }),
  );
  return proxies;
}

/* ---------------- egress ---------------- */
export type Egress = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Masked proxy of the last request, or null when requests go direct. */
  via: () => string | null;
};

function pick(pool: string[], key: string | null): string {
  const now = Date.now();
  const healthy = pool.filter((p) => benchedUntil(p) <= now);
  const pinned = key ? sticky.get(key) : undefined;
  if (pinned && healthy.includes(pinned)) return pinned;
  // All benched: use the one that recovers soonest rather than going direct.
  const p = healthy.length
    ? healthy[cursor++ % healthy.length]!
    : [...pool].sort((a, b) => benchedUntil(a) - benchedUntil(b))[0]!;
  if (key) {
    if (sticky.size > 1000) sticky.clear();
    sticky.set(key, p);
  }
  return p;
}

/** undici reports a refused CONNECT as a thrown error ("Proxy response (407) !== 200 when HTTP Tunneling"). */
function connectFailure(e: unknown): string {
  let text = "";
  for (let c: unknown = e, depth = 0; c instanceof Error && depth < 5; c = c.cause, depth++)
    text += ` ${c.message}`;
  const status = text.match(/Proxy response \((\d{3})\)/)?.[1];
  if (status === "407") return "credentials rejected (HTTP 407)";
  return status ? `refused the tunnel (HTTP ${status})` : "connection failed";
}

export function createEgress(pool: string[], stickyKey: string | null): Egress {
  if (!pool.length) {
    if (proxyRequired()) throw new ProxyError("No proxies configured and PROXY_REQUIRED is set");
    return { fetch: (url, init) => fetch(url, init), via: () => null };
  }
  let last: string | null = null;
  return {
    via: () => (last ? maskProxy(last) : null),
    async fetch(url, init) {
      let failure = "";
      const attempts = Math.min(MAX_ATTEMPTS, pool.length);
      for (let i = 0; i < attempts; i++) {
        const proxy = pick(pool, stickyKey);
        last = proxy;
        let res: Response;
        try {
          res = (await undiciFetch(url, {
            ...(init as object),
            dispatcher: agentFor(proxy),
          })) as unknown as Response;
        } catch (e) {
          // The caller's own timeout: give up rather than burning through the pool.
          if (init.signal?.aborted) throw e;
          const reason = connectFailure(e);
          bench(proxy, reason);
          failure = `${maskProxy(proxy)}: ${reason}`;
          continue;
        }
        if (res.status === 407) {
          await res.body?.cancel();
          bench(proxy, "credentials rejected");
          failure = `${maskProxy(proxy)}: credentials rejected (HTTP 407)`;
          continue;
        }
        // The exit IP is blocked; rotate unless this is the last try, which surfaces LinkedIn's answer.
        if ((res.status === 999 || res.status === 429) && i < attempts - 1) {
          await res.body?.cancel();
          bench(proxy, `blocked (HTTP ${res.status})`);
          continue;
        }
        health.delete(proxy);
        return res;
      }
      throw new ProxyError(`All proxies failed${failure ? ` (last: ${failure})` : ""}`);
    },
  };
}

/* ---------------- diagnostics ---------------- */
/** Exit IP (via ipify) and LinkedIn reachability for each proxy; also clears benches for proxies that work. */
export async function checkProxies(pool: string[], timeoutMs: number): Promise<ProxyCheck[]> {
  return Promise.all(
    pool.map(async (proxy): Promise<ProxyCheck> => {
      const base = { proxy: maskProxy(proxy), ip: null, linkedin: null, ms: null };
      const dispatcher = agentFor(proxy);
      const t = performance.now();
      try {
        const ipRes = await undiciFetch("https://api.ipify.org?format=json", {
          dispatcher,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const ip = ((await ipRes.json()) as { ip?: string }).ip ?? null;
        const ms = Math.round(performance.now() - t);
        const li = await undiciFetch("https://www.linkedin.com/robots.txt", {
          dispatcher,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        await li.body?.cancel();
        const blocked = li.status === 999 || li.status === 429;
        if (blocked) bench(proxy, `blocked (HTTP ${li.status})`);
        else health.delete(proxy);
        return {
          ...base,
          ok: !blocked,
          ip,
          linkedin: li.status,
          ms,
          error: blocked ? `LinkedIn blocks this IP (HTTP ${li.status})` : null,
        };
      } catch (e) {
        const timeout =
          e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        const reason = timeout ? "timed out" : connectFailure(e);
        bench(proxy, reason);
        return { ...base, ok: false, error: reason[0]!.toUpperCase() + reason.slice(1) };
      }
    }),
  );
}

/** Test hook: forget health and sticky assignments. */
export function resetProxyState() {
  for (const a of agents.values()) void a.close();
  agents.clear();
  health.clear();
  sticky.clear();
  cursor = 0;
}
