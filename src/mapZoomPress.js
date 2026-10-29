import L from "leaflet";

// Swiping right after a zoom (pinch, double tap, wheel step, +/-) moves the map.
//
// 1. Leaflet ignores a press while its zoom animation runs (L.Draggable._onDown
//    returns while the map pane has `leaflet-zoom-anim`, Map.TouchZoom returns
//    while `_animatingZoom`) and then ignores the whole gesture, so a swipe that
//    started within ~0.3 s of a zoom did nothing until the finger was lifted and
//    put down again. Here a press on the map first runs Leaflet's own end of the
//    animation (jump to the target view, zoomend + moveend), then Leaflet's drag
//    and pinch handlers see a still map. Wheel steps still waiting for the
//    animation (mapWheelZoom.js) are dropped: the press means "pan now".
// 2. Touch events keep going to the element the finger first touched. Right
//    after a zoom that is often a tile of the old zoom level, which Leaflet
//    removes once the new tiles are in (or at once, when the zoom ends under the
//    finger); events on a removed element no longer reach the document, where
//    L.Draggable listens, so the drag stopped dead mid-swipe. The drag now also
//    listens on that element and takes over once it has left the page.

export function finishZoomOnPress(map) {
  if (!map?._animatingZoom) {
    return false;
  }

  if (map.scrollWheelZoom) {
    map.scrollWheelZoom._pending = 0;
  }

  map._onZoomTransitionEnd();
  return true;
}

// The events Leaflet itself starts drags and pinches on. Not pointerdown when
// touch events follow it: ending the zoom there can remove the touched tile
// before touchstart, which then never reaches the map.
function pressEvents() {
  return !L.Browser.touchNative && L.Browser.pointer
    ? ["pointerdown", "mousedown"]
    : ["touchstart", "mousedown"];
}

L.Map.addInitHook(function addFinishZoomOnPress() {
  const container = this._container;
  const types = pressEvents();
  const onPress = () => finishZoomOnPress(this);

  // Capture phase: runs before Leaflet's own listeners on the container.
  for (const type of types) {
    container.addEventListener(type, onPress, { capture: true, passive: true });
  }

  this.on("unload", () => {
    for (const type of types) {
      container.removeEventListener(type, onPress, { capture: true });
    }
  });
});

const draggableOnDown = L.Draggable.prototype._onDown;
const draggableFinishDrag = L.Draggable.prototype.finishDrag;

L.Draggable.include({
  _onDown(event) {
    draggableOnDown.call(this, event);

    const target = event?.target;

    if (!event?.touches || L.Draggable._dragging !== this || this._touchTarget || !target?.addEventListener) {
      return;
    }

    this._touchTarget = target;
    this._onTargetMove ??= (moveEvent) => {
      if (this._touchTarget && !this._touchTarget.isConnected) {
        this._onMove(moveEvent);
      }
    };
    this._onTargetUp ??= (upEvent) => {
      if (this._touchTarget && !this._touchTarget.isConnected) {
        this._onUp(upEvent);
      }
    };
    target.addEventListener("touchmove", this._onTargetMove, { passive: false });
    target.addEventListener("touchend", this._onTargetUp);
    target.addEventListener("touchcancel", this._onTargetUp);
  },

  finishDrag(noInertia) {
    const target = this._touchTarget;

    if (target) {
      this._touchTarget = null;
      target.removeEventListener("touchmove", this._onTargetMove, { passive: false });
      target.removeEventListener("touchend", this._onTargetUp);
      target.removeEventListener("touchcancel", this._onTargetUp);
    }

    return draggableFinishDrag.call(this, noInertia);
  },
});
