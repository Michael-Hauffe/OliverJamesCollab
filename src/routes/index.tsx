import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { BatchPanel, ProfileSearch, type Queue } from "@/components/batch-tools";
import { ProfileResult, Skeleton } from "@/components/profile-view";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { scrapeProfile } from "@/lib/linkedin.functions";
import type { ProfilePayload, ScrapeErrorCode } from "@/lib/linkedin/types";
import { settings, useSettings } from "@/lib/settings";

const DESCRIPTION =
  "Extract structured data from LinkedIn profiles one at a time or in bulk from a CSV, find new profiles, and export as JSON or CSV.";

const VIEWS = [
  ["single", "Single profile"],
  ["batch", "Batch (Profiles.csv)"],
  ["search", "Find profiles"],
] as const;
type View = (typeof VIEWS)[number][0];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Profile Extractor" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Dashboard — Profile Extractor" },
      { property: "og:description", content: DESCRIPTION },
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
  missing_api_key: "Add a scraping API key in Settings, or switch API key off.",
  session_required:
    "This profile isn't publicly visible without logging in. Add your LinkedIn cookie header in Settings to fetch it.",
  missing_cookie: "Add your LinkedIn cookie header in Settings first.",
  invalid_cookie: "Check the cookie header in Settings.",
  linkedin_session_expired:
    "Copy a fresh cookie header from a logged-in browser and update it in Settings.",
  linkedin_challenge:
    "Log in to LinkedIn in a browser, complete the verification, then copy fresh cookies.",
  linkedin_rate_limited: "Wait a while before trying again, or add proxies in Settings.",
  proxy_error:
    "Check your proxies in Settings (use Test proxies), or clear them to connect directly.",
};

function Dashboard() {
  const { hasCookie, apiKey, proxyCount, prefs, ready } = useSettings();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"public" | "api" | "cookie">("public");
  // As soon as a cookie session is imported, switch to it automatically.
  useEffect(() => {
    if (ready && hasCookie) setMode("cookie");
  }, [ready, hasCookie]);
  const [state, setState] = useState<State>({ s: "idle" });
  const [fmt, setFmt] = useState<"json" | "csv" | null>(null);
  const [view, setView] = useState<View>("single");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [known, setKnown] = useState<string[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const run = useServerFn(scrapeProfile);
  const format = fmt ?? prefs.exportFormat;

  // Shared by the single-profile form and the batch scraper, so both honor the selected mode.
  const scrapeOne = async (target: string) => {
    const r = await run({
      data: {
        url: target,
        mode,
        cookie: mode === "cookie" ? settings.getCookie() : "",
        apiKey: mode === "api" ? settings.getApiKey() : "",
        proxies: mode === "cookie" ? settings.getProxies() : [],
        timeoutSec: prefs.timeoutSec,
        useCache: prefs.useCache,
      },
    });
    if (!r.ok && (r.code === "linkedin_session_expired" || r.code === "linkedin_challenge"))
      settings.setStatus({ state: "error", message: r.message, at: new Date().toISOString() });
    return r;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setState({ s: "loading" });
    const t = performance.now();
    try {
      const r = await scrapeOne(url);
      if (r.ok) setState({ s: "done", p: r.value, ms: performance.now() - t });
      else setState({ s: "error", code: r.code, message: r.message });
    } catch {
      setState({ s: "error", code: "internal_error", message: "Could not reach the server" });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Extract profiles</h1>
        <p className="hint mt-1">
          Scrape one LinkedIn profile, a whole Profiles.csv, or find new profiles to scrape.
        </p>
      </div>

      {ready && !hasCookie && !apiKey && (
        <div className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="dot bg-warning" />
          No session configured — public profiles will be fetched without login; you'll be told if a
          session is needed.
          <Link to="/settings" className="ml-auto font-medium text-primary hover:underline">
            Open Settings
          </Link>
        </div>
      )}

      <div className="panel flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-6">
        <span className="font-medium">Scrape using</span>
        <label className="flex items-center gap-2">
          <Switch
            checked={mode === "api"}
            onCheckedChange={(v) => setMode(v ? "api" : "public")}
            disabled={batchRunning}
            aria-label="Use API key scraping"
          />
          API key
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={mode === "cookie"}
            onCheckedChange={(v) => setMode(v ? "cookie" : "public")}
            disabled={batchRunning}
            aria-label="Use cookie session scraping"
          />
          Cookie session
        </label>
        <span className="hint sm:ml-auto">
          {batchRunning
            ? "Locked while the batch runs"
            : mode === "public"
              ? "Both off: public lookup, no login"
              : mode === "api"
                ? apiKey
                  ? "Using your API key"
                  : "No API key set — add one in Settings"
                : hasCookie
                  ? `✓ Session imported — full profile incl. email & phone when shared${proxyCount ? ` · via ${proxyCount} prox${proxyCount === 1 ? "y" : "ies"}` : ""}`
                  : "No cookie set — add one in Settings"}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Dashboard view"
        className="inline-flex flex-wrap rounded-md border bg-card p-0.5"
      >
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
            {v === "batch" && batchRunning && (
              <Loader2 className="ml-1.5 inline size-3 animate-spin" />
            )}
          </button>
        ))}
      </div>

      {/* Tabs stay mounted so a running batch and search results survive switching. */}
      <div hidden={view !== "single"} className="space-y-8">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="field h-10 flex-1 font-mono"
            placeholder="https://www.linkedin.com/in/username"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="LinkedIn profile URL"
            autoFocus
          />
          <Button
            type="submit"
            className="h-10 px-5"
            disabled={state.s === "loading" || !url.trim()}
          >
            {state.s === "loading" && <Loader2 className="animate-spin" />}
            {state.s === "loading" ? "Scraping…" : "Scrape"}
          </Button>
        </form>

        {state.s === "idle" && (
          <div className="panel grid place-items-center border-dashed px-6 py-16 text-center">
            <p className="text-sm font-medium">No profile loaded</p>
            <p className="hint mt-1 max-w-sm">
              Results appear here: profile, experience, education, skills, certifications and
              languages.
            </p>
          </div>
        )}

        {state.s === "loading" && <Skeleton />}

        {state.s === "error" && (
          <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium">{state.message}</div>
              {HELP[state.code] && (
                <div className="mt-0.5 text-muted-foreground">{HELP[state.code]}</div>
              )}
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{state.code}</div>
            </div>
          </div>
        )}

        {state.s === "done" && (
          <ProfileResult p={state.p} ms={state.ms} format={format} setFmt={setFmt} />
        )}
      </div>

      <div hidden={view !== "batch"}>
        <BatchPanel
          queue={queue}
          onImport={(q) => {
            setQueue(q);
            setKnown(q.links);
          }}
          scrapeOne={scrapeOne}
          format={format}
          setFmt={setFmt}
          onRunningChange={setBatchRunning}
        />
      </div>

      <div hidden={view !== "search"}>
        <ProfileSearch
          known={known ?? []}
          hasProfilesCsv={known != null}
          disabled={batchRunning}
          onScrape={(q) => {
            setQueue(q);
            setView("batch");
          }}
        />
      </div>
    </div>
  );
}
