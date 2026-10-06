import type { ProfilePayload, YM } from "./linkedin/types";

export const fmtDate = (d: YM) =>
  d ? (d.month ? new Date(d.year, d.month - 1).toLocaleString("en", { month: "short", year: "numeric" }) : String(d.year)) : "";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Long-format CSV: one row per item, so every section fits a single sheet. */
export function toCsv(p: ProfilePayload): string {
  const d = p.data;
  const rows: unknown[][] = [["section", "title", "organization", "detail", "start", "end", "location", "description"]];
  rows.push(["profile", d.name.full, d.headline, d.profile_url, "", "", d.location, d.about]);
  d.experience.forEach((e) =>
    rows.push(["experience", e.title, e.company.name, e.employment_type, fmtDate(e.start_date), e.is_current ? "Present" : fmtDate(e.end_date), e.location, e.description]),
  );
  d.education.forEach((e) =>
    rows.push(["education", e.degree, e.school, e.field_of_study, fmtDate(e.start_date), fmtDate(e.end_date), "", e.description]),
  );
  d.skills.forEach((s) => rows.push(["skill", s.name, "", "", "", "", "", ""]));
  d.certifications.forEach((c) =>
    rows.push(["certification", c.name, c.issuer, c.credential_url ?? c.credential_id, fmtDate(c.issued_at), fmtDate(c.expires_at), "", ""]),
  );
  d.contact?.emails.forEach((e) => rows.push(["email", e, "", "", "", "", "", ""]));
  d.contact?.phones.forEach((e) => rows.push(["phone", e, "", "", "", "", "", ""]));
  d.contact?.websites.forEach((e) => rows.push(["website", e, "", "", "", "", "", ""]));
  Object.entries(d.contact?.socials ?? {}).forEach(([k, v]) => rows.push(["social", k, "", v, "", "", "", ""]));
  d.languages.forEach((l) => rows.push(["language", l.name, "", l.proficiency, "", "", "", ""]));
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Recursively drop null, empty strings, empty arrays and empty objects. */
function clean(v: any): any {
  if (Array.isArray(v)) { const a = v.map(clean).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) { const c = clean(x); if (c !== undefined) o[k] = c; }
    return Object.keys(o).length ? o : undefined;
  }
  if (v === null || v === "" ) return undefined;
  return v;
}

/** Clean export: profile data only, no internal scrape reports. */
export const exportJson = (p: ProfilePayload) => ({ ...clean(p.data), fetched_at: p.meta.fetched_at });

export function download(p: ProfilePayload, format: "json" | "csv") {
  const body = format === "json" ? JSON.stringify(exportJson(p), null, 2) : "\ufeff" + toCsv(p);
  const blob = new Blob([body], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.data.public_identifier ?? "profile"}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
