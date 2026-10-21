// "Start with Overlay": opens the OpenBanners Overlay Android app on a banner.
// The app (org.openbanners.overlay, v34+) handles
//   openbanners-overlay://banner/{id}?start=1&origin={site}
// start=1: begin at mission 1/x and open it in Ingress right away.
// origin: where "Close and mark as done" sends the user back to (the app only
// accepts openbanners.org and test.openbanners.org).
export const OVERLAY_PACKAGE = "org.openbanners.overlay";
export const OVERLAY_SCHEME = "openbanners-overlay";
// Not installed (or too old for the link): the latest release APK.
export const OVERLAY_FALLBACK_URL =
  "https://github.com/Gamer1120/OpenBanners-overlay/releases/latest";

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

// Chrome on Android: launches the app, or opens the fallback page when it
// isn't installed (or is an older version without the link).
export function buildOverlayStartIntentUrl(bannerId, origin) {
  return (
    `intent://${overlayLinkPath(bannerId, origin)}` +
    `#Intent;scheme=${OVERLAY_SCHEME};package=${OVERLAY_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(OVERLAY_FALLBACK_URL)};end`
  );
}
