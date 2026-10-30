// In-app browsers (Telegram, Instagram, Facebook, …): Google refuses its
// sign-in inside embedded WebViews ("403 disallowed_useragent"), and
// Bannergress signs in only with Google. Before starting the sign-in, the
// top bar shows InAppBrowserDialog instead (open in the real browser / copy
// the link). Only the user agent is known; a real phone may differ.

const APPS = [
  // Telegram's in-app browser also injects TelegramWebviewProxy (checked below).
  ["Telegram", /Telegram/i],
  ["Instagram", /Instagram/i],
  ["Messenger", /\bMessenger\b|FBAN\/Messenger|MessengerForiOS|FB_IAB\/Orca/i],
  ["Facebook", /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i],
  ["Discord", /Discord/i],
  ["WhatsApp", /WhatsApp/i],
  ["LINE", /\bLine\//],
  ["Snapchat", /Snapchat/i],
  ["TikTok", /musical_ly|BytedanceWebview|TikTok/i],
];

function platformOf(userAgent) {
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return "ios";
  }
  return /Android/i.test(userAgent) ? "android" : "other";
}

// { app, platform } for an in-app browser, else null. app is a display name
// or "" when only the WebView itself is recognised. platform: "android" |
// "ios" | "other".
export function detectInAppBrowser({
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "",
  win = typeof window === "undefined" ? null : window,
} = {}) {
  const ua = String(userAgent || "");
  const platform = platformOf(ua);

  // The old OpenBanners Android app (a WebView) signs in through a Chrome
  // custom tab, which Google allows.
  if (/OpenBannersApp/i.test(ua)) {
    return null;
  }

  // An installed web app on iOS has no "Safari/" in its user agent either,
  // but it is Safari: Google allows it.
  if (win?.navigator?.standalone === true) {
    return null;
  }

  for (const [app, pattern] of APPS) {
    if (pattern.test(ua)) {
      return { app, platform };
    }
  }

  if (win && typeof win.TelegramWebviewProxy !== "undefined") {
    return { app: "Telegram", platform };
  }

  // Android System WebView: "; wv)" in the user agent.
  if (platform === "android" && /;\s*wv\)/.test(ua)) {
    return { app: "", platform };
  }

  // iOS WKWebView in an app: WebKit without "Safari/" (Safari, Chrome,
  // Firefox and Edge on iOS all say Safari/).
  if (platform === "ios" && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) {
    return { app: "", platform };
  }

  return null;
}

// Android intent that opens a page in the default browser (from a WebView
// that hands intent:// links to the system, as Telegram's does).
export function buildOpenInBrowserIntent(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const scheme = url.protocol.slice(0, -1);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
}

// Copies text; resolves true when it worked.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way (some WebViews block the Clipboard API).
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}
