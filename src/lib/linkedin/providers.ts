/** Client-safe: detect which scraping API a pasted key belongs to. */
export type ProviderId = "scrapingbee" | "scraperapi" | "zenrows" | "rapidapi";
export type Detected = { id: ProviderId; name: string; supported: boolean; note?: string } | null;

const NAMES: Record<ProviderId, string> = {
  scrapingbee: "ScrapingBee",
  scraperapi: "ScraperAPI",
  zenrows: "ZenRows",
  rapidapi: "RapidAPI",
};

export function detectProvider(raw: string): Detected {
  const k = raw.trim();
  if (!k) return null;
  const pre = k.match(/^(scrapingbee|scraperapi|zenrows|rapidapi):/i);
  let id: ProviderId | null = pre ? (pre[1]!.toLowerCase() as ProviderId) : null;
  const key = stripPrefix(k);
  if (!id) {
    if (/^[A-Z0-9]{80}$/.test(key)) id = "scrapingbee";
    else if (/^[a-f0-9]{32}$/.test(key)) id = "scraperapi";
    else if (/^[a-f0-9]{40}$/.test(key)) id = "zenrows";
    else if (/^[A-Za-z0-9]{50}$/.test(key) && key.includes("msh")) id = "rapidapi";
  }
  if (!id) return null;
  if (id === "rapidapi")
    return { id, name: NAMES[id], supported: false, note: "RapidAPI keys are per-API and can't relay LinkedIn requests; session scraping will be used." };
  return { id, name: NAMES[id], supported: true };
}

export const stripPrefix = (k: string) => k.trim().replace(/^(scrapingbee|scraperapi|zenrows|rapidapi):/i, "");

/** Accepts http://user:pass@host:port or host:port:user:pass. Returns normalized URL or null. */
export function normalizeProxy(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(https?|socks5):\/\/[^\s]+:\d+\/?$/i.test(s) || /^(https?|socks5):\/\/[^\s]+@[^\s]+:\d+\/?$/i.test(s)) return s.replace(/\/$/, "");
  const p = s.split(":");
  if (p.length === 4 && /^\d+$/.test(p[1]!)) return `http://${encodeURIComponent(p[2]!)}:${encodeURIComponent(p[3]!)}@${p[0]}:${p[1]}`;
  if (p.length === 2 && /^\d+$/.test(p[1]!)) return `http://${s}`;
  return null;
}
