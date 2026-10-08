import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, readProfileLinks, toCsvText } from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    expect(parseCsv('﻿a,"b,c"\r\n"say ""hi""",d\n\n')).toEqual([
      ["a", "b,c"],
      ['say "hi"', "d"],
    ]);
  });
});

describe("readProfileLinks", () => {
  it("reads the Profile Link column", () => {
    expect(
      readProfileLinks(
        "Profile Link,Name\nhttps://www.linkedin.com/in/jane-doe,Jane\n,\nlinkedin.com/in/bob,Bob",
      ),
    ).toEqual(["https://www.linkedin.com/in/jane-doe", "linkedin.com/in/bob"]);
  });

  it("finds the header case-insensitively in any column", () => {
    expect(readProfileLinks("Name,profile link\nJane,linkedin.com/in/jane-doe")).toEqual([
      "linkedin.com/in/jane-doe",
    ]);
  });

  it("falls back to column A when there is no header row", () => {
    expect(readProfileLinks("linkedin.com/in/jane-doe\nlinkedin.com/in/bob")).toHaveLength(2);
  });
});

describe("csvCell", () => {
  it("neutralizes spreadsheet formulas and quotes when needed", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
    expect(toCsvText([["Profile Link"], ["x"]])).toBe("Profile Link\r\nx");
  });
});
