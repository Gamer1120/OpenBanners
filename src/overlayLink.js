// "Start with Overlay": opens the OpenBanners Overlay Android app on a banner.
// The app (org.openbanners.overlay, v34+) handles
//   openbanners-overlay://banner/{id}?start=1&origin={site}
// start=1: begin at mission 1/x and open it in Ingress right away.
// origin: where "Close and mark as done" sends the user back to (the app only
// accepts openbanners.org and test.openbanners.org).
export const OVERLAY_PACKAGE = "org.openbanners.overlay";
export const OVERLAY_SCHEME = "openbanners-overlay";
// The latest release APK (non-Android hint on the planner, and the intent
// fallback when no site origin is known).
export const OVERLAY_FALLBACK_URL =
  "https://github.com/Gamer1120/OpenBanners-overlay/releases/latest";

// Not installed (or too old for the link): Chrome opens browser_fallback_url,
// which is the same page with ?overlay=missing; the page then shows the
// install dialog (OverlayMissingDialog) and drops the parameter again.
export const OVERLAY_MISSING_PARAM = "overlay";
export const OVERLAY_MISSING_VALUE = "missing";

export function overlayMissingUrl(origin, path) {
  if (!origin) {
    return OVERLAY_FALLBACK_URL;
  }
  return `${origin}${path}?${OVERLAY_MISSING_PARAM}=${OVERLAY_MISSING_VALUE}`;
}

// True when the page was opened as the intent fallback.
export function isOverlayMissingSearch(search) {
  return new URLSearchParams(search || "").get(OVERLAY_MISSING_PARAM) === OVERLAY_MISSING_VALUE;
}

// The search string without the fallback parameter ("" or "?a=b").
export function withoutOverlayMissing(search) {
  const params = new URLSearchParams(search || "");
  params.delete(OVERLAY_MISSING_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

export function isAndroidUserAgent(userAgent) {
  return typeof userAgent === "string" && /\bAndroid\b/i.test(userAgent);
}

function overlayLinkPath(bannerId, origin) {
  const query = new URLSearchParams({ start: "1" });

  if (origin) {
    query.set("origin", origin);
  }

  return `banner/${encodeURIComponent(bannerId)}?${query.toString()}`;
}

export function buildOverlayStartLink(bannerId, origin) {
  return `${OVERLAY_SCHEME}://${overlayLinkPath(bannerId, origin)}`;
}

// How long an app link may take to leave the page before we assume nothing
// happened (no app, or a browser that ignores the link).
export const APP_LAUNCH_TIMEOUT_MS = 1500;

// After firing an app link: calls onStay() if the page is still in front
// after timeoutMs. Any sign that something took over (the page hidden, the
// window losing focus to an app or a chooser, the page unloading) cancels it,
// so the install dialog never shows when the app did open. Returns a cancel
// function.
export function watchAppLaunch(onStay, { timeoutMs = APP_LAUNCH_TIMEOUT_MS, win = window, doc = document } = {}) {
  let active = true;
  let timer = null;

  const stop = () => {
    if (!active) {
      return;
    }
    active = false;
    win.clearTimeout(timer);
    win.removeEventListener("blur", stop);
    win.removeEventListener("pagehide", stop);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
  function onVisibility() {
    if (doc.visibilityState === "hidden") {
      stop();
    }
  }

  win.addEventListener("blur", stop);
  win.addEventListener("pagehide", stop);
  doc.addEventListener("visibilitychange", onVisibility);
  timer = win.setTimeout(() => {
    if (!active) {
      return;
    }
    const stillHere = doc.visibilityState !== "hidden";
    stop();
    if (stillHere) {
      onStay();
    }
  }, timeoutMs);

  return stop;
}

// Chrome on Android: launches the app, or opens the fallback page when it
// isn't installed (or is an older version without the link).
export function buildOverlayStartIntentUrl(bannerId, origin) {
  const fallback = overlayMissingUrl(origin, `/banner/${encodeURIComponent(bannerId)}`);
  return (
    `intent://${overlayLinkPath(bannerId, origin)}` +
    `#Intent;scheme=${OVERLAY_SCHEME};package=${OVERLAY_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  );
}

// Mission Day plans (app v42+): openbanners-overlay://plan/{planId}?start=1&origin={site}
// The app follows the plan's open missions as one route and ticks them off.
function overlayPlanPath(planId, origin) {
  const query = new URLSearchParams({ start: "1" });
  if (origin) {
    query.set("origin", origin);
  }
  return `plan/${encodeURIComponent(planId)}?${query.toString()}`;
}

export function buildOverlayPlanLink(planId, origin) {
  return `${OVERLAY_SCHEME}://${overlayPlanPath(planId, origin)}`;
}

export function buildOverlayPlanIntentUrl(planId, origin) {
  const fallback = overlayMissingUrl(origin, `/planner/${encodeURIComponent(planId)}`);
  return (
    `intent://${overlayPlanPath(planId, origin)}` +
    `#Intent;scheme=${OVERLAY_SCHEME};package=${OVERLAY_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  );
}
