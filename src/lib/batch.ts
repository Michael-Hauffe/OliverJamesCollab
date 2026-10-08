import type { ScrapeErrorCode } from "./linkedin/types";
import { profileSlug } from "./linkedin/links";

/** Pause between batch scrapes: 5 s ± a random 0–3 s (so 2–8 s). */
export const BASE_DELAY_MS = 5000;
export const JITTER_MS = 3000;
export const nextDelayMs = (rand: () => number = Math.random) =>
  BASE_DELAY_MS + (rand() * 2 - 1) * JITTER_MS;

/** Resolves after `ms`, or early (with false) once the signal aborts. */
export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const t = setTimeout(() => resolve(true), ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve(false)), { once: true });
  });

/** Errors that would fail every remaining row, so the batch stops instead of burning through the list. */
export const FATAL: ReadonlySet<ScrapeErrorCode> = new Set<ScrapeErrorCode>([
  "missing_cookie",
  "invalid_cookie",
  "missing_api_key",
  "linkedin_session_expired",
  "linkedin_challenge",
  "linkedin_rate_limited",
  "proxy_error",
]);

/** Drop repeated profiles (same slug, regardless of URL form); unrecognized links are kept so they report an error. */
export function dedupeLinks(links: string[]): string[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const k = profileSlug(l) ?? l;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
