import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isKnownPath, matchPage, PAGES } from "../server/page-meta.mjs";

// Link previews come from server/page-meta.mjs. A new page in App.jsx needs an
// entry there too, or its links would preview as the plain home page.
describe("link previews", () => {
  const appSource = readFileSync(resolve(__dirname, "App.jsx"), "utf8");
  // path="*" is the "Page not found" route: no preview, the server sends 404.
  const routes = [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1]).filter((route) => route !== "*");

  it("has a catch-all route that the server answers with 404", () => {
    expect(appSource).toContain('path="*"');
    expect(matchPage("/no/such/page")).toBeNull();
    expect(isKnownPath("/no/such/page")).toBe(false);
    expect(isKnownPath("/search/" + "x".repeat(300))).toBe(true);
    expect(isKnownPath("/Map?x=1")).toBe(true);
  });

  it("finds the app's routes", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("has a preview for %s", (route) => {
    expect(PAGES.map((page) => page.path)).toContain(route);
    const example = route.replace(/:([A-Za-z]+)/g, "example-$1");
    expect(matchPage(example)?.page.path).toBe(route);
  });
});
