import { useEffect, useState } from "react";

/**
 * Cookie: tab-scoped sessionStorage only (cleared when the tab closes), sent per request.
 * Never written to localStorage. Non-secret preferences go to localStorage.
 */
export type Prefs = { timeoutSec: number; useCache: boolean; exportFormat: "json" | "csv" };
export type ConnStatus = { state: "unknown" | "ok" | "error"; message?: string; at?: string };

const COOKIE_KEY = "lps.cookie";
const API_KEY = "lps.apikey";
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
    prefs: DEFAULT_PREFS,
    status: { state: "unknown" } as ConnStatus,
    ready: false,
  });
  useEffect(() => {
    const sync = () =>
      setSnap({
        hasCookie: !!settings.getCookie(),
        apiKey: settings.getApiKey(),
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
