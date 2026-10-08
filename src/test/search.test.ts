import { afterEach, describe, expect, it, vi } from "vitest";
import { searchProfileLinks } from "@/lib/linkedin/scraper.server";
import { toBatchCsv } from "@/lib/export";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("searchProfileLinks", () => {
  it("dedupes results and skips profiles already in Profiles.csv", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test");
    const web = [
      { url: "https://www.linkedin.com/in/alice" },
      { url: "https://uk.linkedin.com/in/Alice/" },
      { url: "https://www.linkedin.com/in/bob" },
      { url: "https://www.linkedin.com/jobs/view/123" },
      { url: "https://www.linkedin.com/in/carol" },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { web } })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await searchProfileLinks({
      query: "data science recruiters",
      exclude: ["linkedin.com/in/BOB"],
      limit: 10,
      timeoutMs: 1000,
    });
    expect(r.links).toEqual([
      "https://www.linkedin.com/in/alice",
      "https://www.linkedin.com/in/carol",
    ]);
    expect(r.excluded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops querying once the limit is reached", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { web: [{ url: "https://linkedin.com/in/alice" }] } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await searchProfileLinks({ query: "x", exclude: [], limit: 1, timeoutMs: 1000 });
    expect(r.links).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("toBatchCsv", () => {
  it("keys every row by input link and records failures", () => {
    const csv = toBatchCsv([
      {
        link: "linkedin.com/in/x",
        ok: false,
        code: "profile_not_found",
        message: "Profile not found",
      },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "profile_link,section,title,organization,detail,start,end,location,description",
      "linkedin.com/in/x,error,profile_not_found,,Profile not found,,,,",
    ]);
  });
});
