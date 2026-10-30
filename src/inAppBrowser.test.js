import { describe, expect, it } from "vitest";
import { buildOpenInBrowserIntent, detectInAppBrowser } from "./inAppBrowser";

const UA = {
  telegramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.4.2 (Google Pixel 7; Android 14; SDK 34; AVERAGE)",
  iosWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0.0",
  facebook:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]",
  messenger:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0]",
  discord: "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 Discord/250.0",
  whatsapp: "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24",
  line: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0",
  genericWebView:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36",
  oldOpenBannersApp:
    "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 OpenBannersApp/3",
};

const detect = (userAgent, win = {}) => detectInAppBrowser({ userAgent, win });

describe("detectInAppBrowser", () => {
  it.each([
    ["telegramAndroid", "Telegram", "android"],
    ["instagram", "Instagram", "ios"],
    ["facebook", "Facebook", "android"],
    ["messenger", "Messenger", "ios"],
    ["discord", "Discord", "android"],
    ["whatsapp", "WhatsApp", "android"],
    ["line", "LINE", "ios"],
    ["genericWebView", "", "android"],
    ["iosWebView", "", "ios"],
  ])("recognises %s", (name, app, platform) => {
    expect(detect(UA[name])).toEqual({ app, platform });
  });

  it.each(["iosSafari", "iosChrome", "androidChrome", "desktopChrome", "oldOpenBannersApp"])(
    "leaves real browsers alone: %s",
    (name) => {
      expect(detect(UA[name])).toBeNull();
    }
  );

  it("finds Telegram's in-app browser by its bridge object", () => {
    expect(detect(UA.iosSafari, { TelegramWebviewProxy: {} })).toEqual({ app: "Telegram", platform: "ios" });
  });

  it("treats an installed iOS web app as Safari", () => {
    expect(detect(UA.iosWebView, { navigator: { standalone: true } })).toBeNull();
  });
});

describe("buildOpenInBrowserIntent", () => {
  it("keeps the page, query and https scheme", () => {
    expect(buildOpenInBrowserIntent("https://openbanners.org/banner/abc-123?x=1")).toBe(
      "intent://openbanners.org/banner/abc-123?x=1#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end"
    );
  });

  it("refuses other schemes", () => {
    expect(buildOpenInBrowserIntent("javascript:alert(1)")).toBeNull();
  });
});
