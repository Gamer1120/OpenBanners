import L from "leaflet";

// Wheel zoom in steps of the map's zoomDelta (half a level, mapZoomSteps.js),
// at a steady pace.
//
// Leaflet's own handler gathers wheel events for 40 ms and then rounds the
// result *up* to a whole zoom level, so every 40 ms of a trackpad swipe or pinch
// was another full level (a short swipe zoomed out ~10 levels) and one mouse
// notch of 100 px (Chrome on Linux/macOS) zoomed two levels. Here:
// - one mouse notch (an event of at least NOTCH_PX, or a line/page step) is one step;
// - smooth scrolling (trackpads, macOS mice) adds up, one whole level per STEP_PX
//   (so one step per STEP_PX * zoomDelta: half steps keep the same speed);
// - a pinch (ctrl+wheel) counts PINCH_GAIN times, its deltas are much smaller;
// - steps that come in while a zoom animation runs wait for it (at most
//   MAX_PENDING), instead of being dropped or piling up.
export const STEP_PX = 120;
export const NOTCH_PX = 40;
export const PINCH_GAIN = 4;
export const IDLE_RESET_MS = 400;
const MAX_PENDING = 2;

// Wheel event -> pixels (positive = zoom in), like L.DomEvent.getWheelDelta but
// without its per-browser scaling.
export function wheelPixels(event) {
  const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 60 : 1;
  const pixels = -(event.deltaY || 0) * unit;

  return event.ctrlKey ? pixels * PINCH_GAIN : pixels;
}

// Feeds wheel events, returns +1 / -1 when a zoom step is due, else 0.
// `stepPx`: smooth-scrolling pixels per step.
export function createWheelStepper({ now = () => Date.now(), stepPx = STEP_PX } = {}) {
  let total = 0;
  let lastAt = -Infinity;

  return (event) => {
    const pixels = wheelPixels(event);
    const at = now();

    if (!pixels) {
      return 0;
    }

    if (at - lastAt > IDLE_RESET_MS || Math.sign(pixels) !== Math.sign(total)) {
      total = 0;
    }

    lastAt = at;
    const notch = event.deltaMode !== 0 || Math.abs(pixels) >= NOTCH_PX * (event.ctrlKey ? PINCH_GAIN : 1);
    total = notch ? Math.sign(pixels) * stepPx : total + pixels;

    if (Math.abs(total) < stepPx) {
      return 0;
    }

    total = 0;
    return Math.sign(pixels);
  };
}

// Like Leaflet's zoomIn/zoomOut: whole levels in browsers without CSS 3D
// transforms, where Leaflet snaps every zoom to a whole level.
function wheelZoomStep(map) {
  return L.Browser.any3d ? map.options.zoomDelta || 1 : 1;
}

// Replaces the methods of Leaflet's scrollWheelZoom handler, so every map in
// the app (they all keep `scrollWheelZoom` on) gets the stepped wheel.
L.Util.extend(L.Map.ScrollWheelZoom.prototype, {
  addHooks() {
    this._step = createWheelStepper({ stepPx: STEP_PX * Math.min(1, wheelZoomStep(this._map)) });
    this._pending = 0;
    L.DomEvent.on(this._map._container, "wheel", this._onWheelScroll, this);
    this._map.on("zoomend", this._flushWheelZoom, this);
  },

  removeHooks() {
    L.DomEvent.off(this._map._container, "wheel", this._onWheelScroll, this);
    this._map.off("zoomend", this._flushWheelZoom, this);
    this._pending = 0;
  },

  _onWheelScroll(event) {
    L.DomEvent.stop(event);
    this._lastMousePos = this._map.mouseEventToContainerPoint(event);
    const direction = this._step(event);

    if (!direction) {
      return;
    }

    if (this._map._animatingZoom) {
      this._pending =
        Math.sign(this._pending) === direction
          ? Math.max(-MAX_PENDING, Math.min(MAX_PENDING, this._pending + direction))
          : direction;
      return;
    }

    this._wheelZoomBy(direction);
  },

  _flushWheelZoom() {
    if (!this._pending || this._map._animatingZoom) {
      return;
    }

    const direction = Math.sign(this._pending);
    this._pending -= direction;
    this._wheelZoomBy(direction);
  },

  _wheelZoomBy(direction) {
    const map = this._map;
    const zoom = map.getZoom();
    const target = map._limitZoom(zoom + direction * wheelZoomStep(map));

    if (target === zoom) {
      this._pending = 0;
      return;
    }

    map._stop(); // stop panning and fly animations, like Leaflet's handler

    if (map.options.scrollWheelZoom === "center" || !this._lastMousePos) {
      map.setZoom(target);
    } else {
      map.setZoomAround(this._lastMousePos, target);
    }
  },
});
