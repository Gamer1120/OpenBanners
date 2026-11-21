// Walk mode is offered on iPhone, iPod and iPad instead of "Start with Overlay"
// (2026-11-20, Michael: the OpenBanners Overlay is an Android app). Decided
// synchronously from the user agent while rendering, so the banner page never
// shows the Overlay button first and then swaps it.
// iPadOS asks for the desktop site and reports itself as a Mac; a Mac with a
// touch screen is an iPad (real Macs report maxTouchPoints 0).
export function isWalkModeDevice(nav = typeof navigator === "undefined" ? null : navigator) {
  if (!nav) {
    return false;
  }
  const userAgent = String(nav.userAgent ?? "");
  if (/iPhone|iPod|iPad/.test(userAgent)) {
    return true;
  }
  return /Macintosh/.test(userAgent) && Number(nav.maxTouchPoints) > 1;
}

// fromMission (1-based, as listed on the banner page): walk mode starts with
// the big button on that mission (?from=N; see startAtMission in walkMode.js).
export const walkModePath = (bannerId, fromMission = null) =>
  "/banner/" +
  encodeURIComponent(bannerId) +
  "/walk" +
  (Number.isInteger(fromMission) && fromMission > 0 ? "?from=" + fromMission : "");
