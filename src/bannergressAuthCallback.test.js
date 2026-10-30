import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BANNERGRESS_AUTH_PENDING_STORAGE_KEY,
  BANNERGRESS_AUTH_STORAGE_KEY,
} from "./bannergressSync";

// public/bannergress-auth-callback.html must find the PKCE data the app saved,
// also when window.opener and window.name are gone (the installed app opens
// the sign-in in a Chrome custom tab).
const html = readFileSync(resolve(__dirname, "../public/bannergress-auth-callback.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const LEGACY_PENDING_KEY = "openbanners-bannergress-auth-pending";

async function runCallback(search) {
  window.history.replaceState({}, "", `/bannergress-auth-callback.html${search}`);
  document.body.innerHTML = '<h1 id="title"></h1><p id="message"></p>';
  new Function(script)();
  await vi.waitFor(() => expect(document.getElementById("title").textContent).not.toBe(""));
}

describe("bannergress-auth-callback.html", () => {
  let fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    window.name = "";
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 300, refresh_expires_in: 1800 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "close").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("reads the key the app writes", () => {
    expect(script).toContain(`"${BANNERGRESS_AUTH_PENDING_STORAGE_KEY}"`);
    expect(script).toContain(`"${BANNERGRESS_AUTH_STORAGE_KEY}"`);
  });

  for (const key of [BANNERGRESS_AUTH_PENDING_STORAGE_KEY, LEGACY_PENDING_KEY]) {
    it(`finishes sign-in from localStorage alone (${key})`, async () => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ state: "s1", codeVerifier: "verifier", redirectUri: "https://openbanners.org/bannergress-auth-callback.html" })
      );

      await runCallback("?code=c1&state=s1");

      expect(document.getElementById("title").textContent).toBe("Bannergress sign-in complete");
      expect(String(fetchMock.mock.calls[0][1].body)).toContain("code_verifier=verifier");
      expect(JSON.parse(window.localStorage.getItem(BANNERGRESS_AUTH_STORAGE_KEY)).accessToken).toBe("access");
      expect(window.localStorage.getItem(BANNERGRESS_AUTH_PENDING_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
    });
  }

  it("links back to the page where the sign-in started, and returns there after a same-tab sign-in", async () => {
    window.localStorage.setItem(
      BANNERGRESS_AUTH_PENDING_STORAGE_KEY,
      JSON.stringify({ state: "s1", codeVerifier: "verifier", mode: "redirect", returnTo: "/banner/abc?x=1" })
    );
    window.history.replaceState({}, "", "/bannergress-auth-callback.html?code=***&state=s1");
    document.body.innerHTML = '<h1 id="title"></h1><p id="message"></p><a id="back" href="/">Back</a>';
    new Function(script)();
    await vi.waitFor(() => expect(document.getElementById("title").textContent).toBe("Bannergress sign-in complete"));

    expect(document.getElementById("message").textContent).toBe("Taking you back to OpenBanners…");
    expect(document.getElementById("back").getAttribute("href")).toBe("/banner/abc?x=1");
  });

  it("never links off the site", async () => {
    for (const returnTo of ["//evil.example/", "https://evil.example/", "/\\evil.example"]) {
      window.localStorage.setItem(
        BANNERGRESS_AUTH_PENDING_STORAGE_KEY,
        JSON.stringify({ state: "other", codeVerifier: "verifier", returnTo })
      );
      window.history.replaceState({}, "", "/bannergress-auth-callback.html?code=***&state=s1");
      document.body.innerHTML = '<h1 id="title"></h1><p id="message"></p><a id="back" href="/x">Back</a>';
      new Function(script)();
      await vi.waitFor(() => expect(document.getElementById("title").textContent).toBe("Bannergress sign-in failed"));
      expect(document.getElementById("back").getAttribute("href")).toBe("/");
    }
  });

  it("refuses a state mismatch", async () => {
    window.localStorage.setItem(
      BANNERGRESS_AUTH_PENDING_STORAGE_KEY,
      JSON.stringify({ state: "other", codeVerifier: "verifier" })
    );

    await runCallback("?code=c1&state=s1");

    expect(document.getElementById("title").textContent).toBe("Bannergress sign-in failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(BANNERGRESS_AUTH_PENDING_STORAGE_KEY)).toBeNull();
  });
});
