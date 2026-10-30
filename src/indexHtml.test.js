import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The meta service fills the banner's tags server-side and the app loads the
// banner itself: the shell must not ask Bannergress for it a second time.
test("index.html makes no Bannergress request of its own", () => {
  const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
  expect(html).not.toMatch(/api\.bannergress\.com/);
  expect(html).not.toMatch(/fetch\(/);
  expect(html).toMatch(/canonicalLink\.setAttribute\("href", currentUrl\)/);
});
