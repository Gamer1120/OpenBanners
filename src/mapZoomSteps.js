import L from "leaflet";

// Half zoom levels on every map (2026-11-08, Michael: "twice as many zoom
// levels, in between each current zoom level another one"). Map defaults, so
// every Leaflet map in the app (they all import leafletSetup) gets them:
// - zoomDelta: what +/−, the keyboard, a double click/tap and one wheel notch
//   (mapWheelZoom.js) zoom by;
// - zoomSnap: where pinches, fitBounds and flyToBounds stop.
// The OSM tiles of the nearest whole level are scaled to fill a half level.
export const ZOOM_STEP = 0.5;

L.Map.mergeOptions({
  zoomSnap: ZOOM_STEP,
  zoomDelta: ZOOM_STEP,
});
