import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { proxyStatus, testConnection, testProxies } from "@/lib/linkedin.functions";
import { settings, useSettings } from "@/lib/settings";
import { detectProvider } from "@/lib/linkedin/providers";
import { type ProxyCheck, parseProxyList } from "@/lib/linkedin/proxy";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Profile Extractor" },
      { name: "description", content: "Configure the LinkedIn session and scraping options." },
      { property: "og:title", content: "Settings — Profile Extractor" },
      {
        property: "og:description",
        content: "Configure the LinkedIn session and scraping options.",
      },
    ],
  }),
  component: SettingsPage,
});

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
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
      const r = await test({
        data: {
          cookie: settings.getCookie(),
          timeoutSec: prefs.timeoutSec,
          proxies: settings.getProxies(),
        },
      });
      settings.setStatus(
        r.ok
          ? { state: "ok", at: r.value.checkedAt }
          : { state: "error", message: r.message, at: new Date().toISOString() },
      );
    } catch {
      settings.setStatus({
        state: "error",
        message: "Could not reach the server",
        at: new Date().toISOString(),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="hint mt-1 mb-8">Changes apply immediately.</p>

      <Section
        title="LinkedIn session"
        desc="Requests are made as the LinkedIn account these cookies belong to."
      >
        <div className="space-y-2">
          <label htmlFor="cookie" className="label">
            Cookie header
          </label>
          <div className="relative">
            <input
              id="cookie"
              type={show ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className="field pr-10 font-mono"
              placeholder={
                hasCookie
                  ? "•••••••• saved — paste a new value to replace"
                  : 'li_at=…; JSESSIONID="ajax:…"'
              }
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
            <code className="font-mono text-foreground">JSESSIONID</code>. Kept only in this browser
            tab and cleared when it closes. Never stored on the server.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!draft.trim()}>
            {hasCookie ? "Update" : "Save"}
          </Button>
          <Button variant="outline" onClick={runTest} disabled={!hasCookie || testing}>
            {testing && <Loader2 className="animate-spin" />}Test connection
          </Button>
          {hasCookie && (
            <Button
              variant="ghost"
              onClick={() => {
                settings.setCookie("");
                toast("Session cleared");
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {ready && (
          <div className="flex items-start gap-2 rounded-md border bg-secondary/50 px-3 py-2.5 text-[13px]">
            <span
              className={`dot mt-1.5 ${!hasCookie ? "bg-muted-foreground/50" : status.state === "ok" ? "bg-success" : status.state === "error" ? "bg-destructive" : "bg-warning"}`}
            />
            <div>
              <div className="font-medium">
                {!hasCookie
                  ? "Not configured"
                  : status.state === "ok"
                    ? "Connected"
                    : status.state === "error"
                      ? "Connection failed"
                      : "Saved, not yet tested"}
              </div>
              {status.message && <div className="text-muted-foreground">{status.message}</div>}
              {status.at && (
                <div className="font-mono text-[11px] text-muted-foreground">
                  Checked {new Date(status.at).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        )}
      </Section>

      <ProxySection />

      <RelaySection />

      <Section title="Scraping" desc="Applies to every scrape from this browser.">
        <div className="space-y-2">
          <label htmlFor="timeout" className="label">
            Request timeout
          </label>
          <div className="flex items-center gap-2">
            <input
              id="timeout"
              type="number"
              min={5}
              max={60}
              className="field w-24 font-mono"
              value={prefs.timeoutSec}
              onChange={(e) =>
                settings.setPrefs({
                  timeoutSec: Math.min(60, Math.max(5, Number(e.target.value) || 20)),
                })
              }
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
            <span className="hint">
              Re-scraping the same profile returns the cached copy and avoids extra LinkedIn
              requests.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Export" desc="Default format for single-profile and batch exports.">
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
  const { apiKey, ready } = useSettings();
  const [key, setKey] = useState("");
  useEffect(() => {
    if (ready) setKey(apiKey);
  }, [ready, apiKey]);
  const det = detectProvider(key);
  return (
    <Section
      title="Scraping API"
      desc="Optional. Used when the API key switch is on: the public profile page is fetched through your scraping provider."
    >
      <div className="space-y-2">
        <label htmlFor="apikey" className="label">
          Scraping API key
        </label>
        <input
          id="apikey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="field font-mono"
          placeholder="Paste a ScrapingBee, ScraperAPI or ZenRows key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="hint">
          {!key.trim() ? (
            "Provider is detected automatically. Prefix with e.g. scraperapi: if detection fails."
          ) : det ? (
            <>
              <span className="font-medium text-foreground">Detected: {det.name}</span>
              {det.note ? ` — ${det.note}` : ""}
            </>
          ) : (
            "Provider not recognized. Try prefixing with scrapingbee:, scraperapi: or zenrows:."
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            settings.setApiKey(key);
            toast.success("Saved for this tab");
          }}
        >
          Save
        </Button>
        {apiKey && (
          <Button
            variant="ghost"
            onClick={() => {
              settings.setApiKey("");
              toast("Cleared");
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </Section>
  );
}

function ProxySection() {
  const { proxyText, ready } = useSettings();
  const [draft, setDraft] = useState("");
  const [server, setServer] = useState<{ serverPool: number; required: boolean } | null>(null);
  const [checks, setChecks] = useState<ProxyCheck[] | null>(null);
  const [testing, setTesting] = useState(false);
  const status = useServerFn(proxyStatus);
  const test = useServerFn(testProxies);

  useEffect(() => {
    if (ready) setDraft(proxyText);
  }, [ready, proxyText]);
  useEffect(() => {
    status()
      .then(setServer)
      .catch(() => setServer(null));
  }, [status]);

  const { proxies, invalid } = parseProxyList(draft);
  const saved = parseProxyList(proxyText).proxies;
  const dirty = draft.trim() !== proxyText.trim();

  const runTest = async () => {
    setTesting(true);
    setChecks(null);
    try {
      const r = await test({ data: { proxies: saved } });
      if (r.ok) setChecks(r.value);
      else toast.error(r.message);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setTesting(false);
    }
  };

  const serverNote = !server
    ? null
    : server.serverPool
      ? `The server has ${server.serverPool} prox${server.serverPool === 1 ? "y" : "ies"} configured (PROXY_URLS); a list saved here replaces it for this tab.`
      : server.required
        ? "The server requires a proxy (PROXY_REQUIRED) and has none configured: add at least one here."
        : "The server has no proxies configured; without a list here, requests go direct.";

  return (
    <Section
      title="Proxies"
      desc="Optional. Routes cookie-session requests to LinkedIn through your HTTP(S) proxies. Each LinkedIn session sticks to one proxy; a proxy that fails or gets blocked is benched and the next one is used."
    >
      <div className="space-y-2">
        <label htmlFor="proxies" className="label">
          Proxy list
        </label>
        <textarea
          id="proxies"
          rows={4}
          autoComplete="off"
          spellCheck={false}
          className="field min-h-24 py-2 font-mono"
          placeholder={"http://user:pass@host:port\nhost:port:user:pass"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="hint">
          One per line. Kept only in this browser tab.
          {draft.trim() &&
            ` ${proxies.length} valid${invalid.length ? `, ${invalid.length} not recognized: ${invalid.slice(0, 3).join(", ")}` : ""}.`}
        </p>
        {serverNote && <p className="hint">{serverNote}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!dirty || invalid.length > 0}
          onClick={() => {
            settings.setProxyText(draft);
            setChecks(null);
            toast.success(proxies.length ? "Proxies saved for this tab" : "Proxies cleared");
          }}
        >
          Save
        </Button>
        <Button
          variant="outline"
          onClick={() => void runTest()}
          disabled={testing || dirty || (!saved.length && !server?.serverPool)}
          title={dirty ? "Save first" : undefined}
        >
          {testing && <Loader2 className="animate-spin" />}
          Test proxies
        </Button>
        {proxyText && (
          <Button
            variant="ghost"
            onClick={() => {
              settings.setProxyText("");
              setChecks(null);
              toast("Proxies cleared");
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {checks && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-[13px]">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 font-medium">Proxy</th>
                <th className="px-3 py-2 font-medium">Exit IP</th>
                <th className="px-3 py-2 font-medium">Latency</th>
                <th className="px-3 py-2 font-medium">LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.proxy} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-[12px]">
                    <span className={`dot mr-2 ${c.ok ? "bg-success" : "bg-destructive"}`} />
                    {c.proxy}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{c.ip ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">
                    {c.ms != null ? `${c.ms} ms` : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.error ?? (c.linkedin != null ? `HTTP ${c.linkedin}` : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
