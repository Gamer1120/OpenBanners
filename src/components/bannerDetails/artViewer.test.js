import { describe, expect, it } from "vitest";
import {
  clampTile,
  getFitTile,
  getMosaicSize,
  getPanSlowdown,
  getPanTiming,
  getPictureSize,
  getStartTile,
  getTileRange,
  MAX_START_TILE,
} from "./artViewer";

describe("artwork viewer sizes", () => {
  it("fits the whole banner when its tiles stay comfortable", () => {
    // 6 missions on a 380 × 800 phone: one row across the full width.
    const tile = getStartTile(380, 800, 6, 1);
    expect(getMosaicSize(tile, 6, 1).width).toBeCloseTo(380, 0);
    // 12 missions on a desktop: whole banner, capped at MAX_START_TILE.
    expect(getStartTile(1400, 800, 6, 2)).toBe(MAX_START_TILE);
  });

  it("uses the full width with readable tiles for very tall banners", () => {
    // 1152 missions (192 rows) on a phone: full width, not 4 px tiles.
    const phone = getStartTile(380, 800, 6, 192);
    expect(getMosaicSize(phone, 6, 192).width).toBeCloseTo(380, 0);
    expect(phone).toBeGreaterThan(55);
    // On a desktop: about a seventh of the height per row, not the whole width.
    const desktop = getStartTile(1400, 800, 6, 192);
    expect(desktop).toBeGreaterThanOrEqual(72);
    expect(desktop).toBeLessThanOrEqual(160);
  });

  it("zooms out as far as the whole banner and in to big tiles", () => {
    const range = getTileRange(380, 800, 6, 192);
    expect(range.min).toBeCloseTo(getFitTile(380, 800, 6, 192), 5);
    expect(getMosaicSize(range.min, 6, 192).height).toBeLessThanOrEqual(800.001);
    expect(range.max).toBeGreaterThanOrEqual(480);
    expect(clampTile(1, range)).toBe(range.min);
    expect(clampTile(10_000, range)).toBe(range.max);
  });

  it("requests mission pictures in a few sizes", () => {
    expect(getPictureSize(40, 1)).toBe(80);
    expect(getPictureSize(60, 2.6)).toBe(160);
    expect(getPictureSize(150, 2)).toBe(320);
    expect(getPictureSize(480, 3)).toBe(640);
  });
});

describe("hero pan timing", () => {
  it("keeps Bannergress's 8 s loop for up to one window of overflow", () => {
    expect(getPanTiming(100, 180)).toEqual({ down: 5000, up: 1000, pause: 1000, total: 8000 });
  });

  it("slows down for very tall banners: 5 s per window height", () => {
    const timing = getPanTiming(180 * 60, 180);
    expect(timing.down).toBe(300_000);
    expect(timing.up).toBe(2000);
  });

  it("pans at half speed above 250 missions and a quarter above 500", () => {
    expect(getPanSlowdown(0)).toBe(1);
    expect(getPanSlowdown(250)).toBe(1);
    expect(getPanSlowdown(251)).toBe(2);
    expect(getPanSlowdown(500)).toBe(2);
    expect(getPanSlowdown(501)).toBe(4);
    expect(getPanSlowdown(1152)).toBe(4);

    expect(getPanTiming(180 * 10, 180, 250)).toEqual({ down: 50_000, up: 2000, pause: 1000, total: 54_000 });
    expect(getPanTiming(180 * 10, 180, 251)).toEqual({ down: 100_000, up: 4000, pause: 1000, total: 106_000 });
    expect(getPanTiming(180 * 10, 180, 500)).toEqual({ down: 100_000, up: 4000, pause: 1000, total: 106_000 });
    expect(getPanTiming(180 * 10, 180, 501)).toEqual({ down: 200_000, up: 8000, pause: 1000, total: 210_000 });
    // Without a count (or a small banner) nothing changes.
    expect(getPanTiming(100, 180)).toEqual(getPanTiming(100, 180, 18));
  });
});
