import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProfilePayload, YM } from "@/lib/linkedin/types";
import { download, fmtDate } from "@/lib/export";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString();

/** Placeholder shown while a profile is being scraped. */
export function Skeleton() {
  return (
    <div className="panel animate-pulse p-6">
      <div className="flex gap-4">
        <div className="size-16 rounded-full bg-muted" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 w-48 rounded bg-muted" />
          <div className="h-3 w-80 max-w-full rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-8 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 rounded bg-muted" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

function Block({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t px-6 py-6">
      <h3 className="eyebrow mb-4">
        {title}
        {count != null && <span className="ml-2 text-foreground/60">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const range = (a: YM, b: YM, current?: boolean) => {
  const s = fmtDate(a);
  const e = current ? "Present" : fmtDate(b);
  return s || e ? `${s}${s && e ? " – " : ""}${e}` : "";
};

/** Full profile card with its own single-profile export. */
export function ProfileResult({
  p,
  ms,
  format,
  setFmt,
}: {
  p: ProfilePayload;
  ms?: number;
  format: "json" | "csv";
  setFmt: (f: "json" | "csv") => void;
}) {
  const d = p.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="dot bg-success" />
          Scraped
        </span>
        <span className="font-mono text-[12px]">
          {p.meta.cached
            ? "from cache"
            : ms != null
              ? `${(ms / 1000).toFixed(1)}s`
              : fmtTime(p.meta.fetched_at)}
        </span>
        {p.meta.warnings.length > 0 && (
          <span className="text-warning">Partial: {p.meta.warnings.join(", ")}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={format}
            onChange={(e) => setFmt(e.target.value as "json" | "csv")}
            className="field h-8 w-auto py-0 pr-7 font-mono text-xs uppercase"
            aria-label="Export format"
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => download(p, format)}>
            <Download />
            Export
          </Button>
        </div>
      </div>

      <article className="panel overflow-hidden">
        <header className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          {d.profile_image ? (
            <img
              src={d.profile_image.url}
              alt=""
              className="size-16 rounded-full border object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid size-16 place-items-center rounded-full bg-secondary text-lg font-medium text-muted-foreground">
              {d.name.full
                .split(" ")
                .map((x) => x[0])
                .slice(0, 2)
                .join("")}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {d.name.full || d.public_identifier}
            </h2>
            {d.headline && <p className="mt-0.5 text-sm text-foreground/80">{d.headline}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              {d.location && <span>{d.location}</span>}
              <a
                href={d.profile_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-foreground"
              >
                /in/{d.public_identifier}
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        </header>

        {d.about && (
          <Block title="About">
            <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-foreground/85">
              {d.about}
            </p>
          </Block>
        )}

        {d.experience.length > 0 && (
          <Block title="Experience" count={d.experience.length}>
            <ol className="space-y-5">
              {d.experience.map((e, i) => (
                <li key={i} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-6">
                  <div className="font-mono text-[12px] text-muted-foreground sm:pt-0.5">
                    {range(e.start_date, e.end_date, e.is_current)}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{e.title}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {[e.company.name, e.employment_type, e.location].filter(Boolean).join(" · ")}
                    </div>
                    {e.description && (
                      <p className="mt-1.5 max-w-prose whitespace-pre-line text-[13px] leading-relaxed text-foreground/80">
                        {e.description}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Block>
        )}

        {d.education.length > 0 && (
          <Block title="Education" count={d.education.length}>
            <ol className="space-y-4">
              {d.education.map((e, i) => (
                <li key={i} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-6">
                  <div className="font-mono text-[12px] text-muted-foreground sm:pt-0.5">
                    {range(e.start_date, e.end_date)}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{e.school}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {[e.degree, e.field_of_study, e.grade].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Block>
        )}

        {d.skills.length > 0 && (
          <Block title="Skills" count={d.skills.length}>
            <ul className="flex flex-wrap gap-1.5">
              {d.skills.map((s) => (
                <li key={s.name} className="rounded border bg-secondary/60 px-2 py-0.5 text-[13px]">
                  {s.name}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {d.certifications.length > 0 && (
          <Block title="Certifications" count={d.certifications.length}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Issuer</th>
                    <th className="pb-2 pr-4 font-medium">Issued</th>
                    <th className="pb-2 font-medium">Credential</th>
                  </tr>
                </thead>
                <tbody>
                  {d.certifications.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{c.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{c.issuer}</td>
                      <td className="py-2 pr-4 font-mono text-[12px] text-muted-foreground">
                        {fmtDate(c.issued_at)}
                      </td>
                      <td className="py-2 font-mono text-[12px]">
                        {c.credential_url ? (
                          <a
                            href={c.credential_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {c.credential_id || "View"}
                          </a>
                        ) : (
                          (c.credential_id ?? "")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>
        )}

        {d.languages.length > 0 && (
          <Block title="Languages" count={d.languages.length}>
            <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {d.languages.map((l) => (
                <li
                  key={l.name}
                  className="flex justify-between gap-4 border-b border-dashed pb-1.5"
                >
                  <span>{l.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {l.proficiency?.replace(/_/g, " ").toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </article>
    </div>
  );
}
