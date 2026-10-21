import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import BannerInfo from "./BannerInfo";
import {
  buildOverlayStartIntentUrl,
  buildOverlayStartLink,
  isAndroidUserAgent,
} from "../overlayLink";

const banner = {
  id: "my-banner",
  title: "My Banner",
  startLatitude: 52.2,
  startLongitude: 6.9,
};

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function renderRow() {
  return render(
    <MemoryRouter>
      <BannerInfo banner={banner} variant="row" />
    </MemoryRouter>
  );
}

function stubUserAgent(userAgent) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("overlay links carry the banner, the start flag and the site", () => {
  expect(buildOverlayStartLink("my banner", "https://test.openbanners.org")).toBe(
    "openbanners-overlay://banner/my%20banner?start=1&origin=https%3A%2F%2Ftest.openbanners.org"
  );
  expect(buildOverlayStartIntentUrl("my-banner", "https://openbanners.org")).toBe(
    "intent://banner/my-banner?start=1&origin=https%3A%2F%2Fopenbanners.org" +
      "#Intent;scheme=openbanners-overlay;package=org.openbanners.overlay;" +
      "S.browser_fallback_url=https%3A%2F%2Fgithub.com%2FGamer1120%2FOpenBanners-overlay%2Freleases%2Flatest;end"
  );
  expect(isAndroidUserAgent(ANDROID_UA)).toBe(true);
  expect(isAndroidUserAgent(DESKTOP_UA)).toBe(false);
});

test("start row: Navigate, BannerGuider, Start with Overlay, Share", () => {
  renderRow();
  const list = screen.getByRole("list", { name: "Start this banner" });
  const labels = within(list)
    .getAllByRole("button")
    .map((button) => button.textContent);

  expect(labels).toEqual(["Navigate", "BannerGuider", "Start with Overlay", "Share"]);
});

test("Start with Overlay on Android opens the app at mission 1", async () => {
  const user = userEvent.setup();
  stubUserAgent(ANDROID_UA);
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, origin: "https://test.openbanners.org", assign });

  renderRow();
  await user.click(screen.getByRole("button", { name: "Start with OpenBanners Overlay" }));

  expect(assign).toHaveBeenCalledWith(
    buildOverlayStartIntentUrl("my-banner", "https://test.openbanners.org")
  );
});

test("Start with Overlay on desktop copies the banner link", async () => {
  const user = userEvent.setup();
  stubUserAgent(DESKTOP_UA);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });

  renderRow();
  await user.click(screen.getByRole("button", { name: "Start with OpenBanners Overlay" }));

  expect(writeText).toHaveBeenCalledWith("https://bannergress.com/banner/my-banner");
  expect(
    await screen.findByText("OpenBanners Overlay link copied to clipboard.")
  ).toBeInTheDocument();
});
