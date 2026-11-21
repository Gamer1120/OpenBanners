import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MissionItem } from "./shared";
import {
  APP_LAUNCH_TIMEOUT_MS,
  buildOverlayMissionIntentUrl,
  buildOverlayMissionLink,
  buildOverlayStartIntentUrl,
} from "../../overlayLink";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const TELEGRAM_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 Telegram-Android/11.4.2 (Google Pixel 7; Android 14; SDK 34; AVERAGE)";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
// iPadOS asks for the desktop site: a Mac with touch.
const IPAD_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function stubUserAgent(userAgent) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderMission({ index = 2, bannerId = "my-banner", expanded = true, id = "mission-3" } = {}) {
  return render(
    <ol>
      <MissionItem
        mission={{ id, title: "Third", steps: [] }}
        index={index}
        color="#888"
        selected={false}
        expanded={expanded}
        onToggle={() => {}}
        itemRef={() => {}}
        bannerId={bannerId}
      />
    </ol>
  );
}

// jsdom has no navigator.maxTouchPoints.
function stubTouchPoints(count) {
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: count, configurable: true });
}

afterEach(() => {
  delete window.navigator.maxTouchPoints;
});

let walkUrl = null;
function WalkProbe() {
  const location = useLocation();
  walkUrl = location.pathname + location.search;
  return <p>walk page</p>;
}

function renderMissionInRouter({ index = 2 } = {}) {
  walkUrl = null;
  return render(
    <MemoryRouter initialEntries={["/banner/my-banner"]}>
      <Routes>
        <Route
          path="/banner/:bannerId"
          element={
            <ol>
              <MissionItem
                mission={{ id: "mission-" + (index + 1), title: "Third", steps: [] }}
                index={index}
                color="#888"
                selected={false}
                expanded
                onToggle={() => {}}
                itemRef={() => {}}
                bannerId="my-banner"
              />
            </ol>
          }
        />
        <Route path="/banner/:bannerId/walk" element={<WalkProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

test.each([
  ["iPhone", IPHONE_UA, 5],
  ["iPad (reports a Mac with touch)", IPAD_MAC_UA, 5],
])("%s: Start walk mode from here instead, opening walk mode at that mission", async (_name, userAgent, touch) => {
  const user = userEvent.setup();
  stubUserAgent(userAgent);
  stubTouchPoints(touch);
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });

  renderMissionInRouter({ index: 4 });
  const labels = [...document.querySelectorAll(".mactions > *")].map((element) => element.textContent);
  expect(labels).toEqual(["Open in Ingress", "View on Intel", "Start walk mode from here"]);
  expect(screen.queryByRole("button", { name: "Start with Overlay from here" })).toBeNull();
  const walk = screen.getByRole("button", { name: "Start walk mode from here" });
  // Same style as the Overlay button, walking icon.
  expect(walk).toHaveClass("btn", "outlined", "sl");
  expect(walk.querySelector('[data-testid="DirectionsWalkIcon"]')).not.toBeNull();
  await user.click(walk);
  expect(walkUrl).toBe("/banner/my-banner/walk?from=5");
  expect(assign).not.toHaveBeenCalled();
});

test.each([
  ["Android", ANDROID_UA, 5],
  ["desktop", DESKTOP_UA, 0],
  ["a real Mac", IPAD_MAC_UA, 0],
])("%s: keeps Start with Overlay from here", (_name, userAgent, touch) => {
  stubUserAgent(userAgent);
  stubTouchPoints(touch);
  renderMissionInRouter();
  expect(screen.getByRole("button", { name: "Start with Overlay from here" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start walk mode from here" })).toBeNull();
});

test("mission links carry the banner, the 1-based mission number, the start flag and the site", () => {
  expect(buildOverlayMissionLink("my banner", 3, "https://test.openbanners.org")).toBe(
    "openbanners-overlay://mission/my%20banner/3?start=1&origin=https%3A%2F%2Ftest.openbanners.org"
  );
  expect(buildOverlayMissionIntentUrl("st-paulus-dom-münster-4d07", 12, "https://openbanners.org")).toBe(
    "intent://mission/st-paulus-dom-m%C3%BCnster-4d07/12?start=1&origin=https%3A%2F%2Fopenbanners.org" +
      "#Intent;scheme=openbanners-overlay;package=org.openbanners.overlay;" +
      "S.browser_fallback_url=https%3A%2F%2Fopenbanners.org%2Fbanner%2Fst-paulus-dom-m%25C3%25BCnster-4d07%3Foverlay%3Dmissing;end"
  );
  // The fallback is the banner page, like the whole-banner link (older apps land there too).
  expect(buildOverlayMissionIntentUrl("b", 1, "https://openbanners.org").split("S.browser_fallback_url=")[1]).toBe(
    buildOverlayStartIntentUrl("b", "https://openbanners.org").split("S.browser_fallback_url=")[1]
  );
  for (const bad of [0, -1, 1.5, "2", NaN, null, undefined]) {
    expect(buildOverlayMissionLink("b", bad, "https://openbanners.org")).toBeNull();
    expect(buildOverlayMissionIntentUrl("b", bad, "https://openbanners.org")).toBeNull();
  }
});

test("an opened mission offers Start with Overlay from here next to Open in Ingress and View on Intel", () => {
  renderMission();
  const labels = [...document.querySelectorAll(".mactions > *")].map((element) => element.textContent);
  expect(labels).toEqual(["Open in Ingress", "View on Intel", "Start with Overlay from here"]);
});

test("no button without a banner id, a mission id or while the mission is closed", () => {
  const { unmount } = renderMission({ bannerId: null });
  expect(screen.queryByRole("button", { name: "Start with Overlay from here" })).toBeNull();
  unmount();
  renderMission({ expanded: false });
  expect(screen.queryByRole("button", { name: "Start with Overlay from here" })).toBeNull();
});

test("Android: fires the mission intent for that mission", async () => {
  const user = userEvent.setup();
  stubUserAgent(ANDROID_UA);
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, origin: "https://test.openbanners.org", assign });

  renderMission({ index: 2 });
  await user.click(screen.getByRole("button", { name: "Start with Overlay from here" }));
  expect(assign).toHaveBeenCalledWith(buildOverlayMissionIntentUrl("my-banner", 3, "https://test.openbanners.org"));
  expect(assign.mock.calls[0][0]).toMatch(/^intent:\/\/mission\/my-banner\/3\?start=1&/);
});

test("Android: the install/update dialog when the app didn't open", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  stubUserAgent(ANDROID_UA);
  vi.stubGlobal("location", { ...window.location, origin: "https://openbanners.org", assign: vi.fn() });

  renderMission();
  await user.click(screen.getByRole("button", { name: "Start with Overlay from here" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(() => vi.advanceTimersByTime(APP_LAUNCH_TIMEOUT_MS + 10));
  const dialog = screen.getByRole("dialog", { name: "Install or update OpenBanners Overlay" });
  expect(within(dialog).getByText(/may need an update/)).toBeInTheDocument();
});

test("desktop: the Android-app dialog, no intent", async () => {
  const user = userEvent.setup();
  stubUserAgent(DESKTOP_UA);
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });

  renderMission();
  await user.click(screen.getByRole("button", { name: "Start with Overlay from here" }));
  expect(assign).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Install or update OpenBanners Overlay" });
  expect(within(dialog).getByText(/is an Android app/)).toBeInTheDocument();
});

test("Telegram: the dialog first; its button opens the plain mission link", async () => {
  const user = userEvent.setup();
  stubUserAgent(TELEGRAM_ANDROID_UA);
  const assign = vi.fn();
  vi.stubGlobal("location", {
    ...window.location,
    origin: "https://openbanners.org",
    href: "https://openbanners.org/banner/my-banner",
    assign,
  });

  renderMission({ index: 0 });
  await user.click(screen.getByRole("button", { name: "Start with Overlay from here" }));
  expect(assign).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Start with OpenBanners Overlay" });
  await user.click(within(dialog).getByRole("button", { name: "Start with Overlay" }));
  expect(assign).toHaveBeenCalledWith(buildOverlayMissionLink("my-banner", 1, "https://openbanners.org"));
});
