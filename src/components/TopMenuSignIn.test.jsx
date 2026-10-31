import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TopMenu from "./TopMenu";
import { BANNERGRESS_AUTH_PENDING_STORAGE_KEY, BANNERGRESS_AUTH_STORAGE_KEY } from "../bannergressSync";
import { __setCatalogForTests } from "../i18n";
import de from "../i18n/locales/de.json";

const TELEGRAM_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Telegram-Android/11.4.2";
const IOS_WEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

function setUserAgent(value) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => value });
}

async function renderMenu() {
  render(
    <MemoryRouter initialEntries={["/banner/abc"]}>
      <TopMenu onTitleClick={vi.fn()} />
    </MemoryRouter>
  );
  return screen.findByRole("button", { name: "Sign in" }, { timeout: 3000 });
}

describe("sign-in button", () => {
  const originalUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    window.localStorage.clear();
    window.open = vi.fn();
  });

  afterEach(() => {
    setUserAgent(originalUserAgent);
    vi.restoreAllMocks();
    window.localStorage.clear();
    __setCatalogForTests("en", {});
  });

  it("is a labelled Sign in button, not a bare icon, when signed out", async () => {
    const button = await renderMenu();

    expect(button).toHaveTextContent(/^Sign in$/);
    expect(button).toHaveClass("btn", "filled");
    expect(button).toHaveAttribute("title", "Sign in with Bannergress");
    expect(button).toBeEnabled();
    // The icon is decoration; the name comes from the visible label.
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(button).not.toHaveAttribute("aria-label");
  });

  it("uses the translated label as its name", async () => {
    __setCatalogForTests("de", de);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TopMenu onTitleClick={vi.fn()} />
      </MemoryRouter>
    );

    const button = await screen.findByRole("button", { name: "Anmelden" }, { timeout: 3000 });
    expect(button).toHaveTextContent("Anmelden");
    expect(button).toHaveAttribute("title", "Mit Bannergress anmelden");
  });

  it("is also offered at the top of the More menu", async () => {
    setUserAgent(DESKTOP);
    const popup = { closed: false, focus: vi.fn(), close: vi.fn(), name: "", location: { href: "" } };
    window.open.mockReturnValue(popup);
    const user = userEvent.setup();
    await renderMenu();
    await user.click(screen.getByRole("button", { name: "More options" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("Sign in with Bannergress");
    await user.click(items[0]);

    await waitFor(() => expect(popup.location.href).toContain("login.bannergress.com"));
  });

  it("shows the agent name from Bannergress when signed in", async () => {
    const payload = btoa(JSON.stringify({ iss: "https://login.example", sub: "user-1" }))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    window.localStorage.setItem(
      BANNERGRESS_AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: `h.${payload}.s`,
        refreshToken: "test-refresh-token",
        accessExpiresAt: Date.now() + 5 * 60 * 1000,
        refreshExpiresAt: Date.now() + 30 * 60 * 1000,
        updatedAt: Date.now(),
      })
    );
    const fetchMock = vi.fn((url) =>
      Promise.resolve(
        String(url) === "https://api.bannergress.com/user"
          ? { ok: true, status: 200, json: () => Promise.resolve({ agent: { name: "Gamer1120" } }) }
          : { ok: false, status: 500, json: () => Promise.resolve(null) }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/together/x"]}>
        <TopMenu onTitleClick={vi.fn()} />
      </MemoryRouter>
    );

    const button = await screen.findByRole(
      "button",
      { name: "Signed in with Bannergress as Gamer1120" },
      { timeout: 3000 }
    );
    expect(button).toHaveAttribute("title", "Signed in with Bannergress as Gamer1120");
    await waitFor(() => expect(button.querySelector(".ob-account-label")).toHaveTextContent(/^Signed in as Gamer1120$/));
    expect(fetchMock).toHaveBeenCalledWith("https://api.bannergress.com/user", expect.anything());
    vi.unstubAllGlobals();
  });

  it("is replaced by a Signed in button (never a letter) when signed in", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    window.localStorage.setItem(
      BANNERGRESS_AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        accessExpiresAt: Date.now() + 5 * 60 * 1000,
        refreshExpiresAt: Date.now() + 30 * 60 * 1000,
        updatedAt: Date.now(),
      })
    );
    render(
      <MemoryRouter initialEntries={["/together/x"]}>
        <TopMenu onTitleClick={vi.fn()} />
      </MemoryRouter>
    );

    const account = await screen.findByRole("button", { name: "Signed in with Bannergress" }, { timeout: 3000 });
    expect(account).toHaveTextContent(/^Signed in$/);
    expect(account.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menuitem", { name: "Sign in with Bannergress" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("explains in Telegram's browser instead of opening Google", async () => {
    setUserAgent(TELEGRAM_ANDROID);
    const user = userEvent.setup();
    await user.click(await renderMenu());

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Telegram’s built-in browser");
    expect(screen.getByRole("link", { name: "Open in browser" }).getAttribute("href")).toMatch(
      // jsdom runs on http://localhost; the live site is https.
      /^intent:\/\/localhost:3000\/[^#]*#Intent;scheme=http;/
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("on iOS points to Open in Safari, without an intent link", async () => {
    setUserAgent(IOS_WEBVIEW);
    const user = userEvent.setup();
    await user.click(await renderMenu());

    expect(await screen.findByRole("dialog")).toHaveTextContent("Open in Safari");
    expect(screen.queryByRole("link", { name: "Open in browser" })).toBeNull();
  });

  it("copies the page link", async () => {
    setUserAgent(IOS_WEBVIEW);
    const user = userEvent.setup();
    // After setup(): user-event installs its own clipboard.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await user.click(await renderMenu());
    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("opens the popup straight away in a normal browser", async () => {
    setUserAgent(DESKTOP);
    const popup = { closed: false, focus: vi.fn(), close: vi.fn(), name: "", location: { href: "" } };
    window.open.mockReturnValue(popup);
    const user = userEvent.setup();
    await user.click(await renderMenu());

    await waitFor(() => expect(popup.location.href).toContain("login.bannergress.com"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(BANNERGRESS_AUTH_PENDING_STORAGE_KEY))).toMatchObject({ mode: "popup" });
  });

  it("signs in in the same tab when the popup is blocked", async () => {
    setUserAgent(DESKTOP);
    window.open.mockReturnValue(null);
    const user = userEvent.setup();
    await user.click(await renderMenu());

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(BANNERGRESS_AUTH_PENDING_STORAGE_KEY) ?? "null")).toMatchObject({
        mode: "redirect",
        returnTo: "/",
      })
    );
  });
});
