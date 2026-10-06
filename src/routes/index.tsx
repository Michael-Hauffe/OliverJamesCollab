import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertCircle, Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scrapeProfile } from "@/lib/linkedin.functions";
import type { ProfilePayload, ScrapeErrorCode } from "@/lib/linkedin/types";
import { settings, useSettings } from "@/lib/settings";
import { download, fmtDate } from "@/lib/export";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Profile Extractor" },
      { name: "description", content: "Extract structured data from a LinkedIn profile and export it as JSON or CSV." },
      { property: "og:title", content: "Dashboard — Profile Extractor" },
      { property: "og:description", content: "Extract structured data from a LinkedIn profile and export it as JSON or CSV." },
    ],
  }),
  component: Dashboard,
});

type State =
  | { s: "idle" }
  | { s: "loading" }
  | { s: "done"; p: ProfilePayload; ms: number }
  | { s: "error"; code: ScrapeErrorCode; message: string };

const HELP: Partial<Record<ScrapeErrorCode, string>> = {
  missing_cookie: "Add your LinkedIn cookie header in Settings first.",
  invalid_cookie: "Check the cookie header in Settings.",
  linkedin_session_expired: "Copy a fresh cookie header from a logged-in browser and update it in Settings.",
  linkedin_challenge: "Log in to LinkedIn in a browser, complete the verification, then copy fresh cookies.",
  linkedin_rate_limited: "Wait a while before trying again.",
};

function Dashboard() {
  const { hasCookie, apiKey, prefs, ready } = useSettings();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ s: "idle" });
  const [fmt, setFmt] = useState<"json" | "csv" | null>(null);
  const run = useServerFn(scrapeProfile);
  const format = fmt ?? prefs.exportFormat;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setState({ s: "loading" });
    const t = performance.now();
    try {
      const r = await run({ data: { url, cookie: settings.getCookie(), apiKey: settings.getApiKey(), proxy: settings.getProxy(), timeoutSec: prefs.timeoutSec, useCache: prefs.useCache } });
      if (r.ok) setState({ s: "done", p: r.value, ms: performance.now() - t });
      else {
        setState({ s: "error", code: r.code, message: r.message });
        if (r.code === "linkedin_session_expired" || r.code === "linkedin_challenge")
          settings.setStatus({ state: "error", message: r.message, at: new Date().toISOString() });
      }
    } catch {
      setState({ s: "error", code: "internal_error", message: "Could not reach the server" });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Extract a profile</h1>
        <p className="hint mt-1">Paste a public LinkedIn profile URL, for example linkedin.com/in/username.</p>
      </div>

      {ready && !hasCookie && !apiKey && (
        <div className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="dot bg-warning" />
          No LinkedIn session or scraping API key configured.
          <Link to="/settings" className="ml-auto font-medium text-primary hover:underline">Open Settings</Link>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field h-10 flex-1 font-mono"
          placeholder="https://www.linkedin.com/in/username"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="LinkedIn profile URL"
          autoFocus
        />
        <Button type="submit" className="h-10 px-5" disabled={state.s === "loading" || !url.trim()}>
          {state.s === "loading" && <Loader2 className="animate-spin" />}
          {state.s === "loading" ? "Scraping…" : "Scrape"}
        </Button>
      </form>

      {state.s === "idle" && (
        <div className="panel grid place-items-center border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">No profile loaded</p>
          <p className="hint mt-1 max-w-sm">Results appear here: profile, experience, education, skills, certifications and languages.</p>
        </div>
      )}

      {state.s === "loading" && <Skeleton />}

      {state.s === "error" && (
        <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <div className="font-medium">{state.message}</div>
            {HELP[state.code] && <div className="mt-0.5 text-muted-foreground">{HELP[state.code]}</div>}
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{state.code}</div>
          </div>
        </div>
      )}

      {state.s === "done" && (
        <Result p={state.p} ms={state.ms} format={format} setFmt={setFmt} />
      )}
    </div>
  );
}

function Skeleton() {
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
        {[0, 1, 2].map((i) => <div key={i} className="h-3 rounded bg-muted" style={{ width: `${90 - i * 15}%` }} />)}
      </div>
    </div>
  );
}

function Block({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
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

const range = (a: any, b: any, current?: boolean) => {
  const s = fmtDate(a);
  const e = current ? "Present" : fmtDate(b);
  return s || e ? `${s}${s && e ? " – " : ""}${e}` : "";
};

function Result({ p, ms, format, setFmt }: { p: ProfilePayload; ms: number; format: "json" | "csv"; setFmt: (f: "json" | "csv") => void }) {
  const d = p.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-2"><span className="dot bg-success" />Scraped</span>
        <span className="font-mono text-[12px]">{p.meta.cached ? "from cache" : `${(ms / 1000).toFixed(1)}s`}</span>
        {p.meta.warnings.length > 0 && <span className="text-warning">Partial: {p.meta.warnings.join(", ")}</span>}
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
            <Download />Export
          </Button>
        </div>
      </div>

      <article className="panel overflow-hidden">
        <header className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          {d.profile_image ? (
            <img src={d.profile_image.url} alt="" className="size-16 rounded-full border object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="grid size-16 place-items-center rounded-full bg-secondary text-lg font-medium text-muted-foreground">
              {d.name.full.split(" ").map((x) => x[0]).slice(0, 2).join("")}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{d.name.full || d.public_identifier}</h2>
            {d.headline && <p className="mt-0.5 text-sm text-foreground/80">{d.headline}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              {d.location && <span>{d.location}</span>}
              <a href={d.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-foreground">
                /in/{d.public_identifier}<ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        </header>

        {d.about && (
          <Block title="About">
            <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-foreground/85">{d.about}</p>
          </Block>
        )}

        {d.experience.length > 0 && (
          <Block title="Experience" count={d.experience.length}>
            <ol className="space-y-5">
              {d.experience.map((e, i) => (
                <li key={i} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-6">
                  <div className="font-mono text-[12px] text-muted-foreground sm:pt-0.5">{range(e.start_date, e.end_date, e.is_current)}</div>
                  <div>
                    <div className="text-sm font-medium">{e.title}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {[e.company.name, e.employment_type, e.location].filter(Boolean).join(" · ")}
                    </div>
                    {e.description && <p className="mt-1.5 max-w-prose whitespace-pre-line text-[13px] leading-relaxed text-foreground/80">{e.description}</p>}
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
                  <div className="font-mono text-[12px] text-muted-foreground sm:pt-0.5">{range(e.start_date, e.end_date)}</div>
                  <div>
                    <div className="text-sm font-medium">{e.school}</div>
                    <div className="text-[13px] text-muted-foreground">{[e.degree, e.field_of_study, e.grade].filter(Boolean).join(" · ")}</div>
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
                <li key={s.name} className="rounded border bg-secondary/60 px-2 py-0.5 text-[13px]">{s.name}</li>
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
                      <td className="py-2 pr-4 font-mono text-[12px] text-muted-foreground">{fmtDate(c.issued_at)}</td>
                      <td className="py-2 font-mono text-[12px]">
                        {c.credential_url ? (
                          <a href={c.credential_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{c.credential_id || "View"}</a>
                        ) : (c.credential_id ?? "")}
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
                <li key={l.name} className="flex justify-between gap-4 border-b border-dashed pb-1.5">
                  <span>{l.name}</span>
                  <span className="text-[13px] text-muted-foreground">{l.proficiency?.replace(/_/g, " ").toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </article>
    </div>
  );
}
