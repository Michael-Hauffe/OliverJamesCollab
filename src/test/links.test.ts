import { describe, expect, it } from "vitest";
import { dedupeLinks, nextDelayMs } from "@/lib/batch";
import { profileSlug } from "@/lib/linkedin/links";

describe("profileSlug", () => {
  it("canonicalizes profile URLs", () => {
    expect(profileSlug("https://www.linkedin.com/in/Jane-Doe/")).toBe("jane-doe");
    expect(profileSlug("uk.linkedin.com/in/jane-doe/details/skills")).toBe("jane-doe");
    expect(profileSlug("http://linkedin.com/in/jane-doe?trk=x")).toBe("jane-doe");
  });

  it("rejects non-profile links", () => {
    expect(profileSlug("https://www.linkedin.com/company/acme")).toBeNull();
    expect(profileSlug("https://evil.com/in/jane-doe")).toBeNull();
    expect(profileSlug("https://linkedin.com.evil.com/in/jane-doe")).toBeNull();
    expect(profileSlug("")).toBeNull();
  });
});

describe("dedupeLinks", () => {
  it("drops the same profile written different ways, keeps unrecognized links", () => {
    expect(
      dedupeLinks([
        "linkedin.com/in/jane",
        "https://www.linkedin.com/in/JANE/",
        "not a link",
        "not a link",
      ]),
    ).toEqual(["linkedin.com/in/jane", "not a link"]);
  });
});

describe("nextDelayMs", () => {
  it("is 5 s ± 3 s", () => {
    expect(nextDelayMs(() => 0)).toBe(2000);
    expect(nextDelayMs(() => 0.5)).toBe(5000);
    expect(nextDelayMs(() => 1)).toBe(8000);
  });
});
