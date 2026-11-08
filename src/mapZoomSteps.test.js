import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import L from "leaflet";
import "./leafletSetup";
import { ZOOM_STEP } from "./mapZoomSteps";

describe("half zoom steps on every map", () => {
  let map;
  let container;
  let any3d;

  // Leaflet only zooms by fractions with CSS 3D transforms (every real
  // browser), which jsdom doesn't have.
  beforeAll(() => {
    any3d = L.Browser.any3d;
    L.Browser.any3d = true;
  });

  afterAll(() => {
    L.Browser.any3d = any3d;
  });

  const makeMap = (options = {}) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    map = L.map(container, { center: [52.22, 6.89], zoom: 15, zoomAnimation: false, ...options });
    return map;
  };

  afterEach(() => {
    map?.remove();
    container?.remove();
    map = null;
  });

  it("makes half a level the default zoom step and snap", () => {
    makeMap();

    expect(ZOOM_STEP).toBe(0.5);
    expect(map.options.zoomDelta).toBe(0.5);
    expect(map.options.zoomSnap).toBe(0.5);
  });

  it("zooms half a level per +/− press and keeps the min/max bounds", () => {
    makeMap({ minZoom: 2, maxZoom: 18 });

    map.zoomIn();
    expect(map.getZoom()).toBe(15.5);
    map.zoomOut();
    map.zoomOut();
    expect(map.getZoom()).toBe(14.5);

    map.setZoom(17.5);
    map.zoomIn();
    map.zoomIn();
    expect(map.getZoom()).toBe(18);
    map.setZoom(2);
    map.zoomOut();
    expect(map.getZoom()).toBe(2);
  });

  it("snaps other zooms (pinch, fitBounds) to half levels and keeps whole levels as they are", () => {
    makeMap();

    map.setZoom(13.3);
    expect(map.getZoom()).toBe(13.5);
    map.setZoom(12);
    expect(map.getZoom()).toBe(12);
  });

  it("zooms half a level per wheel notch, and smooth scrolling keeps its speed", () => {
    makeMap({ scrollWheelZoom: "center" });

    container.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    expect(map.getZoom()).toBe(15.5);

    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    expect(map.getZoom()).toBe(15);

    // 60 px of smooth scrolling (half of STEP_PX) is one half step.
    for (let index = 0; index < 15; index += 1) {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -4, bubbles: true, cancelable: true }));
    }
    expect(map.getZoom()).toBe(15.5);
  });
});
