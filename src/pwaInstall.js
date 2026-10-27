import { useSyncExternalStore } from "react";

// "Install app" in the More menu (replaced the old Android WebView APK,
// 2026-10-27). Chromium browsers fire `beforeinstallprompt`; we keep the event
// and call prompt() when the menu item is clicked. iOS has no prompt API, so
// the menu shows Share -> Add to Home Screen instructions instead; other
// browsers get a hint to use their own menu. The item is hidden while running
// as the installed app.
//
// Imported early (src/index.jsx) so the event isn't missed: Chrome may fire it
// before the menu mounts.

let deferredPrompt = null;
let installed = false;
let version = 0;
const listeners = new Set();

function emit() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isRunningStandalone(win = typeof window === "undefined" ? null : window) {
  if (!win) {
    return false;
  }

  const media = (query) =>
    typeof win.matchMedia === "function" && Boolean(win.matchMedia(query)?.matches);

  return (
    media("(display-mode: standalone)") ||
    media("(display-mode: fullscreen)") ||
    media("(display-mode: minimal-ui)") ||
    media("(display-mode: window-controls-overlay)") ||
    win.navigator?.standalone === true ||
    String(win.document?.referrer || "").startsWith("android-app://")
  );
}

export function isIos(nav = typeof navigator === "undefined" ? null : navigator) {
  if (!nav) {
    return false;
  }

  const userAgent = nav.userAgent ?? "";
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS asks for the desktop site and calls itself a Mac.
    (nav.platform === "MacIntel" && Number(nav.maxTouchPoints) > 1)
  );
}

// The deprecated OpenBanners Android app was a plain WebView: it can't install
// anything, so its users are told to open the site in their browser instead.
export function isAndroidWebView(nav = typeof navigator === "undefined" ? null : navigator) {
  const userAgent = nav?.userAgent ?? "";
  return /Android/i.test(userAgent) && (/\bwv\b/i.test(userAgent) || /OpenBannersApp/i.test(userAgent));
}

// "installed" | "prompt" | "ios" | "webview" | "manual"
export function getInstallMode() {
  if (installed || isRunningStandalone()) {
    return "installed";
  }

  if (deferredPrompt) {
    return "prompt";
  }

  if (isAndroidWebView()) {
    return "webview";
  }

  return isIos() ? "ios" : "manual";
}

export function useInstallMode() {
  useSyncExternalStore(subscribe, () => version, () => version);
  return getInstallMode();
}

// Shows the browser's install dialog. Resolves to "accepted", "dismissed" or
// "unavailable" (no saved prompt: show instructions instead).
export async function promptInstall() {
  const event = deferredPrompt;

  if (!event) {
    return "unavailable";
  }

  // A prompt can only be used once.
  deferredPrompt = null;
  emit();

  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "dismissed";
  }
}

export function handleBeforeInstallPrompt(event) {
  // Keep Chrome's own mini-infobar away; the More menu offers the install.
  event.preventDefault?.();
  deferredPrompt = event;
  emit();
}

export function handleAppInstalled() {
  deferredPrompt = null;
  installed = true;
  emit();
}

export function __resetInstallStateForTests() {
  deferredPrompt = null;
  installed = false;
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
}

// public/sw.js only exists so browsers offer installation; it caches nothing.
// Production only: in `yarn dev` it would get in the way of Vite.
export function registerServiceWorker() {
  if (
    !import.meta.env.PROD ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !window.isSecureContext
  ) {
    return;
  }

  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
