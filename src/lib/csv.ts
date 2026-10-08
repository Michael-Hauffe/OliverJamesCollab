/** Minimal RFC 4180 CSV reader/writer (quoted fields, escaped quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** Quote when needed and neutralize spreadsheet formulas (=, +, -, @) in untrusted values. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsvText = (rows: unknown[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export const PROFILE_LINK_HEADER = "Profile Link";

/** Profile links from a "Profile Link" column (falls back to column A when the header is absent). */
export function readProfileLinks(text: string): string[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = header.indexOf(PROFILE_LINK_HEADER.toLowerCase());
  const hasHeader = idx !== -1 || !/linkedin\.com/i.test(rows[0]![0] ?? "");
  const col = Math.max(idx, 0);
  return (hasHeader ? rows.slice(1) : rows).map((r) => (r[col] ?? "").trim()).filter(Boolean);
}

export function downloadText(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
