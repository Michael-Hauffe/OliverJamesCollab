import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, ListPlus, Loader2, Search, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { ProfileResult } from "@/components/profile-view";
import { Button } from "@/components/ui/button";
import { FATAL, dedupeLinks, nextDelayMs, sleep } from "@/lib/batch";
import { PROFILE_LINK_HEADER, downloadText, readProfileLinks, toCsvText } from "@/lib/csv";
import { type BatchItem, downloadBatch } from "@/lib/export";
import { searchProfiles } from "@/lib/linkedin.functions";
import type { ProfilePayload, Result } from "@/lib/linkedin/types";

/** The list a batch run works through: an imported Profiles.csv or links from a search. */
export type Queue = { name: string; links: string[] };
type Format = "json" | "csv";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Re-renders every 100 ms until `until`, returning the seconds left. */
function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until == null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [until]);
  return until == null ? null : Math.max(0, (until - now) / 1000);
}

function FormatSelect({
  format,
  setFmt,
  label,
}: {
  format: Format;
  setFmt: (f: Format) => void;
  label: string;
}) {
  return (
    <select
      value={format}
      onChange={(e) => setFmt(e.target.value as Format)}
      className="field h-8 w-auto py-0 pr-7 font-mono text-xs uppercase"
      aria-label={label}
    >
      <option value="json">JSON</option>
      <option value="csv">CSV</option>
    </select>
  );
}

type BatchProps = {
  queue: Queue | null;
  onImport: (q: Queue) => void;
  scrapeOne: (url: string) => Promise<Result<ProfilePayload>>;
  format: Format;
  setFmt: (f: Format) => void;
  onRunningChange: (running: boolean) => void;
};

/** Scrapes every profile in the queue with a randomized pause, then exports all results. */
export function BatchPanel({
  queue,
  onImport,
  scrapeOne,
  format,
  setFmt,
  onRunningChange,
}: BatchProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const secondsLeft = useCountdown(waitUntil);

  // A new list replaces the previous run's results.
  useEffect(() => {
    setItems([]);
    setSelected(null);
  }, [queue]);

  useEffect(() => onRunningChange(running), [running, onRunningChange]);

  // Leaving the page would silently abandon the run.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const links = dedupeLinks(readProfileLinks(await f.text()));
    if (!links.length) {
      toast.error(`No links found under a "${PROFILE_LINK_HEADER}" header in ${f.name}`);
      return;
    }
    onImport({ name: f.name, links });
    toast.success(`Loaded ${plural(links.length, "profile")} from ${f.name}`);
  };

  const runBatch = async () => {
    if (!queue?.links.length) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setRunning(true);
    setItems([]);
    setSelected(null);
    for (let i = 0; i < queue.links.length && !ctl.signal.aborted; i++) {
      const link = queue.links[i]!;
      let item: BatchItem;
      try {
        const r = await scrapeOne(link);
        item = r.ok
          ? { link, ok: true, payload: r.value }
          : { link, ok: false, code: r.code, message: r.message };
      } catch {
        item = { link, ok: false, code: "internal_error", message: "Could not reach the server" };
      }
      setItems((prev) => [...prev, item]);
      if (!item.ok && FATAL.has(item.code)) {
        toast.error(`Batch stopped: ${item.message}`);
        break;
      }
      if (i < queue.links.length - 1) {
        const ms = nextDelayMs();
        setWaitUntil(Date.now() + ms);
        await sleep(ms, ctl.signal);
        setWaitUntil(null);
      }
    }
    setWaitUntil(null);
    setRunning(false);
    if (ctl.signal.aborted) toast("Batch stopped");
  };

  const ok = items.filter((i) => i.ok).length;
  const total = queue?.links.length ?? 0;
  const shown = selected != null ? items[selected] : undefined;

  return (
    <div className="space-y-6">
      <section className="panel space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Batch scrape from Profiles.csv</h2>
          <p className="hint mt-1">
            Column A must be headed “{PROFILE_LINK_HEADER}”. Profiles are scraped one by one using
            the mode above, with a 5 s ± 0–3 s pause between each.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void importCsv(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant="outline" disabled={running} onClick={() => input.current?.click()}>
            <Upload />
            Import CSV
          </Button>
          {queue && (
            <span className="font-mono text-[12px] text-muted-foreground">
              {queue.name} · {plural(total, "profile")}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {running ? (
              <Button variant="outline" onClick={() => abort.current?.abort()}>
                <Square />
                Stop
              </Button>
            ) : (
              <Button disabled={!total} onClick={() => void runBatch()}>
                {items.length ? "Run again" : "Scrape all"}
              </Button>
            )}
          </div>
        </div>

        {(running || items.length > 0) && (
          <div className="space-y-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${total ? (items.length / total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
              {running && <Loader2 className="size-4 animate-spin" />}
              <span className="font-mono text-[12px]">
                {items.length}/{total} processed · {ok} ok · {items.length - ok} failed
              </span>
              {secondsLeft != null && (
                <span className="font-mono text-[12px]">next in {secondsLeft.toFixed(1)}s</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <FormatSelect format={format} setFmt={setFmt} label="Batch export format" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!items.length}
                  onClick={() => downloadBatch(items, format)}
                >
                  <Download />
                  Export all
                </Button>
              </div>
            </div>
            <ol className="max-h-72 divide-y overflow-y-auto rounded-md border text-[13px]">
              {items.map((it, i) => (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!it.ok}
                    onClick={() => setSelected(selected === i ? null : i)}
                    title={it.ok ? "Show this profile" : it.message}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left enabled:hover:bg-secondary/60 ${selected === i ? "bg-secondary" : ""}`}
                  >
                    <span className={`dot shrink-0 ${it.ok ? "bg-success" : "bg-destructive"}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{it.link}</span>
                    <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">
                      {it.ok
                        ? it.payload.data.name.full || it.payload.data.public_identifier
                        : it.code}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {ok > 0 && !shown && (
              <p className="hint">Select a scraped profile to see its details.</p>
            )}
          </div>
        )}
      </section>

      {shown?.ok && <ProfileResult p={shown.payload} format={format} setFmt={setFmt} />}
    </div>
  );
}

type SearchProps = {
  /** Links from the imported Profiles.csv; matching profiles are left out of the results. */
  known: string[];
  hasProfilesCsv: boolean;
  disabled: boolean;
  onScrape: (q: Queue) => void;
};

const downloadV2 = (links: string[]) =>
  downloadText(
    "profilesv2.csv",
    "﻿" + toCsvText([[PROFILE_LINK_HEADER], ...links.map((l) => [l])]),
    "text/csv;charset=utf-8",
  );

/** Finds profiles matching a description and writes the new ones to profilesv2.csv. */
export function ProfileSearch({ known, hasProfilesCsv, disabled, onScrape }: SearchProps) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ query: string; links: string[]; excluded: number } | null>(
    null,
  );
  const search = useServerFn(searchProfiles);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const r = await search({ data: { query, exclude: known, limit } });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setFound({ query, ...r.value });
      if (r.value.links.length) downloadV2(r.value.links);
      else toast("No new profiles found for that search");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Find profiles → profilesv2.csv</h2>
        <p className="hint mt-1">
          Describe the people you want, e.g. “data science recruiters”. Duplicates
          {hasProfilesCsv ? " and profiles already in the imported Profiles.csv" : ""} are removed.
          {!hasProfilesCsv &&
            " Import Profiles.csv on the Batch tab to also skip profiles you already have."}
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field h-10 flex-1"
          placeholder="data science recruiters"
          value={query}
          maxLength={300}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Profile search description"
        />
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Max
          <input
            type="number"
            min={1}
            max={100}
            className="field h-10 w-20 font-mono"
            value={limit}
            onChange={(e) => setLimit(Math.min(100, Math.max(1, Number(e.target.value) || 50)))}
            aria-label="Maximum profiles"
          />
        </label>
        <Button type="submit" className="h-10 px-5" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />}
          {busy ? "Searching…" : "Create profilesv2.csv"}
        </Button>
      </form>

      {found && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
            <span className="font-mono text-[12px]">
              “{found.query}” · {plural(found.links.length, "new profile")}
              {found.excluded ? ` · ${found.excluded} already in Profiles.csv skipped` : ""}
            </span>
            {found.links.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadV2(found.links)}>
                  <Download />
                  profilesv2.csv
                </Button>
                <Button
                  size="sm"
                  disabled={disabled}
                  title={disabled ? "Wait for the current batch to finish" : undefined}
                  onClick={() => onScrape({ name: "profilesv2.csv", links: found.links })}
                >
                  <ListPlus />
                  Scrape these
                </Button>
              </div>
            )}
          </div>
          {found.links.length > 0 && (
            <ol className="max-h-72 divide-y overflow-y-auto rounded-md border font-mono text-[12px]">
              {found.links.map((l) => (
                <li key={l} className="truncate px-3 py-2">
                  <a
                    href={l}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-primary hover:underline"
                  >
                    {l}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
