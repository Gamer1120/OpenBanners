import { describe, expect, it } from "vitest";
import { isWalkModeDevice, walkModePath } from "./walkDevice";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPOD_UA = "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD_OLD_UA = "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
// iPadOS 13+ asks for the desktop site and looks like Safari on a Mac.
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const ANDROID_TABLET_UA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const CHROME_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1";

describe("isWalkModeDevice", () => {
  it("is true on iPhone, iPod and iPad (also Chrome on iOS)", () => {
    expect(isWalkModeDevice({ userAgent: IPHONE_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isWalkModeDevice({ userAgent: CHROME_IOS_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isWalkModeDevice({ userAgent: IPOD_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isWalkModeDevice({ userAgent: IPAD_OLD_UA, maxTouchPoints: 5 })).toBe(true);
  });

  it("is true on an iPad that reports itself as a Mac (touch points)", () => {
    expect(isWalkModeDevice({ userAgent: MAC_UA, maxTouchPoints: 5 })).toBe(true);
  });

  it("is false on a real Mac, Android, Windows and without a navigator", () => {
    expect(isWalkModeDevice({ userAgent: MAC_UA, maxTouchPoints: 0 })).toBe(false);
    expect(isWalkModeDevice({ userAgent: MAC_UA })).toBe(false);
    expect(isWalkModeDevice({ userAgent: MAC_UA, maxTouchPoints: 1 })).toBe(false);
    expect(isWalkModeDevice({ userAgent: ANDROID_UA, maxTouchPoints: 5 })).toBe(false);
    expect(isWalkModeDevice({ userAgent: ANDROID_TABLET_UA, maxTouchPoints: 10 })).toBe(false);
    expect(isWalkModeDevice({ userAgent: WINDOWS_UA, maxTouchPoints: 10 })).toBe(false);
    expect(isWalkModeDevice(null)).toBe(false);
  });

  it("links to the walk page of the banner", () => {
    expect(walkModePath("my banner")).toBe("/banner/my%20banner/walk");
  });

  it("starts walk mode at a mission with ?from=N (only for a mission number)", () => {
    expect(walkModePath("my banner", 5)).toBe("/banner/my%20banner/walk?from=5");
    expect(walkModePath("b", 1)).toBe("/banner/b/walk?from=1");
    for (const bad of [0, -1, 1.5, "2", NaN, null, undefined]) {
      expect(walkModePath("b", bad)).toBe("/banner/b/walk");
    }
  });
});
