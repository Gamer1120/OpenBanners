import { afterEach, describe, expect, it } from "vitest";
import L from "leaflet";
import { STEP_PX, createWheelStepper, wheelPixels } from "./mapWheelZoom";

const wheel = (deltaY, extra = {}) => ({ deltaY, deltaMode: 0, ctrlKey: false, ...extra });

describe("createWheelStepper", () => {
  it("zooms one level per mouse notch, whatever its size", () => {
    const step = createWheelStepper({ now: () => 0 });

    expect(step(wheel(100))).toBe(-1);
    expect(step(wheel(100))).toBe(-1);
    expect(step(wheel(-53))).toBe(1);
    expect(step(wheel(-250))).toBe(1);
    expect(step(wheel(3, { deltaMode: 1 }))).toBe(-1);
  });

  it("adds up smooth scrolling to one level per STEP_PX", () => {
    let time = 0;
    const step = createWheelStepper({ now: () => time });
    const steps = [];

    for (let index = 0; index < 60; index += 1) {
      time += 16;
      steps.push(step(wheel(-4)));
    }

    expect(STEP_PX).toBe(120);
    expect(steps.filter(Boolean)).toEqual([1, 1]);
    expect(steps.indexOf(1)).toBe(29);
  });

  it("starts over after a pause or a change of direction", () => {
    let time = 0;
    const step = createWheelStepper({ now: () => time });

    for (let index = 0; index < 20; index += 1) {
      step(wheel(-4));
    }

    time = 1000;
    expect(Array.from({ length: 20 }, () => step(wheel(-4))).some(Boolean)).toBe(false);
    expect(Array.from({ length: 20 }, () => step(wheel(4))).some(Boolean)).toBe(false);
  });

  it("counts a pinch (ctrl+wheel) stronger, but ctrl+mouse notch is still one level", () => {
    const step = createWheelStepper({ now: () => 0 });
    const steps = Array.from({ length: 15 }, () => step(wheel(-2, { ctrlKey: true })));

    expect(wheelPixels(wheel(-2, { ctrlKey: true }))).toBe(8);
    expect(steps.filter(Boolean)).toEqual([1]);
    expect(step(wheel(-100, { ctrlKey: true }))).toBe(1);
  });
});

describe("Leaflet scroll wheel zoom", () => {
  let map;

  afterEach(() => {
    map?.remove();
    map = null;
  });

  it("zooms a map one level per wheel notch", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    map = L.map(container, { center: [52.22, 6.89], zoom: 15, zoomAnimation: false, scrollWheelZoom: "center" });

    container.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    expect(map.getZoom()).toBe(16);

    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    expect(map.getZoom()).toBe(14);
  });
});
