/** Client-safe: parse and display proxy lists. Only HTTP(S) proxies are supported. */

/**
 * Accepts `http(s)://[user:pass@]host:port`, `[user:pass@]host:port` or `host:port:user:pass`.
 * Returns a normalized `http(s)://…` URL, or null when the line isn't a usable proxy.
 */
export function normalizeProxy(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // host:port:user:pass (the password may contain ":" or "@")
  const colon = !s.includes("://") && s.match(/^([^:@/\s]+):(\d+):([^:]+):(.+)$/);
  const candidate = colon
    ? `http://${encodeURIComponent(colon[3]!)}:${encodeURIComponent(colon[4]!)}@${colon[1]}:${colon[2]}`
    : s.includes("://")
      ? s
      : `http://${s}`;
  // An explicit port is required (URL parsing would silently drop a default one like :80).
  if (!/:\d{1,5}\/?$/.test(candidate)) return null;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || u.pathname.replace(/\/+$/, "") || u.search || u.hash) return null;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return `${u.protocol}//${u.username ? `${u.username}:${u.password}@` : ""}${u.hostname}:${port}`;
}

/** One proxy per line (commas also work); blank lines and `#` comments are ignored; duplicates dropped. */
export function parseProxyList(text: string): { proxies: string[]; invalid: string[] } {
  const proxies: string[] = [];
  const invalid: string[] = [];
  for (const line of text.split(/[\n,]/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const p = normalizeProxy(s);
    if (!p) invalid.push(s);
    else if (!proxies.includes(p)) proxies.push(p);
  }
  return { proxies, invalid };
}

/** Proxy URL without credentials, safe to show or log. */
export function maskProxy(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "invalid proxy";
  }
}

/** Result of testing one proxy from Settings. */
export type ProxyCheck = {
  proxy: string;
  ok: boolean;
  ip: string | null;
  /** HTTP status LinkedIn answered through this proxy (999/429 means the IP is blocked). */
  linkedin: number | null;
  ms: number | null;
  error: string | null;
};
