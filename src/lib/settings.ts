import { useEffect, useState } from "react";
import { parseProxyList } from "./linkedin/proxy";

/**
 * Cookie, API key and proxies: tab-scoped sessionStorage only (cleared when the tab closes), sent per request.
 * Never written to localStorage. Non-secret preferences go to localStorage.
 */
export type Prefs = { timeoutSec: number; useCache: boolean; exportFormat: "json" | "csv" };
export type ConnStatus = { state: "unknown" | "ok" | "error"; message?: string; at?: string };

const COOKIE_KEY = "lps.cookie";
const API_KEY = "lps.apikey";
const PROXIES_KEY = "lps.proxies";
const PREFS_KEY = "lps.prefs";
const STATUS_KEY = "lps.status";
const DEFAULT_PREFS: Prefs = { timeoutSec: 20, useCache: true, exportFormat: "json" };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read<T>(store: Storage, key: string, fallback: T): T {
  try {
    const v = store.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

export const settings = {
  getCookie: () =>
    typeof window === "undefined" ? "" : (sessionStorage.getItem(COOKIE_KEY) ?? ""),
  setCookie(v: string) {
    if (v.trim()) sessionStorage.setItem(COOKIE_KEY, v.trim());
    else sessionStorage.removeItem(COOKIE_KEY);
    sessionStorage.removeItem(STATUS_KEY);
    emit();
  },
  getApiKey: () => (typeof window === "undefined" ? "" : (sessionStorage.getItem(API_KEY) ?? "")),
  setApiKey(v: string) {
    if (v.trim()) sessionStorage.setItem(API_KEY, v.trim());
    else sessionStorage.removeItem(API_KEY);
    emit();
  },
  /** Raw proxy list as typed (one per line). */
  getProxyText: () =>
    typeof window === "undefined" ? "" : (sessionStorage.getItem(PROXIES_KEY) ?? ""),
  /** Valid, normalized proxies to send with requests. */
  getProxies: () => parseProxyList(settings.getProxyText()).proxies,
  setProxyText(v: string) {
    if (v.trim()) sessionStorage.setItem(PROXIES_KEY, v.trim());
    else sessionStorage.removeItem(PROXIES_KEY);
    sessionStorage.removeItem(STATUS_KEY);
    emit();
  },
  getPrefs: () =>
    typeof window === "undefined" ? DEFAULT_PREFS : read(localStorage, PREFS_KEY, DEFAULT_PREFS),
  setPrefs(p: Partial<Prefs>) {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...settings.getPrefs(), ...p }));
    emit();
  },
  getStatus: (): ConnStatus =>
    typeof window === "undefined"
      ? { state: "unknown" }
      : read(sessionStorage, STATUS_KEY, { state: "unknown" } as ConnStatus),
  setStatus(s: ConnStatus) {
    sessionStorage.setItem(STATUS_KEY, JSON.stringify(s));
    emit();
  },
};

export function useSettings() {
  const [snap, setSnap] = useState({
    hasCookie: false,
    apiKey: "",
    proxyText: "",
    proxyCount: 0,
    prefs: DEFAULT_PREFS,
    status: { state: "unknown" } as ConnStatus,
    ready: false,
  });
  useEffect(() => {
    const sync = () =>
      setSnap({
        hasCookie: !!settings.getCookie(),
        apiKey: settings.getApiKey(),
        proxyText: settings.getProxyText(),
        proxyCount: settings.getProxies().length,
        prefs: settings.getPrefs(),
        status: settings.getStatus(),
        ready: true,
      });
    sync();
    listeners.add(sync);
    return () => void listeners.delete(sync);
  }, []);
  return snap;
}
