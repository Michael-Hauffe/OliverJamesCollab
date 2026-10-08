// @vitest-environment node
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { maskProxy, normalizeProxy, parseProxyList } from "@/lib/linkedin/proxy";
import {
  ProxyError,
  createEgress,
  resetProxyState,
  vetRequestProxies,
} from "@/lib/linkedin/proxy.server";

const listen = (server: net.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );

/**
 * Minimal CONNECT proxy that tunnels every request to `upstream` (an echo server naming the proxy),
 * so responses reveal which proxy carried them even when undici reuses a tunnel.
 */
function connectProxy(upstream: () => number, auth?: string) {
  const server = http.createServer((_req, res) => res.writeHead(405).end());
  server.on("connect", (req, socket: net.Socket, head) => {
    if (
      auth &&
      req.headers["proxy-authorization"] !== `Basic ${Buffer.from(auth).toString("base64")}`
    ) {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const up = net.connect(upstream(), "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  return server;
}

const echo = (name: string, status = 200) =>
  http.createServer((_req, res) => res.writeHead(status).end(name));

const servers = {
  a: echo("A"),
  b: echo("B"),
  c: echo("C"),
  blockedSite: echo("blocked", 999),
} as const;
const port: Record<string, number> = {};
const proxies = {
  a: connectProxy(() => port["a"]!),
  b: connectProxy(() => port["b"]!),
  authed: connectProxy(() => port["c"]!, "u:p"),
  blocked: connectProxy(() => port["blockedSite"]!),
};

beforeAll(async () => {
  for (const [k, s] of Object.entries(servers)) port[k] = await listen(s);
  for (const [k, s] of Object.entries(proxies)) port[`proxy_${k}`] = await listen(s);
  const gone = net.createServer();
  port["dead"] = await listen(gone);
  await new Promise((r) => gone.close(r)); // nothing listens here any more
});

afterAll(() => {
  for (const s of [...Object.values(servers), ...Object.values(proxies)]) s.close();
});

afterEach(() => {
  resetProxyState();
  vi.unstubAllEnvs();
});

const proxy = (name: string, creds = "") =>
  `http://${creds}127.0.0.1:${port[name === "dead" ? "dead" : `proxy_${name}`]}`;
const get = (e: ReturnType<typeof createEgress>) =>
  e.fetch(`http://127.0.0.1:${port["a"]}/`, { signal: AbortSignal.timeout(5000) });
const via = async (e: ReturnType<typeof createEgress>) => (await get(e)).text();

describe("proxy list parsing", () => {
  it("normalizes the supported formats", () => {
    expect(normalizeProxy("http://user:pass@1.2.3.4:8080/")).toBe("http://user:pass@1.2.3.4:8080");
    expect(normalizeProxy("1.2.3.4:8080")).toBe("http://1.2.3.4:8080");
    expect(normalizeProxy("proxy.io:8000:user:p@ss")).toBe("http://user:p%40ss@proxy.io:8000");
    expect(normalizeProxy("user:pass@proxy.io:8000")).toBe("http://user:pass@proxy.io:8000");
  });

  it("rejects unsupported or incomplete entries", () => {
    for (const bad of ["socks5://1.2.3.4:1080", "1.2.3.4", "http://host:80/path", "nonsense"])
      expect(normalizeProxy(bad)).toBeNull();
  });

  it("splits lines, skips comments, dedupes and reports invalid entries", () => {
    expect(parseProxyList("# pool\n1.2.3.4:80\n\n1.2.3.4:80, bad\nhttps://h:443")).toEqual({
      proxies: ["http://1.2.3.4:80", "https://h:443"],
      invalid: ["bad"],
    });
  });

  it("masks credentials", () => {
    expect(maskProxy("http://user:secret@proxy.io:8000")).toBe("http://proxy.io:8000");
  });
});

describe("createEgress", () => {
  it("goes direct when no proxies are configured", async () => {
    const e = createEgress([], null);
    expect(await via(e)).toBe("A");
    expect(e.via()).toBeNull();
  });

  it("refuses to go direct when PROXY_REQUIRED is set", () => {
    vi.stubEnv("PROXY_REQUIRED", "true");
    expect(() => createEgress([], null)).toThrow(ProxyError);
  });

  it("tunnels requests through the proxy, sending credentials", async () => {
    const e = createEgress([proxy("authed", "u:p@")], null);
    expect(await via(e)).toBe("C");
    expect(e.via()).toBe(`http://127.0.0.1:${port["proxy_authed"]}`);
  });

  it("fails over from a dead proxy and benches it", async () => {
    const pool = [proxy("dead"), proxy("b")];
    expect(await via(createEgress(pool, null))).toBe("B");
    // Still benched, so later requests skip it.
    for (let i = 0; i < 3; i++) expect(await via(createEgress(pool, null))).toBe("B");
  });

  it("reports rejected credentials (407) and fails over", async () => {
    await expect(get(createEgress([proxy("authed", "u:wrong@")], null))).rejects.toThrow(
      /credentials rejected \(HTTP 407\)/,
    );
    resetProxyState();
    expect(await via(createEgress([proxy("authed", "u:wrong@"), proxy("b")], null))).toBe("B");
  });

  it("rotates away from an exit IP that LinkedIn blocks (999)", async () => {
    expect(await via(createEgress([proxy("blocked"), proxy("b")], null))).toBe("B");
  });

  it("returns LinkedIn's answer when the only proxy is blocked", async () => {
    expect((await get(createEgress([proxy("blocked")], null))).status).toBe(999);
  });

  it("keeps a session on one proxy and spreads new sessions across the pool", async () => {
    const pool = [proxy("a"), proxy("b")];
    const first = await via(createEgress(pool, "session-1"));
    for (let i = 0; i < 3; i++) expect(await via(createEgress(pool, "session-1"))).toBe(first);
    expect(await via(createEgress(pool, "session-2"))).not.toBe(first);
  });

  it("moves a session to another proxy when its pinned one dies", async () => {
    const pool = [proxy("a"), proxy("b")];
    expect(await via(createEgress(pool, "s"))).toBe("A");
    proxies.a.close();
    expect(await via(createEgress(pool, "s"))).toBe("B");
    expect(await via(createEgress(pool, "s"))).toBe("B");
  });
});

describe("vetRequestProxies", () => {
  it("rejects proxies on private networks unless allowed", async () => {
    await expect(vetRequestProxies(["127.0.0.1:8080"])).rejects.toThrow(/private network/);
    await expect(vetRequestProxies(["10.0.0.5:3128"])).rejects.toThrow(/private network/);
    await expect(vetRequestProxies(["localhost:3128"])).rejects.toThrow(/private network/);
    vi.stubEnv("ALLOW_PRIVATE_PROXIES", "true");
    await expect(vetRequestProxies(["127.0.0.1:8080"])).resolves.toEqual(["http://127.0.0.1:8080"]);
  });

  it("rejects malformed entries", async () => {
    await expect(vetRequestProxies(["socks5://1.2.3.4:1080"])).rejects.toThrow(/not valid/);
  });

  it("accepts public addresses", async () => {
    await expect(vetRequestProxies(["8.8.8.8:3128"])).resolves.toEqual(["http://8.8.8.8:3128"]);
  });
});
