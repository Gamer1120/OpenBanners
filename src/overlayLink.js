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
// happened (no app, or a browser that ignores the link). Cold-starting the
// Overlay on a slow phone (its activity, then its service, then Ingress) can
// take well over a second, so this errs on the long side.
export const APP_LAUNCH_TIMEOUT_MS = 3000;
// After the "didn't open" dialog shows, the app may still turn up late. If the
// page is hidden within this window, onLateLaunch() lets the caller close the
// dialog again, so people don't come back to a wrong "didn't open" message.
export const APP_LATE_LAUNCH_MS = 15000;

// After firing an app link: calls onStay() if the page is still in front
// after timeoutMs. Any sign that something took over (the page hidden, the
// window losing focus to an app or a chooser, the page unloading) cancels it,
// so the install dialog never shows when the app did open. Returns a cancel
// function.
export function watchAppLaunch(
  onStay,
  {
    timeoutMs = APP_LAUNCH_TIMEOUT_MS,
    onLateLaunch = null,
    lateMs = APP_LATE_LAUNCH_MS,
    win = window,
    doc = document,
  } = {}
) {
  let active = true;
  let timer = null;
  let lateTimer = null;

  const stopLate = () => {
    win.clearTimeout(lateTimer);
    lateTimer = null;
    doc.removeEventListener("visibilitychange", onLateVisibility);
    win.removeEventListener("pagehide", onLateHide);
  };
  function onLateVisibility() {
    if (doc.visibilityState === "hidden") {
      onLateHide();
    }
  }
  function onLateHide() {
    stopLate();
    onLateLaunch?.();
  }

  const stop = () => {
    stopLate();
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
      // Only the page going to the background counts here: a blur alone is
      // usually just the dialog or keyboard taking focus.
      if (onLateLaunch) {
        doc.addEventListener("visibilitychange", onLateVisibility);
        win.addEventListener("pagehide", onLateHide);
        lateTimer = win.setTimeout(stopLate, lateMs);
      }
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

// "Start with Overlay from here" on one mission (app v49+):
//   openbanners-overlay://mission/{bannerId}/{n}?start=1&origin={site}
// n is the 1-based mission number as listed on the banner page (filler slots
// left out, the same order the app keeps). The app begins at that mission and
// opens it in Ingress. Its own host, so older apps don't match the intent and
// Chrome comes back with ?overlay=missing (the install/update dialog).
function overlayMissionPath(bannerId, missionNumber, origin) {
  const query = new URLSearchParams({ start: "1" });
  if (origin) {
    query.set("origin", origin);
  }
  return `mission/${encodeURIComponent(bannerId)}/${missionNumber}?${query.toString()}`;
}

// A whole number from 1, else null (no link).
function validMissionNumber(missionNumber) {
  return Number.isInteger(missionNumber) && missionNumber >= 1 ? missionNumber : null;
}

export function buildOverlayMissionLink(bannerId, missionNumber, origin) {
  const number = validMissionNumber(missionNumber);
  return number ? `${OVERLAY_SCHEME}://${overlayMissionPath(bannerId, number, origin)}` : null;
}

export function buildOverlayMissionIntentUrl(bannerId, missionNumber, origin) {
  const number = validMissionNumber(missionNumber);
  if (!number) {
    return null;
  }
  const fallback = overlayMissingUrl(origin, `/banner/${encodeURIComponent(bannerId)}`);
  return (
    `intent://${overlayMissionPath(bannerId, number, origin)}` +
    `#Intent;scheme=${OVERLAY_SCHEME};package=${OVERLAY_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  );
}

export function buildOverlayPlanIntentUrl(planId, origin) {
  const fallback = overlayMissingUrl(origin, `/planner/${encodeURIComponent(planId)}`);
  return (
    `intent://${overlayPlanPath(planId, origin)}` +
    `#Intent;scheme=${OVERLAY_SCHEME};package=${OVERLAY_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  );
}
