import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./bannergressSync";

describe("safeReturnPath", () => {
  it("keeps paths on this site", () => {
    expect(safeReturnPath("/banner/abc?x=1#m")).toBe("/banner/abc?x=1#m");
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/banner/st-paulus-dom-m%C3%BCnster-4d07")).toBe(
      "/banner/st-paulus-dom-m%C3%BCnster-4d07"
    );
  });

  it("falls back to / for anything that could leave the site", () => {
    for (const value of [
      null,
      undefined,
      42,
      "",
      "evil",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "data:text/html,x",
      " /x",
      "/" + "a".repeat(3000),
    ]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });
});
