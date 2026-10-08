/**
 * TypeScript port of Shreyaan/linkedin-profile-api (app/linkedin/*, app/url_validation.py).
 * Stateless: the cookie header arrives per request, lives only in memory for that
 * call, and is never logged, cached by value, or included in error messages.
 */
import { profileSlug, profileUrl } from "./links";
import type { ProviderId } from "./providers";
import type { ProfileData, ProfilePayload, ScrapeErrorCode, YM } from "./types";

// Voyager, JSON-LD and search responses are untyped; the public shape is enforced by ProfilePayload.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = any;

/* ---------------- endpoints ---------------- */
const VOYAGER = "https://www.linkedin.com/voyager/api";
const DASH_PROFILES = `${VOYAGER}/identity/dash/profiles`;
const SKILLS_URL = `${VOYAGER}/identity/dash/profileSkills`;
const FULL_PROFILE_DECORATION =
  "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93";
const TOP_CARD_DECORATION = "com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-16";
const SECTION_PAGE_SIZE = 20;
const SECTION_MAX_PAGES = 5;

/* ---------------- errors (static, non-leaking messages) ---------------- */
export class ScrapeError extends Error {
  constructor(
    public code: ScrapeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/* ---------------- cookies ---------------- */
const MAX_COOKIE_HEADER_BYTES = 16 * 1024;
const ATTRIBUTE_RECORDS = new Set([
  "httponly",
  "secure",
  "samesite",
  "partitioned",
  "priority",
  "path",
  "domain",
  "max-age",
  "expires",
]);

export function parseCookieHeader(raw: string | undefined | null): Record<string, string> {
  const bad = (m: string) => new ScrapeError("invalid_cookie", m);
  if (!raw || !raw.trim())
    throw new ScrapeError("missing_cookie", "No LinkedIn session configured");
  if (new TextEncoder().encode(raw).length > MAX_COOKIE_HEADER_BYTES)
    throw bad("Cookie header exceeds 16 KiB");
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127) throw bad("Control characters are not allowed in the cookie header");
  }
  const jar: Record<string, string> = {};
  for (let part of raw.split(";")) {
    part = part.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      if (ATTRIBUTE_RECORDS.has(part.toLowerCase()))
        throw bad("Cookie attributes are not allowed; paste name=value pairs only");
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !/^[A-Za-z0-9_.%-]+$/.test(name)) continue;
    if (ATTRIBUTE_RECORDS.has(name.toLowerCase()))
      throw bad("Cookie attributes are not allowed; paste name=value pairs only");
    // eslint-disable-next-line no-control-regex -- Latin-1 range check, not a control-character match
    if (/[^\x00-\xff]/.test(value))
      throw bad(`Cookie value for '${name}' contains invalid characters`);
    jar[name] = value;
  }
  for (const req of ["li_at", "JSESSIONID"]) {
    if (!jar[req]) throw bad(`Required cookie '${req}' is missing or empty`);
  }
  return jar;
}

/* ---------------- URL validation (SSRF-safe; input URL is never fetched) ---------------- */
const validSlug = (v: string) => v.length >= 3 && v.length <= 100 && /^[A-Za-z0-9_-]+$/.test(v);
const validHost = (h: string) =>
  h === "linkedin.com" || h === "www.linkedin.com" || /^[a-z]{2,5}\.linkedin\.com$/.test(h);

export function extractSlug(input: string): string {
  const bad = (m: string) => new ScrapeError("invalid_url", m);
  let raw = (input || "").trim();
  if (!raw) throw bad("Enter a LinkedIn profile URL");
  if (!raw.includes("://") && raw.includes("/") && !raw.startsWith("/")) raw = "https://" + raw;
  if (!raw.includes("://")) {
    if (validSlug(raw)) return raw;
    throw bad("Not a LinkedIn profile URL or username");
  }
  if (raw.length > 2048) throw bad("URL too long");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad("Malformed URL");
  }
  if (u.protocol !== "https:") throw bad("Only https URLs are allowed");
  if (u.username || u.password || u.port) throw bad("Credentials or custom ports are not allowed");
  if (!validHost(u.hostname)) throw bad("Host must be linkedin.com");
  let path: string;
  try {
    path = decodeURIComponent(u.pathname || "");
  } catch {
    throw bad("Malformed URL");
  }
  if (path.includes("\\") || path.includes("..")) throw bad("Invalid path");
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || parts[0] !== "in" || !validSlug(parts[1] ?? ""))
    throw bad("URL must look like linkedin.com/in/username");
  return parts[1]!;
}

/* ---------------- entity resolution ---------------- */
function entityIndex(doc: Obj): Record<string, Obj> {
  const out: Record<string, Obj> = {};
  for (const o of doc.included ?? [])
    if (o && typeof o === "object" && "entityUrn" in o) out[o.entityUrn] = o;
  return out;
}

function resolve(value: any, ents: Record<string, Obj>, visiting: Set<string>): any {
  if (typeof value === "string" && value.startsWith("urn:") && value in ents) {
    if (visiting.has(value)) return { entityUrn: value };
    return resolve(ents[value], ents, new Set([...visiting, value]));
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, ents, visiting));
  if (value && typeof value === "object") {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "entityUrn") out[k] = v;
      else if (k.startsWith("*")) out[k.slice(1)] = resolve(v, ents, visiting);
      else out[k] = resolve(v, ents, visiting);
    }
    return out;
  }
  return value;
}

function resolveIncluded(doc: Obj): Obj[] {
  const ents = entityIndex(doc);
  return (doc.included ?? [])
    .filter((o: any) => o && typeof o === "object" && "entityUrn" in o)
    .map((o: Obj) => resolve(o, ents, new Set([o.entityUrn])));
}

function resolveElements(doc: Obj): Obj[] {
  const ents = entityIndex(doc);
  const data = doc.data ?? {};
  const els = data.elements ?? data["*elements"] ?? [];
  const out: Obj[] = [];
  for (const urn of els) {
    const e = typeof urn === "string" ? ents[urn] : undefined;
    if (e) out.push(resolve(e, ents, new Set([urn])));
  }
  return out;
}

/* ---------------- section parsers ---------------- */
const T = {
  PROFILE: "identity.profile.Profile",
  POSITION: "profile.Position",
  POSITION_GROUP: "profile.PositionGroup",
  EDUCATION: "profile.Education",
  SKILL: "profile.Skill",
  CERTIFICATION: "profile.Certification",
  LANGUAGE: "profile.Language",
  COMPANY: "organization.Company",
  SCHOOL: "organization.School",
  EMPLOYMENT_TYPE: "profile.EmploymentType",
};

const byType = (ents: Obj[], ...suf: string[]) =>
  ents.filter((e) => suf.some((s) => String(e.$type ?? "").endsWith(s)));

const orgLookup = (ents: Obj[]) =>
  Object.fromEntries(byType(ents, T.COMPANY, T.SCHOOL).map((e) => [e.entityUrn, e])) as Record<
    string,
    Obj
  >;

function first(...vals: any[]) {
  for (const v of vals) {
    if (v == null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    return v;
  }
  return null;
}

const date = (p: any) =>
  p && typeof p === "object" && p.year != null ? { year: p.year, month: p.month ?? null } : null;
const dateRange = (dr: any) =>
  dr && typeof dr === "object" ? [date(dr.start), date(dr.end)] : [null, null];
const org = (v: any, orgs: Record<string, Obj>): Obj =>
  v && typeof v === "object" ? v : typeof v === "string" ? (orgs[v] ?? {}) : {};

function vectorImage(ref: any) {
  if (!ref || typeof ref !== "object") return null;
  const vec = ref.vectorImage ?? {};
  const root = vec.rootUrl;
  const arts = (vec.artifacts ?? []).filter((a: any) => a && typeof a === "object");
  if (!root || !arts.length) return null;
  const best = arts.reduce((a: Obj, b: Obj) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
  if (!best.fileIdentifyingUrlPathSegment) return null;
  return {
    url: root + best.fileIdentifyingUrlPathSegment,
    width: best.width ?? null,
    height: best.height ?? null,
  };
}

function core(p: Obj) {
  const f = (p.firstName ?? "").trim();
  const l = (p.lastName ?? "").trim();
  return {
    public_identifier: p.publicIdentifier ?? null,
    profile_url: `https://www.linkedin.com/in/${p.publicIdentifier ?? ""}/`,
    name: {
      first: p.firstName ?? null,
      last: p.lastName ?? null,
      full: [f, l].filter(Boolean).join(" "),
    },
    headline: p.headline ?? null,
    location: first(p.locationName, typeof p.address === "string" ? p.address : null),
    about: p.summary ?? null,
    profile_image: vectorImage((p.profilePicture ?? {}).displayImageReference),
    background_image: vectorImage(p.backgroundPicture),
  };
}

function experience(ents: Obj[]) {
  const orgs = orgLookup(ents);
  const empTypes: Record<string, string> = {};
  for (const e of byType(ents, T.EMPLOYMENT_TYPE)) if (e.entityUrn) empTypes[e.entityUrn] = e.name;
  let positions = byType(ents, T.POSITION);
  if (!positions.length) {
    positions = byType(ents, T.POSITION_GROUP).flatMap((g) => {
      let h = g.profilePositionInPositionGroup ?? g.positions ?? [];
      if (h && !Array.isArray(h)) h = h.elements ?? [];
      return (h as any[]).filter((x) => x && typeof x === "object");
    });
  }
  return positions.map((p) => {
    const [start, end] = dateRange(p.dateRange);
    const c = org(p.companyUrn, orgs);
    const et = p.employmentTypeUrn;
    return {
      title: p.title ?? null,
      company: { name: first(p.companyName, c.name), linkedin_url: c.url ?? null },
      employment_type:
        et && typeof et === "object"
          ? (et.name ?? null)
          : typeof et === "string"
            ? (empTypes[et] ?? null)
            : null,
      location: first(p.locationName, p.geoLocationName),
      start_date: start,
      end_date: end,
      is_current: start != null && end == null,
      description: p.description ?? null,
    };
  });
}

function education(ents: Obj[], orgs: Record<string, Obj>) {
  return byType(ents, T.EDUCATION).map((e) => {
    const s = org(e.schoolUrn, orgs);
    const [start, end] = dateRange(e.dateRange);
    return {
      school: first(e.schoolName, s.name),
      degree: e.degreeName ?? null,
      field_of_study: first(e.fieldOfStudy, e.fieldOfStudyUrn),
      start_date: start,
      end_date: end,
      description: e.description ?? null,
      grade: e.grade ?? null,
    };
  });
}

const skills = (ents: Obj[]) =>
  byType(ents, T.SKILL)
    .filter((s) => s.name)
    .map((s) => ({ name: s.name as string, endorsement_count: null }));

function certifications(ents: Obj[], orgs: Record<string, Obj>) {
  return byType(ents, T.CERTIFICATION).map((c) => {
    const i = org(c.companyUrn, orgs);
    const [issued, expires] = dateRange(c.dateRange);
    return {
      name: c.name ?? null,
      issuer: first(c.authority, i.name),
      issued_at: issued,
      expires_at: expires,
      credential_id: c.licenseNumber ?? null,
      credential_url: c.url ?? null,
    };
  });
}

const languages = (ents: Obj[]) =>
  byType(ents, T.LANGUAGE)
    .filter((l) => l.name)
    .map((l) => ({ name: l.name as string, proficiency: l.proficiency ?? null }));

export function normalize(doc: Obj): { payload: ProfilePayload; profileUrn: string | null } | null {
  const ents = resolveIncluded(doc);
  const profiles = byType(ents, T.PROFILE);
  if (!profiles.length) return null;
  const profile = profiles[0]!;
  const orgs = orgLookup(ents);
  const built = {
    experience: experience(ents),
    education: education(ents, orgs),
    skills: skills(ents),
    certifications: certifications(ents, orgs),
    languages: languages(ents),
  };
  const fallback = doc._lpa_top_card_fallback === true;
  const names = Object.keys(built);
  return {
    profileUrn: profile.entityUrn ?? null,
    payload: {
      data: { ...core(profile), ...built } as ProfileData,
      meta: {
        source: "linkedin_voyager_dash",
        completeness: fallback ? 1 / (names.length + 1) : 1,
        successful_sections: fallback ? ["core"] : ["core", ...names],
        failed_sections: fallback ? names : [],
        warnings: fallback ? ["top_card_fallback"] : [],
        cached: false,
        fetched_at: new Date().toISOString(),
      },
    },
  };
}

/* ---------------- transport ---------------- */
const BASE_HEADERS: Record<string, string> = {
  accept: "application/vnd.linkedin.normalized+json+2.1",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://www.linkedin.com/feed/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "x-li-lang": "en_US",
  "x-restli-protocol-version": "2.0.0",
};

/* ---------------- scraping-API relay (public-page mode only) ---------------- */
export type Relay = { id: ProviderId; key: string };
type Tx = { timeoutMs: number };

async function requestJson(
  url: string,
  params: Record<string, string>,
  jar: Record<string, string>,
  tx: Tx,
) {
  const qs = new URLSearchParams(params).toString();
  const headers = {
    ...BASE_HEADERS,
    cookie: Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
    "csrf-token": jar["JSESSIONID"]!.replace(/^"|"$/g, ""),
  };
  let res: Response;
  try {
    res = await fetch(`${url}?${qs}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(tx.timeoutMs),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError")
      throw new ScrapeError("linkedin_timeout", "LinkedIn did not respond in time");
    throw new ScrapeError("linkedin_upstream_error", "Network error while contacting LinkedIn");
  }
  const s = res.status;
  if (s === 999)
    throw new ScrapeError(
      "linkedin_rate_limited",
      "LinkedIn is blocking or rate-limiting this session",
    );
  if (s === 404)
    throw new ScrapeError("profile_not_found", "Profile not found or not visible to this session");
  if (s === 401 || s === 403)
    throw new ScrapeError(
      "linkedin_session_expired",
      "Session rejected; cookies invalid or expired",
    );
  if (s === 429)
    throw new ScrapeError("linkedin_rate_limited", "Rate limited by LinkedIn; try again later");
  if (s >= 300 && s < 400) {
    if ((res.headers.get("location") ?? "").includes("/checkpoint"))
      throw new ScrapeError(
        "linkedin_challenge",
        "LinkedIn requires interactive verification for this account",
      );
    throw new ScrapeError(
      "linkedin_session_expired",
      "LinkedIn redirected the request; session expired",
    );
  }
  if (s >= 400) {
    const head = (await res.text()).slice(0, 2000).toLowerCase();
    if (head.includes("challenge") || head.includes("checkpoint"))
      throw new ScrapeError(
        "linkedin_challenge",
        "LinkedIn requires interactive verification for this account",
      );
    throw new ScrapeError("linkedin_upstream_error", `LinkedIn returned HTTP ${s}`);
  }
  let doc: any;
  try {
    doc = await res.json();
  } catch {
    throw new ScrapeError("linkedin_schema_changed", "LinkedIn response was not JSON");
  }
  if (!doc || typeof doc !== "object" || !("included" in doc))
    throw new ScrapeError("linkedin_schema_changed", "Unexpected response shape from LinkedIn");
  return doc as Obj;
}

const hasProfile = (doc: Obj) =>
  (doc.included ?? []).some((o: any) => String(o?.$type ?? "").endsWith(T.PROFILE));

async function fetchFullProfile(slug: string, jar: Record<string, string>, tx: Tx) {
  const params = {
    q: "memberIdentity",
    memberIdentity: slug,
    decorationId: FULL_PROFILE_DECORATION,
  };
  let doc = await requestJson(DASH_PROFILES, params, jar, tx);
  if (hasProfile(doc)) return doc;
  doc = await requestJson(DASH_PROFILES, { ...params, decorationId: TOP_CARD_DECORATION }, jar, tx);
  if (!hasProfile(doc))
    throw new ScrapeError("linkedin_schema_changed", "LinkedIn response contained no profile");
  doc._lpa_top_card_fallback = true;
  return doc;
}

async function enrichSkills(
  p: ProfilePayload,
  urn: string | null,
  jar: Record<string, string>,
  tx: Tx,
) {
  if (!urn || p.data.skills.length < SECTION_PAGE_SIZE) return;
  const seen = new Set(p.data.skills.map((s) => s.name));
  let truncated = true;
  for (
    let start = SECTION_PAGE_SIZE;
    start < SECTION_PAGE_SIZE * SECTION_MAX_PAGES;
    start += SECTION_PAGE_SIZE
  ) {
    const page = await requestJson(
      SKILLS_URL,
      { q: "viewee", profileUrn: urn, start: String(start), count: String(SECTION_PAGE_SIZE) },
      jar,
      tx,
    );
    const fresh = skills(resolveElements(page)).filter((s) => !seen.has(s.name));
    fresh.forEach((s) => seen.add(s.name));
    p.data.skills.push(...fresh);
    if (fresh.length < SECTION_PAGE_SIZE) {
      truncated = false;
      break;
    }
  }
  if (truncated) p.meta.warnings.push("section_truncated:skills");
}

/* ---------------- small per-instance cache (keyed by hashes, never raw cookies) ---------------- */
const cache = new Map<string, { at: number; payload: ProfilePayload }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function sha16(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function scrape(opts: {
  url: string;
  cookie: string;
  timeoutMs: number;
  useCache: boolean;
}) {
  const tx: Tx = { timeoutMs: opts.timeoutMs };
  const slug = extractSlug(opts.url);
  const jar = parseCookieHeader(opts.cookie);
  const key = `${await sha16(slug.toLowerCase())}:${await sha16(jar["li_at"]!)}`;
  if (opts.useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      const copy: ProfilePayload = structuredClone(hit.payload);
      copy.meta.cached = true;
      return copy;
    }
  }
  const doc = await fetchFullProfile(slug, jar, tx);
  const n = normalize(doc);
  if (!n)
    throw new ScrapeError("linkedin_schema_changed", "LinkedIn response contained no profile");
  await enrichSkills(n.payload, n.profileUrn, jar, tx);
  // Logged-in only: contact info (email, phone, websites, X, address, birthday) the member shares with you.
  try {
    const ci = await requestJson(
      `${VOYAGER}/identity/profiles/${encodeURIComponent(slug)}/profileContactInfo`,
      {},
      jar,
      tx,
    );
    const c = (ci.data ??
      (ci.included ?? []).find((o: any) => String(o?.$type ?? "").includes("ContactInfo")) ??
      {}) as Obj;
    const emails = [c.emailAddress].filter(Boolean);
    const phones = (c.phoneNumbers ?? []).map((p: any) => p?.number).filter(Boolean);
    const websites = (c.websites ?? []).map((w: any) => w?.url).filter(Boolean);
    const socials: Record<string, string> = {};
    for (const t of c.twitterHandles ?? []) if (t?.name) socials["x"] = `https://x.com/${t.name}`;
    for (const im of c.ims ?? [])
      if (im?.provider && im?.id) socials[String(im.provider).toLowerCase()] = im.id;
    n.payload.data.contact = { emails, phones, websites, socials };
    const extra = n.payload.data as any;
    if (c.address) extra.address = c.address;
    if (c.birthDateOn)
      extra.birthday = [c.birthDateOn.month, c.birthDateOn.day].filter(Boolean).join("/");
    if (c.connectedAt) extra.connected_since = new Date(c.connectedAt).toISOString().slice(0, 10);
  } catch {
    n.payload.meta.warnings.push("contact_info_unavailable");
  }
  n.payload.meta.source = "session";
  if (opts.useCache) {
    if (cache.size > 200) cache.clear();
    cache.set(key, { at: Date.now(), payload: structuredClone(n.payload) });
  }
  return n.payload;
}

/** Lightweight session check: the logged-in member's own profile. */
export async function testSession(cookie: string, timeoutMs: number) {
  const jar = parseCookieHeader(cookie);
  let res: Response;
  try {
    res = await fetch(`${VOYAGER}/me`, {
      headers: {
        ...BASE_HEADERS,
        cookie: Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        "csrf-token": jar["JSESSIONID"]!.replace(/^"|"$/g, ""),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError")
      throw new ScrapeError("linkedin_timeout", "LinkedIn did not respond in time");
    throw new ScrapeError("linkedin_upstream_error", "Network error while contacting LinkedIn");
  }
  if (res.status === 200) return { ok: true as const };
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400))
    throw new ScrapeError(
      "linkedin_session_expired",
      "Session rejected; cookies invalid or expired",
    );
  if (res.status === 429 || res.status === 999)
    throw new ScrapeError(
      "linkedin_rate_limited",
      "LinkedIn is blocking or rate-limiting this session",
    );
  throw new ScrapeError("linkedin_upstream_error", `LinkedIn returned HTTP ${res.status}`);
}

/* ---------------- cookie-less mode: public profile page via scraping API ---------------- */
const unesc = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const ym = (s: any): YM => {
  const m = String(s ?? "").match(/(\d{4})(?:-(\d{2}))?/);
  return m ? { year: +m[1]!, month: m[2] ? +m[2] : null } : null;
};

export async function scrapePublic(opts: {
  url: string;
  relay: Relay;
  timeoutMs: number;
}): Promise<ProfilePayload> {
  const slug = extractSlug(opts.url);
  const target = `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  // LinkedIn answers HTTP 999 to datacenter IPs, so escalate to residential/stealth proxies.
  const tiers = (r: Relay): string[] => {
    const u = encodeURIComponent(target);
    if (r.id === "scrapingbee")
      return [
        `https://app.scrapingbee.com/api/v1/?api_key=${r.key}&url=${u}&render_js=false&premium_proxy=true&country_code=us&transparent_status_code=true`,
        `https://app.scrapingbee.com/api/v1/?api_key=${r.key}&url=${u}&stealth_proxy=true&render_js=true&transparent_status_code=true`,
      ];
    if (r.id === "scraperapi")
      return [
        `https://api.scraperapi.com/?api_key=${r.key}&url=${u}&premium=true&country_code=us`,
        `https://api.scraperapi.com/?api_key=${r.key}&url=${u}&ultra_premium=true`,
      ];
    return [
      `https://api.zenrows.com/v1/?apikey=${r.key}&url=${u}&premium_proxy=true&proxy_country=us&original_status=true`,
      `https://api.zenrows.com/v1/?apikey=${r.key}&url=${u}&premium_proxy=true&js_render=true&antibot=true&original_status=true`,
    ];
  };
  let res: Response | null = null;
  for (const url of tiers(opts.relay)) {
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(Math.max(opts.timeoutMs, 60000)) });
    } catch {
      continue;
    }
    if (res.status !== 999 && res.status < 500) break;
  }
  if (!res) throw new ScrapeError("linkedin_timeout", "Scraping API did not respond in time");
  if (res.status === 999 || res.status >= 500) {
    try {
      const p = await scrapeNoSession({ url: opts.url, timeoutMs: opts.timeoutMs });
      p.meta.warnings.push(`api_key_blocked_http_${res.status}:used_public_listing`);
      return p;
    } catch {
      throw new ScrapeError(
        "session_required",
        `LinkedIn blocked your scraping API (HTTP ${res.status}) even with premium proxies. Switch to Cookie session to fetch this profile.`,
      );
    }
  }
  if (res.status === 401 || res.status === 403 || res.status === 402 || res.status === 429)
    throw new ScrapeError(
      "linkedin_rate_limited",
      `Scraping API refused the request (HTTP ${res.status}): key invalid or credits exhausted. Add a LinkedIn session to fall back.`,
    );
  if (res.status === 404) throw new ScrapeError("profile_not_found", "Profile not found");
  if (res.status >= 400)
    throw new ScrapeError("linkedin_upstream_error", `Scraping API returned HTTP ${res.status}`);
  const html = await res.text();
  const meta = (p: string) => {
    const m = html.match(
      new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`, "i"),
    );
    return m ? unesc(m[1]!) : null;
  };
  let person: any = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]!);
      const list = Array.isArray(j?.["@graph"]) ? j["@graph"] : [j];
      person = list.find((x: any) => x?.["@type"] === "Person") ?? person;
    } catch {
      // Malformed JSON-LD blocks are common; skip them.
    }
  }
  const ogTitle = meta("og:title");
  // LinkedIn often serves a localized sign-up/login wall instead of the profile. Only trust the page
  // when it carries Person data, or its canonical/og:url points at this exact profile.
  const pageUrl = (
    meta("og:url") ??
    html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i)?.[1] ??
    ""
  ).toLowerCase();
  const isProfile =
    !!person ||
    (!!ogTitle &&
      pageUrl.includes(`/in/${slug.toLowerCase()}`) &&
      !/authwall|signup|login/.test(pageUrl));
  if (!isProfile) {
    try {
      const p = await scrapeNoSession({ url: opts.url, timeoutMs: opts.timeoutMs });
      p.meta.warnings.push("api_key_got_login_wall:used_public_listing");
      return p;
    } catch {
      throw new ScrapeError(
        "session_required",
        "LinkedIn showed a login page instead of this profile. Switch to Cookie session to fetch it.",
      );
    }
  }
  const full = String(person?.name ?? ogTitle?.split(/ [-|–] /)[0] ?? slug).trim();
  const [first, ...rest] = full.split(" ");
  const arr = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);
  const img = person?.image?.contentUrl ?? meta("og:image");
  const payload: ProfilePayload = {
    data: {
      public_identifier: slug,
      profile_url: target,
      name: { first: first ?? null, last: rest.join(" ") || null, full },
      headline:
        arr(person?.jobTitle).join(" · ") ||
        ogTitle
          ?.split(/ [-|–] /)
          .slice(1, -1)
          .join(" - ") ||
        null,
      location: person?.address?.addressLocality ?? null,
      about: person?.description ?? meta("og:description"),
      profile_image: img ? { url: img, width: null, height: null } : null,
      background_image: null,
      experience: arr(person?.worksFor).map((w: any) => ({
        title: null,
        company: { name: w?.name ?? null, linkedin_url: w?.url ?? null },
        employment_type: null,
        location: null,
        start_date: ym(w?.member?.startDate),
        end_date: ym(w?.member?.endDate),
        is_current: !w?.member?.endDate,
        description: w?.member?.description ?? null,
      })),
      education: arr(person?.alumniOf).map((a: any) => ({
        school: a?.name ?? null,
        degree: null,
        field_of_study: null,
        start_date: ym(a?.member?.startDate),
        end_date: ym(a?.member?.endDate),
        description: a?.member?.description ?? null,
        grade: null,
      })),
      skills: [],
      certifications: [],
      languages: arr(person?.knowsLanguage).map((l: any) => ({
        name: String(l?.name ?? l),
        proficiency: null,
      })),
    },
    meta: {
      source: `${opts.relay.id} (public page)`,
      completeness: person ? 0.5 : 0.2,
      successful_sections: ["profile"],
      failed_sections: ["skills", "certifications"],
      warnings: ["public_page_only:limited_fields"],
      cached: false,
      fetched_at: new Date().toISOString(),
    },
  };
  // LinkedIn hides most fields behind asterisks for logged-out visitors. Remove masked values
  // and fill the gaps from public web research.
  const masked = (v: unknown) =>
    typeof v === "string" && (v.match(/\*/g)?.length ?? 0) > v.replace(/\s/g, "").length * 0.3;
  const unmask = (v: any): any => {
    if (masked(v)) return null;
    if (Array.isArray(v)) return v.map(unmask);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmask(x)]));
    return v;
  };
  const hadMask = JSON.stringify(payload.data).includes("***");
  const d: ProfileData = unmask(payload.data);
  d.experience = d.experience.filter((e) => e.company.name || e.title);
  d.education = d.education.filter((e) => e.school);
  if (hadMask || !d.headline || d.experience.length < 2) {
    try {
      const r = (await scrapeNoSession({ url: opts.url, timeoutMs: opts.timeoutMs })).data;
      const key = (x: string | null | undefined) =>
        (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const expKeys = new Set(d.experience.map((e) => key(e.company.name)));
      const eduKeys = new Set(d.education.map((e) => key(e.school)));
      Object.assign(d, {
        headline: d.headline ?? r.headline,
        location: d.location ?? r.location,
        about: d.about && d.about.length > (r.about?.length ?? 0) ? d.about : (r.about ?? d.about),
        profile_image: d.profile_image ?? r.profile_image,
        experience: [
          ...d.experience,
          ...r.experience.filter((e) => !expKeys.has(key(e.company.name))),
        ],
        education: [...d.education, ...r.education.filter((e) => !eduKeys.has(key(e.school)))],
        skills: d.skills.length ? d.skills : r.skills,
        languages: d.languages.length ? d.languages : r.languages,
        current_position: r.current_position,
        current_company: r.current_company,
        industry: r.industry,
        achievements: r.achievements,
        contact: r.contact,
        followers: r.followers,
        connections: r.connections,
        sources: [target, ...(r.sources ?? []).filter((x) => x !== target)],
      });
      payload.meta.warnings.push("masked_fields_filled_from_public_research");
    } catch {
      payload.meta.warnings.push("masked_fields_removed:add_cookie_session_for_full_profile");
    }
  }
  payload.data = d;
  return payload;
}

/* ---------------- no-session public lookup (LinkedIn blocks server IPs with HTTP 999, so we read
   the profile's public search listing through the Firecrawl connector) ---------------- */
export async function scrapeNoSession(opts: {
  url: string;
  timeoutMs: number;
}): Promise<ProfilePayload> {
  const slug = extractSlug(opts.url);
  const firecrawl = process.env["FIRECRAWL_API_KEY"];
  if (!firecrawl)
    throw new ScrapeError(
      "session_required",
      "Public lookup is not configured; add a LinkedIn session in Settings",
    );
  const target = `https://www.linkedin.com/in/${slug}`;
  let lastList: any[] = [];
  const gw = async (path: string, body: object) => {
    const r = await fetch(`https://api.firecrawl.dev/v2/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawl}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    return (await r.json()) as any;
  };
  const search = async (query: string) => {
    let res: Response;
    try {
      res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawl}` },
        body: JSON.stringify({ query, limit: 10 }),
        signal: AbortSignal.timeout(Math.max(opts.timeoutMs, 30000)),
      });
    } catch {
      throw new ScrapeError("linkedin_timeout", "Public lookup did not respond in time");
    }
    if (!res.ok) {
      console.error("public lookup failed", res.status);
      if (res.status === 402)
        throw new ScrapeError(
          "linkedin_rate_limited",
          "Public lookup credits are exhausted; add a LinkedIn session in Settings",
        );
      throw new ScrapeError("linkedin_upstream_error", `Public lookup failed (HTTP ${res.status})`);
    }
    const j: any = await res.json();
    const list: any[] = j?.data?.web ?? j?.data ?? [];
    lastList = list;
    return list.find((r) => {
      try {
        const u = new URL(r.url);
        return (
          validHost(u.hostname) &&
          decodeURIComponent(u.pathname)
            .replace(/^\/+|\/+$/g, "")
            .toLowerCase() === `in/${slug.toLowerCase()}`
        );
      } catch {
        return false;
      }
    });
  };
  const hit =
    (await search(`site:linkedin.com/in/${slug}`)) ?? (await search(`"linkedin.com/in/${slug}"`));
  if (!hit)
    throw new ScrapeError(
      "session_required",
      "This profile isn't publicly available without a LinkedIn session. Add your session in Settings and try again.",
    );
  const title = unesc(String(hit.title ?? ""))
    .replace(/\s*[|\-–]\s*LinkedIn\s*$/i, "")
    .trim();
  const desc = unesc(String(hit.description ?? "")).trim();
  const [namePart, ...rest] = title.split(/\s+[-–]\s+/);
  const full = (namePart || slug).trim();
  const [first, ...last] = full.split(" ");
  const field = (k: string) =>
    desc
      .match(new RegExp(`${k}:\\s*([^·]+)`, "i"))?.[1]
      ?.trim()
      .replace(/\.\.\.$/, "") || null;
  const company = field("Experience");
  const school = field("Education");
  let location =
    field("Location") ??
    desc.match(/([A-Z][\w .'-]+,\s*[A-Z][\w .'-]+(?:,\s*United [A-Za-z]+)?)\s+\d/)?.[1]?.trim() ??
    null;
  const followers = desc.match(/([\d.,]+K?\+?)\s+followers/i)?.[1] ?? null;
  const connections = desc.match(/([\d.,]+K?\+?)\s+connections/i)?.[1] ?? null;
  const headline =
    rest
      .join(" - ")
      .replace(/\s*\.\.\.$/, "")
      .trim() || null;

  // Enrichment: search the open web for this person's public pages and read contact details from them.
  const emails = new Set<string>(),
    phones = new Set<string>(),
    websites = new Set<string>();
  const socials: Record<string, string> = {};
  const sources = new Set<string>([target]);
  let about = desc.replace(/\s*\.\.\.$/, "");
  let image: string | null = null;
  const firstHeadline = headline?.split(/[|·,]/)[0]?.trim() ?? "";
  const res2 = await gw("search", {
    query: `"${full}" ${firstHeadline} -site:linkedin.com`,
    limit: 5,
    scrapeOptions: { formats: ["markdown", "links"], onlyMainContent: false },
  }).catch(() => null);
  const pages: any[] = res2?.data?.web ?? res2?.data ?? [];
  const nameRe = new RegExp(
    full
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, ""))
      .join(".{0,3}"),
    "i",
  );
  const SOCIAL: Record<string, RegExp> = {
    x: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search)[A-Za-z0-9_]{2,15}\/?$/i,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore)[A-Za-z0-9_.]{2,30}\/?$/i,
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share)[A-Za-z0-9.]{3,}\/?$/i,
    youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)[\w-]+\/?$/i,
    tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.]+\/?$/i,
    github: /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]{2,39}\/?$/i,
  };
  const corpus: string[] = [`SOURCE ${target}\nTITLE: ${title}\nSNIPPET: ${desc}`];
  for (const pg of pages) {
    const md: string = pg.markdown ?? pg.description ?? "";
    if (!nameRe.test(`${pg.title ?? ""} ${md.slice(0, 5000)}`)) continue; // only pages about this person
    // Only trust pages the person owns: their site (domain matches name/slug) or their own social profile.
    let host = "";
    try {
      host = new URL(pg.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    const bits = [
      ...full
        .toLowerCase()
        .split(/\s+/)
        .filter((b) => b.length > 2),
      slug.toLowerCase().replace(/[^a-z]/g, ""),
    ];
    const related = (t: string) => {
      const x = t.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        bits.some(
          (b) =>
            b.length > 3 &&
            (x.includes(b.replace(/[^a-z]/g, "")) || (b.includes(x) && x.length > 4)),
        ) ||
        x.includes(
          slug
            .toLowerCase()
            .replace(/[^a-z]/g, "")
            .slice(0, 8),
        )
      );
    };
    const isSocial = Object.values(SOCIAL).some((re) => re.test(pg.url.replace(/\/$/, "")));
    const owned = isSocial
      ? related(pg.url.split("/").filter(Boolean).pop() ?? "")
      : related(host.split(".")[0]!);
    if (!owned) continue;
    sources.add(pg.url);
    corpus.push(`SOURCE ${pg.url}\n${md.slice(0, 6000)}`);
    if (!isSocial) websites.add(`https://${host}`);
    const links: string[] = pg.links ?? [];
    const okEmail = (e: string) =>
      !/\.(png|jpe?g|gif|webp|svg)$/.test(e) &&
      !/example|sentry|wixpress|noreply|no-reply/.test(e) &&
      (isSocial
        ? related(e.split("@")[0]!) || related(e.split("@")[1]!.split(".")[0]!)
        : e.endsWith(host) || related(e.split("@")[0]!));
    for (const m of md.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const e = m[0].toLowerCase();
      if (okEmail(e)) emails.add(e);
    }
    for (const l of links)
      if (l.startsWith("mailto:")) {
        const e = l.slice(7).split("?")[0]!.toLowerCase();
        if (okEmail(e)) emails.add(e);
      }
    if (!isSocial) {
      for (const l of links)
        if (l.startsWith("tel:")) phones.add(decodeURIComponent(l.slice(4)).trim());
      for (const l of links)
        for (const [k, re] of Object.entries(SOCIAL))
          if (!socials[k] && re.test(l) && related(l.replace(/\/$/, "").split("/").pop() ?? ""))
            socials[k] = l.replace(/\/$/, "");
    } else {
      for (const [k, re] of Object.entries(SOCIAL))
        if (!socials[k] && re.test(pg.url.replace(/\/$/, "")))
          socials[k] = pg.url.replace(/\/$/, "");
    }
    if (!image && pg.metadata?.ogImage && /^https:/.test(pg.metadata.ogImage))
      image = pg.metadata.ogImage;
    if (!location)
      location =
        md
          .match(
            /(?:based in|lives in|located in)\s+([A-Z][A-Za-z .,'-]{2,40}?)(?:[.,;]|\s+(?:and|with|where))/,
          )?.[1]
          ?.trim() ?? null;
    if (!about && pg.description) about = pg.description;
  }

  // Deep pass 1: read the person's own site contact/about pages, where emails and phones usually live.
  const site = [...websites][0];
  if (site) {
    const mapped = await gw("map", { url: site, search: "contact about", limit: 20 }).catch(
      () => null,
    );
    const urls: string[] = (mapped?.links ?? [])
      .map((l: any) => (typeof l === "string" ? l : l?.url))
      .filter(Boolean);
    const picks = [
      ...new Set(urls.filter((u) => /contact|about|bio|press|speaking|hire|work-with/i.test(u))),
    ].slice(0, 3);
    const scraped = await Promise.all(
      picks.map((u) =>
        gw("scrape", { url: u, formats: ["markdown", "links"], onlyMainContent: false }).catch(
          () => null,
        ),
      ),
    );
    scraped.forEach((r, k) => {
      const md: string = r?.data?.markdown ?? r?.markdown ?? "";
      const links: string[] = r?.data?.links ?? r?.links ?? [];
      if (!md) return;
      sources.add(picks[k]!);
      corpus.push(`SOURCE ${picks[k]}\n${md.slice(0, 6000)}`);
      for (const m of md.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        const e = m[0].toLowerCase();
        if (!/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/example|sentry|wixpress|noreply/.test(e))
          emails.add(e);
      }
      for (const l of links) {
        if (l.startsWith("mailto:")) emails.add(l.slice(7).split("?")[0]!.toLowerCase());
        if (l.startsWith("tel:")) phones.add(decodeURIComponent(l.slice(4)).trim());
      }
      for (const l of links)
        for (const [key, re] of Object.entries(SOCIAL))
          if (!socials[key] && re.test(l)) socials[key] = l.replace(/\/$/, "");
    });
  }

  // Deep pass 2: AI reads every collected source and extracts structured fields (only values stated in the text).
  const ai = await extractWithAI(full, corpus.join("\n\n---\n\n").slice(0, 40000)).catch((e) => {
    console.error("ai extract failed", e instanceof Error ? e.message : "");
    return null;
  });
  const uniq = (a: (string | null | undefined)[]) => [
    ...new Set(a.filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim())),
  ];
  const exp = ai?.experience?.length
    ? ai.experience.map((e: any) => ({
        title: e.title ?? null,
        company: { name: e.company ?? null, linkedin_url: null },
        employment_type: null,
        location: e.location ?? null,
        start_date: yr(e.start_year),
        end_date: yr(e.end_year),
        is_current: !!e.is_current,
        description: e.description ?? null,
      }))
    : company
      ? [
          {
            title: null,
            company: { name: company, linkedin_url: null },
            employment_type: null,
            location: null,
            start_date: null,
            end_date: null,
            is_current: true,
            description: null,
          },
        ]
      : [];
  const edu = ai?.education?.length
    ? ai.education.map((e: any) => ({
        school: e.school ?? null,
        degree: e.degree ?? null,
        field_of_study: e.field ?? null,
        start_date: yr(e.start_year),
        end_date: yr(e.end_year),
        description: null,
        grade: null,
      }))
    : school
      ? [
          {
            school,
            degree: null,
            field_of_study: null,
            start_date: null,
            end_date: null,
            description: null,
            grade: null,
          },
        ]
      : [];
  const allEmails = uniq([...emails, ...(ai?.emails ?? [])].map((e) => e?.toLowerCase()));
  const allPhones = uniq([...phones, ...(ai?.phones ?? [])]);
  return {
    data: {
      public_identifier: slug,
      profile_url: target,
      name: { first: first ?? null, last: last.join(" ") || null, full },
      headline: ai?.headline || headline,
      location: ai?.location || location,
      about: ai?.about || about || null,
      profile_image: image ? { url: image, width: null, height: null } : null,
      background_image: null,
      experience: exp,
      education: edu,
      skills: uniq(ai?.skills ?? [])
        .slice(0, 25)
        .map((n) => ({ name: n, endorsement_count: null })),
      certifications: [],
      languages: uniq(ai?.languages ?? []).map((n) => ({ name: n, proficiency: null })),
      current_position: ai?.current_title ?? exp[0]?.title ?? null,
      current_company: ai?.current_company ?? exp[0]?.company.name ?? null,
      industry: ai?.industry ?? null,
      achievements: uniq(ai?.achievements ?? []).slice(0, 10),
      contact: {
        emails: allEmails.slice(0, 5),
        phones: allPhones.slice(0, 5),
        websites: uniq(
          [...websites, ...(ai?.websites ?? [])].map((w) => w?.replace(/\/+$/, "")),
        ).slice(0, 5),
        socials: { ...(ai?.socials ?? {}), ...socials },
      },
      followers,
      connections,
      sources: [...sources],
    } as ProfileData,
    meta: {
      source: "public_web_research (no session)",
      completeness: 0.6,
      successful_sections: ["profile"],
      failed_sections: ["skills", "certifications", "languages"],
      warnings: ["public_listing_only:add_session_for_full_profile"],
      cached: false,
      fetched_at: new Date().toISOString(),
    },
  };
}

/* ---------------- people search: profile links matching a free-text description ---------------- */
export async function searchProfileLinks(opts: {
  query: string;
  exclude: string[];
  limit: number;
  timeoutMs: number;
}) {
  const firecrawl = process.env["FIRECRAWL_API_KEY"];
  if (!firecrawl)
    throw new ScrapeError(
      "missing_api_key",
      "Profile search is not configured; set FIRECRAWL_API_KEY on the server",
    );
  const q = opts.query.replace(/\s+/g, " ").trim();
  if (!q) throw new ScrapeError("invalid_url", "Describe the people to search for");
  const skip = new Set(opts.exclude.map(profileSlug).filter((x): x is string => !!x));
  const found = new Map<string, string>();
  const excluded = new Set<string>();
  // Several phrasings surface different result sets; stop once enough new profiles are collected.
  for (const query of [
    `site:linkedin.com/in ${q}`,
    `"${q}" site:linkedin.com/in`,
    `linkedin.com/in ${q}`,
  ]) {
    if (found.size >= opts.limit) break;
    let res: Response;
    try {
      res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawl}` },
        body: JSON.stringify({ query, limit: Math.min(100, opts.limit * 2) }),
        signal: AbortSignal.timeout(Math.max(opts.timeoutMs, 30000)),
      });
    } catch {
      throw new ScrapeError("linkedin_timeout", "Profile search did not respond in time");
    }
    if (!res.ok) {
      if (res.status === 402)
        throw new ScrapeError("linkedin_rate_limited", "Profile search credits are exhausted");
      throw new ScrapeError(
        "linkedin_upstream_error",
        `Profile search failed (HTTP ${res.status})`,
      );
    }
    const j: any = await res.json();
    const list: any[] = j?.data?.web ?? j?.data ?? [];
    for (const r of list) {
      const slug = typeof r?.url === "string" ? profileSlug(r.url) : null;
      if (!slug || found.has(slug)) continue;
      if (skip.has(slug)) {
        excluded.add(slug);
        continue;
      }
      if (found.size < opts.limit) found.set(slug, profileUrl(slug));
    }
  }
  return { links: [...found.values()], excluded: excluded.size };
}

const yr = (y: any): YM => (typeof y === "number" && y > 1900 ? { year: y, month: null } : null);

async function extractWithAI(name: string, text: string): Promise<any> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;
  const S = { type: ["string", "null"] },
    A = { type: "array", items: { type: "string" } },
    N = { type: ["number", "null"] };
  const obj = (props: Record<string, any>) => ({
    type: "object",
    properties: props,
    required: Object.keys(props),
    additionalProperties: false,
  });
  const schema = obj({
    headline: S,
    about: S,
    location: S,
    industry: S,
    current_title: S,
    current_company: S,
    emails: A,
    phones: A,
    websites: A,
    skills: A,
    languages: A,
    achievements: A,
    socials: {
      type: "array",
      items: obj({ platform: { type: "string" }, url: { type: "string" } }),
    },
    experience: {
      type: "array",
      items: obj({
        title: S,
        company: S,
        location: S,
        start_year: N,
        end_year: N,
        is_current: { type: "boolean" },
        description: S,
      }),
    },
    education: {
      type: "array",
      items: obj({ school: S, degree: S, field: S, start_year: N, end_year: N }),
    },
  });
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env["OPENAI_MODEL"] ?? "gpt-5",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions:
        "Extract professional profile data about ONE named person from the web sources. Use only facts explicitly stated about that person. Never guess or invent emails or phone numbers; ignore details about other people or companies. Use null or empty arrays for unknown values. about = 2-4 sentence bio. achievements = books, awards, notable work.",
      input: [{ role: "user", content: `Person: ${name}\n\nSources:\n${text}` }],
      text: { format: { type: "json_schema", name: "profile", strict: true, schema } },
    }),
  });
  if (!res.ok || !res.body)
    throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let out = "",
    buf = "";
  const reader = res.body.getReader(),
    dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k: number;
    while ((k = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, k).trim();
      buf = buf.slice(k + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "response.output_text.delta") out += ev.delta;
      } catch {
        // Ignore keep-alive and partial SSE lines.
      }
    }
  }
  const j = JSON.parse(out);
  j.socials = Object.fromEntries(
    (j.socials ?? []).map((x: any) => [x.platform.toLowerCase(), x.url]),
  );
  return j;
}
