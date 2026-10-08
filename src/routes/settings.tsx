import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { proxyStatus, testConnection, testProxies } from "@/lib/linkedin.functions";
import { type ConnStatus, settings, useSettings } from "@/lib/settings";
import { detectProvider } from "@/lib/linkedin/providers";
import { type ProxyCheck, maskProxy, parseProxyList } from "@/lib/linkedin/proxy";

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

/**
 * Credential input shared by the session, proxy and API key fields: masked by default with a
 * show/hide toggle, and empty once saved, with the placeholder saying a value is stored.
 */
function SecretField({
  id,
  value,
  onChange,
  saved,
  savedLabel = "•••••••• saved — paste a new value to replace",
  placeholder,
  multiline = false,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  saved: boolean;
  savedLabel?: string;
  placeholder: string;
  multiline?: boolean;
}) {
  const [show, setShow] = useState(false);
  const common = {
    id,
    autoComplete: "off",
    spellCheck: false,
    placeholder: saved ? savedLabel : placeholder,
    value,
  };
  return (
    <div className="relative">
      {multiline ? (
        <textarea
          {...common}
          rows={4}
          // Textareas have no password type; mask the characters instead.
          className={`field min-h-24 py-2 pr-10 font-mono ${show ? "" : "[-webkit-text-security:disc]"}`}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          type={show ? "text" : "password"}
          className="field pr-10 font-mono"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className={`absolute right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground ${multiline ? "top-0 h-9" : "inset-y-0"}`}
        aria-label={show ? "Hide value" : "Show value"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Status line under a credential: grey when not configured, amber until tested, then green/red. */
function StatusBox({
  configured,
  status,
  labels,
  detail,
}: {
  configured: boolean;
  status: ConnStatus;
  labels: { none: string; untested: string; ok: string; error: string };
  detail?: React.ReactNode;
}) {
  const tone = !configured
    ? "bg-muted-foreground/50"
    : status.state === "ok"
      ? "bg-success"
      : status.state === "error"
        ? "bg-destructive"
        : "bg-warning";
  const title = !configured
    ? labels.none
    : status.state === "ok"
      ? labels.ok
      : status.state === "error"
        ? labels.error
        : labels.untested;
  return (
    <div className="flex items-start gap-2 rounded-md border bg-secondary/50 px-3 py-2.5 text-[13px]">
      <span className={`dot mt-1.5 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {configured && status.message && (
          <div className="text-muted-foreground">{status.message}</div>
        )}
        {detail && <div className="text-muted-foreground">{detail}</div>}
        {configured && status.at && (
          <div className="font-mono text-[11px] text-muted-foreground">
            Checked {new Date(status.at).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPage() {
  const { hasCookie, prefs, status, ready } = useSettings();
  const [draft, setDraft] = useState("");
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
          <SecretField
            id="cookie"
            value={draft}
            onChange={setDraft}
            saved={hasCookie}
            placeholder={'li_at=…; JSESSIONID="ajax:…"'}
          />
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
          <StatusBox
            configured={hasCookie}
            status={status}
            labels={{
              none: "Not configured",
              untested: "Saved, not yet tested",
              ok: "Connected",
              error: "Connection failed",
            }}
          />
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
  useEffect(() => setKey(""), [apiKey]);
  const det = detectProvider(key);
  const savedDet = detectProvider(apiKey);
  return (
    <Section
      title="Scraping API"
      desc="Optional. Used when the API key switch is on: the public profile page is fetched through your scraping provider."
    >
      <div className="space-y-2">
        <label htmlFor="apikey" className="label">
          Scraping API key
        </label>
        <SecretField
          id="apikey"
          value={key}
          onChange={setKey}
          saved={!!apiKey}
          placeholder="Paste a ScrapingBee, ScraperAPI or ZenRows key"
        />
        <p className="hint">
          {!key.trim() ? (
            "Provider is detected automatically. Prefix with e.g. scraperapi: if detection fails. Kept only in this browser tab."
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
          disabled={!key.trim()}
          onClick={() => {
            settings.setApiKey(key);
            toast.success("API key saved for this tab");
          }}
        >
          {apiKey ? "Update" : "Save"}
        </Button>
        {apiKey && (
          <Button
            variant="ghost"
            onClick={() => {
              settings.setApiKey("");
              toast("API key cleared");
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {ready && (
        <StatusBox
          configured={!!apiKey}
          status={
            apiKey && !savedDet?.supported
              ? { state: "error", message: savedDet?.note ?? "Provider not recognized" }
              : { state: apiKey ? "ok" : "unknown" }
          }
          labels={{
            none: "Not configured",
            untested: "Saved",
            ok: `Saved — ${savedDet?.name ?? ""}`,
            error: "Saved, but can't be used",
          }}
        />
      )}
    </Section>
  );
}

function ProxySection() {
  const { proxyText, proxyStatus: tested, ready } = useSettings();
  const [draft, setDraft] = useState("");
  const [server, setServer] = useState<{ serverPool: number; required: boolean } | null>(null);
  const [checks, setChecks] = useState<ProxyCheck[] | null>(null);
  const [testing, setTesting] = useState(false);
  const status = useServerFn(proxyStatus);
  const test = useServerFn(testProxies);

  useEffect(() => setDraft(""), [proxyText]);
  useEffect(() => {
    status()
      .then(setServer)
      .catch(() => setServer(null));
  }, [status]);

  const { proxies, invalid } = parseProxyList(draft);
  const saved = parseProxyList(proxyText).proxies;

  const runTest = async () => {
    setTesting(true);
    setChecks(null);
    try {
      const r = await test({ data: { proxies: saved } });
      const at = new Date().toISOString();
      if (r.ok) {
        setChecks(r.value);
        const working = r.value.filter((c) => c.ok).length;
        settings.setProxyStatus({
          state: working ? "ok" : "error",
          message: `${working} of ${r.value.length} working`,
          at,
        });
      } else settings.setProxyStatus({ state: "error", message: r.message, at });
    } catch {
      settings.setProxyStatus({
        state: "error",
        message: "Could not reach the server",
        at: new Date().toISOString(),
      });
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
        <SecretField
          id="proxies"
          multiline
          value={draft}
          onChange={setDraft}
          saved={saved.length > 0}
          savedLabel={`•••••••• ${saved.length} prox${saved.length === 1 ? "y" : "ies"} saved — paste a new list to replace`}
          placeholder={"http://user:pass@host:port\nhost:port:user:pass"}
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
          disabled={!proxies.length || invalid.length > 0}
          onClick={() => {
            settings.setProxyText(draft);
            setChecks(null);
            toast.success(
              `${proxies.length} prox${proxies.length === 1 ? "y" : "ies"} saved for this tab`,
            );
          }}
        >
          {saved.length ? "Update" : "Save"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void runTest()}
          disabled={testing || (!saved.length && !server?.serverPool)}
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
      {ready && (
        <StatusBox
          configured={saved.length > 0 || !!server?.serverPool}
          status={tested}
          labels={{
            none: server?.required
              ? "Required, but none configured"
              : "Not configured — requests go direct",
            untested: saved.length
              ? `${saved.length} prox${saved.length === 1 ? "y" : "ies"} saved, not yet tested`
              : "Using the server's proxies, not yet tested",
            ok: "Proxies working",
            error: "Proxies failing",
          }}
          detail={
            saved.length > 0 && (
              <span className="font-mono text-[12px]">{saved.map(maskProxy).join(", ")}</span>
            )
          }
        />
      )}
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
