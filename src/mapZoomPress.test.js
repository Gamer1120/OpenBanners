import { afterEach, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { finishZoomOnPress } from "./mapZoomPress";

describe("finishZoomOnPress", () => {
  it("does nothing while no zoom animation runs", () => {
    const map = { _animatingZoom: false, _onZoomTransitionEnd: vi.fn() };

    expect(finishZoomOnPress(map)).toBe(false);
    expect(map._onZoomTransitionEnd).not.toHaveBeenCalled();
  });

  it("ends a running zoom animation and drops waiting wheel steps", () => {
    const map = { _animatingZoom: true, _onZoomTransitionEnd: vi.fn(), scrollWheelZoom: { _pending: 2 } };

    expect(finishZoomOnPress(map)).toBe(true);
    expect(map._onZoomTransitionEnd).toHaveBeenCalledTimes(1);
    expect(map.scrollWheelZoom._pending).toBe(0);
  });
});

describe("pressing a Leaflet map during a zoom animation", () => {
  let map;

  afterEach(() => {
    map?.remove();
    map = null;
  });

  it("finishes the zoom first, so the drag is not ignored", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    map = L.map(container, { center: [52.22, 6.89], zoom: 15, keyboard: false });
    const zoomend = vi.fn();
    map.on("zoomend", zoomend);

    // What Leaflet's _animateZoom leaves behind while the CSS transition runs.
    map._animatingZoom = true;
    map._animateToCenter = L.latLng(52.23, 6.9);
    map._animateToZoom = 16;
    L.DomUtil.addClass(map._mapPane, "leaflet-zoom-anim");

    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));

    expect(map._animatingZoom).toBe(false);
    expect(L.DomUtil.hasClass(map._mapPane, "leaflet-zoom-anim")).toBe(false);
    expect(map.getZoom()).toBe(16);
    expect(zoomend).toHaveBeenCalledTimes(1);
  });

  it("leaves a still map alone", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    map = L.map(container, { center: [52.22, 6.89], zoom: 15, keyboard: false });
    const zoomend = vi.fn();
    map.on("zoomend", zoomend);

    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));

    expect(map.getZoom()).toBe(15);
    expect(zoomend).not.toHaveBeenCalled();
  });
});

describe("a touch drag whose tile is removed", () => {
  let map;

  afterEach(() => {
    map?.remove();
    map = null;
  });

  const touchEvent = (type, x) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: x === undefined ? [] : [{ clientX: x, clientY: 100 }] });
    return event;
  };

  function setup() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    map = L.map(container, { center: [52.22, 6.89], zoom: 15, keyboard: false });
    const tile = document.createElement("div");
    map.getPane("tilePane").appendChild(tile);
    const draggable = map.dragging._draggable;
    draggable._onDown({ type: "touchstart", target: tile, touches: [{ clientX: 100, clientY: 100 }] });
    return { tile, draggable };
  }

  it("keeps moving the map after the tile under the finger left the page", () => {
    const { tile, draggable } = setup();

    tile.remove();
    tile.dispatchEvent(touchEvent("touchmove", 160));
    expect(L.DomUtil.getPosition(map._mapPane).x).toBe(60);

    tile.dispatchEvent(touchEvent("touchend"));
    expect(L.Draggable._dragging).toBeFalsy();
    expect(draggable._touchTarget).toBe(null);
  });

  it("leaves moves on a tile that is still on the page to Leaflet's own listener", () => {
    const { tile, draggable } = setup();
    const onMove = vi.spyOn(draggable, "_onMove");

    tile.dispatchEvent(touchEvent("touchmove", 160));
    expect(onMove).not.toHaveBeenCalled();
    draggable.finishDrag();
    expect(draggable._touchTarget).toBe(null);
  });
});
