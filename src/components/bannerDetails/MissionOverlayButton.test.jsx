import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
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
