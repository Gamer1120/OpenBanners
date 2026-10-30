import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Content-Security-Policy (docker/openbanners-security-headers.conf) is
// script-src 'self': an inline <script> would be blocked in production.
describe("HTML pages have no inline scripts", () => {
  for (const file of ["../index.html", "../public/bannergress-auth-callback.html"]) {
    it(file, () => {
      const html = readFileSync(resolve(__dirname, file), "utf8");
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const tag of scripts) {
        expect(tag).toMatch(/\ssrc=/);
      }
      expect(html).not.toMatch(/\son[a-z]+=/i);
    });
  }
});
