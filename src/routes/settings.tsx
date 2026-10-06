import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { testConnection } from "@/lib/linkedin.functions";
import { settings, useSettings } from "@/lib/settings";
import { detectProvider, normalizeProxy } from "@/lib/linkedin/providers";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Profile Extractor" },
      { name: "description", content: "Configure the LinkedIn session and scraping options." },
      { property: "og:title", content: "Settings — Profile Extractor" },
      { property: "og:description", content: "Configure the LinkedIn session and scraping options." },
    ],
  }),
  component: SettingsPage,
});

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-t py-8 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="hint mt-1">{desc}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function SettingsPage() {
  const { hasCookie, prefs, status, ready } = useSettings();
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const test = useServerFn(testConnection);

  useEffect(() => setDraft(""), [hasCookie]);

  const save = () => {
    settings.setCookie(draft);
    toast.success(draft.trim() ? "Session saved for this tab" : "Session cleared");
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await test({ data: { cookie: settings.getCookie(), timeoutSec: prefs.timeoutSec } });
      settings.setStatus(r.ok ? { state: "ok", at: r.value.checkedAt } : { state: "error", message: r.message, at: new Date().toISOString() });
    } catch {
      settings.setStatus({ state: "error", message: "Could not reach the server", at: new Date().toISOString() });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="hint mt-1 mb-8">Changes apply immediately.</p>

      <Section title="LinkedIn session" desc="Requests are made as the LinkedIn account these cookies belong to.">
        <div className="space-y-2">
          <label htmlFor="cookie" className="label">Cookie header</label>
          <div className="relative">
            <input
              id="cookie"
              type={show ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className="field pr-10 font-mono"
              placeholder={hasCookie ? "•••••••• saved — paste a new value to replace" : 'li_at=…; JSESSIONID="ajax:…"'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide value" : "Show value"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p className="hint">
            Must include <code className="font-mono text-foreground">li_at</code> and{" "}
            <code className="font-mono text-foreground">JSESSIONID</code>. Kept only in this browser tab and cleared when
            it closes. Never stored on the server.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!draft.trim()}>{hasCookie ? "Update" : "Save"}</Button>
          <Button variant="outline" onClick={runTest} disabled={!hasCookie || testing}>
            {testing && <Loader2 className="animate-spin" />}Test connection
          </Button>
          {hasCookie && (
            <Button variant="ghost" onClick={() => { settings.setCookie(""); toast("Session cleared"); }}>Clear</Button>
          )}
        </div>
        {ready && (
          <div className="flex items-start gap-2 rounded-md border bg-secondary/50 px-3 py-2.5 text-[13px]">
            <span className={`dot mt-1.5 ${!hasCookie ? "bg-muted-foreground/50" : status.state === "ok" ? "bg-success" : status.state === "error" ? "bg-destructive" : "bg-warning"}`} />
            <div>
              <div className="font-medium">
                {!hasCookie ? "Not configured" : status.state === "ok" ? "Connected" : status.state === "error" ? "Connection failed" : "Saved, not yet tested"}
              </div>
              {status.message && <div className="text-muted-foreground">{status.message}</div>}
              {status.at && <div className="font-mono text-[11px] text-muted-foreground">Checked {new Date(status.at).toLocaleTimeString()}</div>}
            </div>
          </div>
        )}
      </Section>

      <RelaySection />

      <Section title="Scraping" desc="Applies to every scrape from this browser.">
        <div className="space-y-2">
          <label htmlFor="timeout" className="label">Request timeout</label>
          <div className="flex items-center gap-2">
            <input
              id="timeout"
              type="number"
              min={5}
              max={60}
              className="field w-24 font-mono"
              value={prefs.timeoutSec}
              onChange={(e) => settings.setPrefs({ timeoutSec: Math.min(60, Math.max(5, Number(e.target.value) || 20)) })}
            />
            <span className="hint">seconds per LinkedIn request (5–60)</span>
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={prefs.useCache}
            onChange={(e) => settings.setPrefs({ useCache: e.target.checked })}
          />
          <span>
            <span className="label block">Cache results for 10 minutes</span>
            <span className="hint">Re-scraping the same profile returns the cached copy and avoids extra LinkedIn requests.</span>
          </span>
        </label>
      </Section>

      <Section title="Export" desc="Default format for the download button.">
        <div className="inline-flex rounded-md border bg-card p-0.5">
          {(["json", "csv"] as const).map((f) => (
            <button
              key={f}
              onClick={() => settings.setPrefs({ exportFormat: f })}
              className={`rounded px-4 py-1.5 font-mono text-xs uppercase transition-colors ${prefs.exportFormat === f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function RelaySection() {
  const { apiKey, proxy, ready } = useSettings();
  const [key, setKey] = useState("");
  const [px, setPx] = useState("");
  useEffect(() => { if (ready) { setKey(apiKey); setPx(proxy); } }, [ready, apiKey, proxy]);
  const det = detectProvider(key);
  const proxyOk = !px.trim() || !!normalizeProxy(px);
  return (
    <Section title="Scraping API & proxy" desc="Optional. Requests go through your scraping API first; if it fails or its free quota runs out, the app switches to your LinkedIn session automatically.">
      <div className="space-y-2">
        <label htmlFor="apikey" className="label">Scraping API key</label>
        <input id="apikey" type="password" autoComplete="off" spellCheck={false} className="field font-mono"
          placeholder="Paste a ScrapingBee, ScraperAPI, ZenRows or RapidAPI key" value={key} onChange={(e) => setKey(e.target.value)} />
        <p className="hint">
          {!key.trim() ? "Provider is detected automatically. Prefix with e.g. scraperapi: if detection fails."
            : det ? <><span className="font-medium text-foreground">Detected: {det.name}</span>{det.note ? ` — ${det.note}` : ""}</>
            : "Provider not recognized — session scraping will be used. Try prefixing with scrapingbee:, scraperapi: or zenrows:."}
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="proxy" className="label">Proxy</label>
        <input id="proxy" type="password" autoComplete="off" spellCheck={false} className="field font-mono"
          placeholder="http://user:pass@host:port  or  host:port:user:pass" value={px} onChange={(e) => setPx(e.target.value)} />
        <p className="hint">{proxyOk ? "Used with ScrapingBee (own proxy). Direct session requests can't use a proxy on this hosting." : "Format not recognized."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!proxyOk} onClick={() => { settings.setApiKey(key); settings.setProxy(px); toast.success("Saved for this tab"); }}>Save</Button>
        {(apiKey || proxy) && <Button variant="ghost" onClick={() => { settings.setApiKey(""); settings.setProxy(""); toast("Cleared"); }}>Clear</Button>}
      </div>
    </Section>
  );
}
