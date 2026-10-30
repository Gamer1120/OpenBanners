import { describe, expect, it } from "vitest";
import { getWorldView, regionCenterForTimeZone, WORLD_PLACEHOLDER } from "./mapDefaults";

describe("default map view without a location", () => {
  it("is the visitor's part of the world, not Enschede", () => {
    const view = getWorldView({ height: 664, timeZone: "UTC" });
    expect(view.zoom).toBe(3);
    expect(view.center).toEqual(WORLD_PLACEHOLDER.center);
  });

  it("starts one level closer than a whole-world view, one more on very tall screens", () => {
    expect(getWorldView({ height: 0, timeZone: "UTC" }).zoom).toBe(3);
    expect(getWorldView({ height: 600, timeZone: "UTC" }).zoom).toBe(3);
    expect(getWorldView({ height: 900, timeZone: "UTC" }).zoom).toBe(3);
    expect(getWorldView({ height: 915, timeZone: "UTC" }).zoom).toBe(3);
    expect(getWorldView({ height: 1300, timeZone: "UTC" }).zoom).toBe(4);
    expect(getWorldView({ height: 4000, timeZone: "UTC" }).zoom).toBe(4);
  });

  it.each([
    ["Europe/Amsterdam", [48, 12]],
    ["America/Sao_Paulo", [-15, -60]],
    ["America/Argentina/Buenos_Aires", [-15, -60]],
    ["America/New_York", [38, -95]],
    ["Asia/Tokyo", [25, 118]],
    ["Asia/Kolkata", [28, 80]],
    ["Australia/Sydney", [-28, 145]],
    ["Africa/Lagos", [8, 20]],
    ["", WORLD_PLACEHOLDER.center],
  ])("centres on the visitor's part of the world: %s", (timeZone, center) => {
    expect(regionCenterForTimeZone(timeZone)).toEqual(center);
  });
});
