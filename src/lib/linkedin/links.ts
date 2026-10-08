/** Client-safe: canonicalize LinkedIn profile links so lists can be deduplicated. */
const SLUG = /^[A-Za-z0-9_-]{3,100}$/;
const HOST = /^(?:www\.|[a-z]{2,5}\.)?linkedin\.com$/;

/** Lowercased profile slug for a linkedin.com/in/<slug> URL (extra path segments allowed), or null. */
export function profileSlug(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!HOST.test(u.hostname.toLowerCase())) return null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const [kind, slug] = path.replace(/^\/+/, "").split("/");
  return kind === "in" && slug && SLUG.test(slug) ? slug.toLowerCase() : null;
}

export const profileUrl = (slug: string) => `https://www.linkedin.com/in/${slug}`;
