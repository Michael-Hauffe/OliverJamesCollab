import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ProfilePayload, Result } from "./linkedin/types";
import {
  ScrapeError,
  scrape,
  scrapePublic,
  scrapeNoSession,
  searchProfileLinks,
  testSession,
} from "./linkedin/scraper.server";
import { detectProvider, stripPrefix } from "./linkedin/providers";

const opts = {
  cookie: z.string().max(20000),
  timeoutSec: z.number().min(5).max(60).default(20),
};

function fail(e: unknown): Result<never> {
  if (e instanceof ScrapeError) return { ok: false, code: e.code, message: e.message };
  // Never log or echo raw errors: they could contain request data.
  console.error("scrape: unexpected error", e instanceof Error ? e.name : "unknown");
  return { ok: false, code: "internal_error", message: "Unexpected server error" };
}

export const scrapeProfile = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        url: z.string().max(2048),
        mode: z.enum(["public", "api", "cookie"]).default("public"),
        useCache: z.boolean().default(true),
        apiKey: z.string().max(500).default(""),
        ...opts,
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<Result<ProfilePayload>> => {
    try {
      const timeoutMs = data.timeoutSec * 1000;
      if (data.mode === "cookie")
        return {
          ok: true,
          value: await scrape({
            url: data.url,
            cookie: data.cookie,
            timeoutMs,
            useCache: data.useCache,
          }),
        };
      if (data.mode === "api") {
        const d = detectProvider(data.apiKey);
        if (!d?.supported)
          throw new ScrapeError(
            "missing_api_key",
            d?.note ?? "No supported scraping API key configured",
          );
        const relay = { id: d.id, key: encodeURIComponent(stripPrefix(data.apiKey)) };
        return { ok: true, value: await scrapePublic({ url: data.url, relay, timeoutMs }) };
      }
      return { ok: true, value: await scrapeNoSession({ url: data.url, timeoutMs }) };
    } catch (e) {
      return fail(e);
    }
  });

export const testConnection = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object(opts).parse(d))
  .handler(async ({ data }): Promise<Result<{ checkedAt: string }>> => {
    try {
      await testSession(data.cookie, data.timeoutSec * 1000);
      return { ok: true, value: { checkedAt: new Date().toISOString() } };
    } catch (e) {
      return fail(e);
    }
  });

export const searchProfiles = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        query: z.string().min(1).max(300),
        exclude: z.array(z.string().max(2048)).max(10000).default([]),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<Result<{ links: string[]; excluded: number }>> => {
    try {
      return { ok: true, value: await searchProfileLinks({ ...data, timeoutMs: 30000 }) };
    } catch (e) {
      return fail(e);
    }
  });
