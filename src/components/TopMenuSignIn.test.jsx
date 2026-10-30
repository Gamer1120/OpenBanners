import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TopMenu from "./TopMenu";
import { BANNERGRESS_AUTH_PENDING_STORAGE_KEY } from "../bannergressSync";

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
  return screen.findByRole("button", { name: /authenticate/i }, { timeout: 3000 });
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
