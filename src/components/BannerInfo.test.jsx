import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import BannerInfo from "./BannerInfo";
import {
  buildOverlayPlanIntentUrl,
  buildOverlayStartIntentUrl,
  buildOverlayStartLink,
  isAndroidUserAgent,
  isOverlayMissingSearch,
  withoutOverlayMissing,
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
      "S.browser_fallback_url=https%3A%2F%2Fopenbanners.org%2Fbanner%2Fmy-banner%3Foverlay%3Dmissing;end"
  );
  expect(buildOverlayPlanIntentUrl("plan1", "https://test.openbanners.org")).toBe(
    "intent://plan/plan1?start=1&origin=https%3A%2F%2Ftest.openbanners.org" +
      "#Intent;scheme=openbanners-overlay;package=org.openbanners.overlay;" +
      "S.browser_fallback_url=https%3A%2F%2Ftest.openbanners.org%2Fplanner%2Fplan1%3Foverlay%3Dmissing;end"
  );
  // Without a known site the fallback is still the latest release.
  expect(buildOverlayStartIntentUrl("my-banner")).toContain(
    "S.browser_fallback_url=https%3A%2F%2Fgithub.com%2FGamer1120%2FOpenBanners-overlay%2Freleases%2Flatest;end"
  );
  expect(isOverlayMissingSearch("?overlay=missing")).toBe(true);
  expect(isOverlayMissingSearch("?overlay=other")).toBe(false);
  expect(withoutOverlayMissing("?a=1&overlay=missing")).toBe("?a=1");
  expect(withoutOverlayMissing("?overlay=missing")).toBe("");
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

function ShowLocation() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderBannerPage(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/banner/:bannerId"
          element={
            <>
              <BannerInfo banner={banner} variant="row" />
              <ShowLocation />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

test("Start with Overlay on desktop opens the install dialog", async () => {
  const user = userEvent.setup();
  stubUserAgent(DESKTOP_UA);

  renderRow();
  await user.click(screen.getByRole("button", { name: "Start with OpenBanners Overlay" }));

  const dialog = screen.getByRole("dialog", { name: "Install OpenBanners Overlay" });
  expect(within(dialog).getByText(/is an Android app/)).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Open in F-Droid" })).toBeInTheDocument();
});

test("?overlay=missing (intent fallback) opens the install dialog once and drops the parameter", async () => {
  renderBannerPage("/banner/my-banner?overlay=missing&x=1");

  const dialog = await screen.findByRole("dialog", { name: "Install OpenBanners Overlay" });
  expect(within(dialog).getByText(/isn’t installed on this phone/)).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Become a tester on Google Play" })).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Download the latest release" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Open in Bannergress Overlay" })).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/banner/my-banner?x=1");
});

test("no dialog without ?overlay=missing", () => {
  renderBannerPage("/banner/my-banner");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("Open in Bannergress Overlay shares the Bannergress link", async () => {
  const user = userEvent.setup();
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "share", { value: share, configurable: true });

  renderBannerPage("/banner/my-banner?overlay=missing");
  await user.click(await screen.findByRole("button", { name: "Open in Bannergress Overlay" }));

  expect(share).toHaveBeenCalledWith({
    title: "My Banner",
    text: "https://bannergress.com/banner/my-banner",
  });
});

test("Open in Bannergress Overlay copies the link without navigator.share", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });

  renderBannerPage("/banner/my-banner?overlay=missing");
  await user.click(await screen.findByRole("button", { name: "Open in Bannergress Overlay" }));

  expect(writeText).toHaveBeenCalledWith("https://bannergress.com/banner/my-banner");
  expect(await screen.findByText("Bannergress link copied to clipboard.")).toBeInTheDocument();
});
