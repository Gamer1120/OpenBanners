import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The meta service fills the banner's tags server-side and the app loads the
// banner itself: the shell must not ask Bannergress for it a second time. The
// shell's own script is public/head.js (no inline scripts, for the CSP).
test("index.html makes no Bannergress request of its own", () => {
  const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
  const head = readFileSync(resolve(__dirname, "../public/head.js"), "utf8");
  for (const source of [html, head]) {
    expect(source).not.toMatch(/api\.bannergress\.com/);
    expect(source).not.toMatch(/fetch\(/);
  }
  expect(html).toMatch(/<script src="\/head\.js"><\/script>/);
  expect(head).toMatch(/canonicalLink\.setAttribute\("href", currentUrl\)/);
});
