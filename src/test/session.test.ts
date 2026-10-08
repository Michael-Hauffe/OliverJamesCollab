// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCookieHeader, scrape, testSession } from "@/lib/linkedin/scraper.server";

const COOKIE = 'bcookie="v=2&abc"; li_at=AQEDtoken; JSESSIONID="ajax:123"; lidc="b=1"';
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

const PROFILE = {
  data: {},
  included: [
    {
      $type: "com.linkedin.voyager.dash.identity.profile.Profile",
      entityUrn: "urn:li:fsd_profile:1",
      firstName: "Jane",
      lastName: "Doe",
      publicIdentifier: "jane-doe",
    },
  ],
};

type Reply = { status: number; body?: unknown; cookies?: string[]; location?: string };
const reply = ({ status, body = {}, cookies = [], location }: Reply) => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of cookies) headers.append("set-cookie", c);
  if (location) headers.set("location", location);
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
};

/** Route LinkedIn calls by endpoint; records each request's headers. */
function linkedin(routes: { full?: Reply; top?: Reply; me?: Reply; contact?: Reply }) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    if (url.includes("FullProfileWithEntities"))
      return reply(routes.full ?? { status: 200, body: PROFILE });
    if (url.includes("WebTopCardCore")) return reply(routes.top ?? { status: 200, body: PROFILE });
    if (url.endsWith("/me")) return reply(routes.me ?? { status: 200, body: { data: {} } });
    if (url.includes("profileContactInfo")) return reply(routes.contact ?? { status: 403 });
    return reply({ status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const run = () =>
  scrape({
    url: "linkedin.com/in/jane-doe",
    cookie: COOKIE,
    timeoutMs: 5000,
    useCache: false,
    proxies: [],
    userAgent: UA,
  });

afterEach(() => vi.unstubAllGlobals());

describe("cookie-session requests", () => {
  it("sends the browser's user agent and every pasted cookie, with JSESSIONID quoted", async () => {
    const calls = linkedin({});
    const p = await run();
    expect(p.data.name.full).toBe("Jane Doe");
    const h = calls[0]!.headers;
    expect(h["user-agent"]).toBe(UA);
    expect(h["csrf-token"]).toBe("ajax:123");
    expect(h["cookie"]).toBe(
      'bcookie="v=2&abc"; li_at=AQEDtoken; JSESSIONID="ajax:123"; lidc="b=1"',
    );
  });

  it("quotes an unquoted JSESSIONID like a browser would", async () => {
    const calls = linkedin({});
    await scrape({
      url: "jane-doe",
      cookie: "li_at=x; JSESSIONID=ajax:9",
      timeoutMs: 5000,
      useCache: false,
      proxies: [],
    });
    expect(calls[0]!.headers["cookie"]).toBe('li_at=x; JSESSIONID="ajax:9"');
    expect(calls[0]!.headers["csrf-token"]).toBe("ajax:9");
  });

  it("carries cookie updates from LinkedIn into later requests", async () => {
    const calls = linkedin({
      full: { status: 200, body: PROFILE, cookies: ['lidc="b=2"; Path=/'] },
    });
    await run();
    expect(calls[1]!.headers["cookie"]).toContain('lidc="b=2"');
  });

  it("falls back to the top-card endpoint when the full profile is refused", async () => {
    linkedin({ full: { status: 403 } });
    const p = await run();
    expect(p.data.name.full).toBe("Jane Doe");
    expect(p.meta.warnings).toContain("top_card_fallback");
  });

  it("does not call a working session expired when only the profile request is refused", async () => {
    linkedin({
      full: { status: 403 },
      top: { status: 403 },
      me: { status: 200, body: { data: {} } },
    });
    await expect(run()).rejects.toMatchObject({
      code: "linkedin_upstream_error",
      message: expect.stringMatching(/session is valid/),
    });
  });

  it("reports an expired session only when LinkedIn rejects the session itself", async () => {
    linkedin({ full: { status: 403 }, top: { status: 403 }, me: { status: 401 } });
    await expect(run()).rejects.toMatchObject({
      code: "linkedin_session_expired",
      message: expect.stringMatching(/HTTP 401/),
    });
  });

  it("explains when LinkedIn logs the session out", async () => {
    linkedin({
      full: {
        status: 302,
        location: "https://www.linkedin.com/login",
        cookies: ["li_at=delete me; Max-Age=0; Path=/"],
      },
    });
    await expect(run()).rejects.toMatchObject({
      code: "linkedin_session_expired",
      message: expect.stringMatching(/logged this session out/),
    });
  });

  it("reports a CSRF mismatch as a cookie problem, not an expired session", async () => {
    linkedin({ full: { status: 403, body: "CSRF check failed." } });
    await expect(run()).rejects.toMatchObject({
      code: "invalid_cookie",
      message: expect.stringMatching(/CSRF/),
    });
  });

  it("still reports verification challenges", async () => {
    linkedin({
      full: { status: 302, location: "https://www.linkedin.com/checkpoint/challenge/x" },
    });
    await expect(run()).rejects.toMatchObject({ code: "linkedin_challenge" });
  });
});

describe("testSession", () => {
  it("passes for a working session", async () => {
    linkedin({});
    await expect(testSession(COOKIE, 5000, [], UA)).resolves.toEqual({ ok: true });
  });

  it("explains a logged-out session", async () => {
    linkedin({
      me: { status: 302, cookies: ["li_at=delete me; Expires=Thu, 01 Jan 1970 00:00:00 GMT"] },
    });
    await expect(testSession(COOKIE, 5000, [])).rejects.toMatchObject({
      message: expect.stringMatching(/logged this session out/),
    });
  });
});

describe("parseCookieHeader", () => {
  it("accepts a copied header line including the cookie: prefix", () => {
    expect(parseCookieHeader('cookie: li_at=a; JSESSIONID="ajax:1"')).toEqual({
      li_at: "a",
      JSESSIONID: '"ajax:1"',
    });
  });
});
