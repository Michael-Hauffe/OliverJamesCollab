import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Search, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FATAL, dedupeLinks, nextDelayMs, sleep } from "@/lib/batch";
import { PROFILE_LINK_HEADER, downloadText, readProfileLinks, toCsvText } from "@/lib/csv";
import { type BatchItem, downloadBatch } from "@/lib/export";
import { searchProfiles } from "@/lib/linkedin.functions";
import type { ProfilePayload, Result } from "@/lib/linkedin/types";

type Props = {
  scrapeOne: (url: string) => Promise<Result<ProfilePayload>>;
  format: "json" | "csv";
  setFmt: (f: "json" | "csv") => void;
};

/** Profiles.csv batch scraping and profilesv2.csv generation from a people search. */
export function BatchTools({ scrapeOne, format, setFmt }: Props) {
  const [file, setFile] = useState<{ name: string; links: string[] } | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [waitMs, setWaitMs] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const links = dedupeLinks(readProfileLinks(await f.text()));
    setFile({ name: f.name, links });
    setItems([]);
    if (links.length)
      toast.success(
        `Loaded ${links.length} profile${links.length === 1 ? "" : "s"} from ${f.name}`,
      );
    else toast.error(`No links found under a "${PROFILE_LINK_HEADER}" header in ${f.name}`);
  };

  const runBatch = async () => {
    if (!file?.links.length) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setRunning(true);
    setItems([]);
    for (let i = 0; i < file.links.length && !ctl.signal.aborted; i++) {
      const link = file.links[i]!;
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
      if (i < file.links.length - 1) {
        const ms = nextDelayMs();
        setWaitMs(ms);
        await sleep(ms, ctl.signal);
        setWaitMs(null);
      }
    }
    setWaitMs(null);
    setRunning(false);
  };

  const done = items.filter((i) => i.ok).length;
  const total = file?.links.length ?? 0;

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
          {file && (
            <span className="font-mono text-[12px] text-muted-foreground">
              {file.name} · {total} profile{total === 1 ? "" : "s"}
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
                Scrape all
              </Button>
            )}
          </div>
        </div>

        {(running || items.length > 0) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
              {running && <Loader2 className="size-4 animate-spin" />}
              <span className="font-mono text-[12px]">
                {items.length}/{total} processed · {done} ok · {items.length - done} failed
              </span>
              {waitMs != null && (
                <span className="font-mono text-[12px]">pausing {(waitMs / 1000).toFixed(1)}s</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={format}
                  onChange={(e) => setFmt(e.target.value as "json" | "csv")}
                  className="field h-8 w-auto py-0 pr-7 font-mono text-xs uppercase"
                  aria-label="Batch export format"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
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
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className={`dot ${it.ok ? "bg-success" : "bg-destructive"}`} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{it.link}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {it.ok
                      ? it.payload.data.name.full || it.payload.data.public_identifier
                      : it.code}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <ProfileSearch exclude={file?.links ?? []} hasProfilesCsv={!!file} />
    </div>
  );
}

function ProfileSearch({
  exclude,
  hasProfilesCsv,
}: {
  exclude: string[];
  hasProfilesCsv: boolean;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const search = useServerFn(searchProfiles);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setSummary(null);
    try {
      const r = await search({ data: { query, exclude, limit } });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      const { links, excluded } = r.value;
      const skipped = excluded ? ` · ${excluded} already in Profiles.csv skipped` : "";
      setSummary(`${links.length} new profile${links.length === 1 ? "" : "s"}${skipped}`);
      if (links.length)
        downloadText(
          "profilesv2.csv",
          "\ufeff" + toCsvText([[PROFILE_LINK_HEADER], ...links.map((l) => [l])]),
          "text/csv;charset=utf-8",
        );
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
          {!hasProfilesCsv && " Import Profiles.csv above to skip profiles you already have."}
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
      {summary && <p className="font-mono text-[12px] text-muted-foreground">{summary}</p>}
    </section>
  );
}
