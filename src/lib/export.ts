import { downloadText, toCsvText } from "./csv";
import type { ProfilePayload, ScrapeErrorCode, YM } from "./linkedin/types";

export const fmtDate = (d: YM) =>
  d
    ? d.month
      ? new Date(d.year, d.month - 1).toLocaleString("en", { month: "short", year: "numeric" })
      : String(d.year)
    : "";

const HEADER = [
  "section",
  "title",
  "organization",
  "detail",
  "start",
  "end",
  "location",
  "description",
];

/** One row per item, so every section fits a single sheet. */
function csvRows(p: ProfilePayload): unknown[][] {
  const d = p.data;
  const rows: unknown[][] = [];
  rows.push(["profile", d.name.full, d.headline, d.profile_url, "", "", d.location, d.about]);
  d.experience.forEach((e) =>
    rows.push([
      "experience",
      e.title,
      e.company.name,
      e.employment_type,
      fmtDate(e.start_date),
      e.is_current ? "Present" : fmtDate(e.end_date),
      e.location,
      e.description,
    ]),
  );
  d.education.forEach((e) =>
    rows.push([
      "education",
      e.degree,
      e.school,
      e.field_of_study,
      fmtDate(e.start_date),
      fmtDate(e.end_date),
      "",
      e.description,
    ]),
  );
  d.skills.forEach((s) => rows.push(["skill", s.name, "", "", "", "", "", ""]));
  d.certifications.forEach((c) =>
    rows.push([
      "certification",
      c.name,
      c.issuer,
      c.credential_url ?? c.credential_id,
      fmtDate(c.issued_at),
      fmtDate(c.expires_at),
      "",
      "",
    ]),
  );
  d.contact?.emails.forEach((e) => rows.push(["email", e, "", "", "", "", "", ""]));
  d.contact?.phones.forEach((e) => rows.push(["phone", e, "", "", "", "", "", ""]));
  d.contact?.websites.forEach((e) => rows.push(["website", e, "", "", "", "", "", ""]));
  Object.entries(d.contact?.socials ?? {}).forEach(([k, v]) =>
    rows.push(["social", k, "", v, "", "", "", ""]),
  );
  d.languages.forEach((l) => rows.push(["language", l.name, "", l.proficiency, "", "", "", ""]));
  return rows;
}

/** Long-format CSV for one profile. */
export const toCsv = (p: ProfilePayload) => toCsvText([HEADER, ...csvRows(p)]);

/** Outcome of one row of a batch scrape. */
export type BatchItem = { link: string } & (
  { ok: true; payload: ProfilePayload } | { ok: false; code: ScrapeErrorCode; message: string }
);

/** Long-format CSV for a batch: every row is keyed by the input profile link; failures get an "error" row. */
export const toBatchCsv = (items: BatchItem[]) =>
  toCsvText([
    ["profile_link", ...HEADER],
    ...items.flatMap((it) =>
      it.ok
        ? csvRows(it.payload).map((r) => [it.link, ...r])
        : [[it.link, "error", it.code, "", it.message, "", "", "", ""]],
    ),
  ]);

/** Recursively drop null, empty strings, empty arrays and empty objects. */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) {
    const a = v.map(clean).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c !== undefined) o[k] = c;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (v === null || v === "") return undefined;
  return v;
}

/** Clean export: profile data only, no internal scrape reports. */
export const exportJson = (p: ProfilePayload) => ({
  ...(clean(p.data) as object),
  fetched_at: p.meta.fetched_at,
});

const MIME = { json: "application/json", csv: "text/csv;charset=utf-8" };

export function download(p: ProfilePayload, format: "json" | "csv") {
  const body = format === "json" ? JSON.stringify(exportJson(p), null, 2) : "\ufeff" + toCsv(p);
  downloadText(`${p.data.public_identifier ?? "profile"}.${format}`, body, MIME[format]);
}

export function downloadBatch(items: BatchItem[], format: "json" | "csv") {
  const body =
    format === "json"
      ? JSON.stringify(
          items.map((it) =>
            it.ok
              ? { profile_link: it.link, ...exportJson(it.payload) }
              : { profile_link: it.link, error: { code: it.code, message: it.message } },
          ),
          null,
          2,
        )
      : "\ufeff" + toBatchCsv(items);
  downloadText(`profiles-export.${format}`, body, MIME[format]);
}
