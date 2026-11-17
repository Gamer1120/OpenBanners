import { expect, test } from "vitest";
import {
  DEFAULT_BANNER_FILTERS,
  bannerMatchesKilometerFilter,
  countActiveBannerFilters,
  isPastKilometerFilter,
} from "./bannerFilters";

const banner = (km) => ({ id: `b${km}`, lengthMeters: km === null ? undefined : km * 1000 });

test("distance filter: max is exclusive like the map, min inclusive", () => {
  const under5 = { ...DEFAULT_BANNER_FILTERS, maximumKilometers: "5" };

  expect(bannerMatchesKilometerFilter(banner(4.99), under5)).toBe(true);
  expect(bannerMatchesKilometerFilter(banner(5), under5)).toBe(false);
  expect(bannerMatchesKilometerFilter(banner(null), under5)).toBe(false);

  const range = { ...DEFAULT_BANNER_FILTERS, kilometerFilterMode: "custom", minimumKilometers: "2.5", maximumKilometers: "8" };

  expect(bannerMatchesKilometerFilter(banner(2.5), range)).toBe(true);
  expect(bannerMatchesKilometerFilter(banner(2.4), range)).toBe(false);
  expect(bannerMatchesKilometerFilter(banner(7.9), range)).toBe(true);
  expect(bannerMatchesKilometerFilter(banner(8), range)).toBe(false);
});

test("no distance filter keeps every banner, also without a length", () => {
  expect(bannerMatchesKilometerFilter(banner(null), DEFAULT_BANNER_FILTERS)).toBe(true);
  expect(
    bannerMatchesKilometerFilter(banner(50), { ...DEFAULT_BANNER_FILTERS, kilometerFilterMode: "custom" })
  ).toBe(true);
  expect(countActiveBannerFilters({ ...DEFAULT_BANNER_FILTERS, kilometerFilterMode: "custom" })).toBe(0);
  expect(countActiveBannerFilters({ ...DEFAULT_BANNER_FILTERS, maximumKilometers: "10" })).toBe(1);
});

test("a length-sorted list is past the distance filter once its last banner is beyond the bound", () => {
  const under5 = { ...DEFAULT_BANNER_FILTERS, maximumKilometers: "5" };
  const over10 = { ...DEFAULT_BANNER_FILTERS, kilometerFilterMode: "custom", minimumKilometers: "10" };

  expect(isPastKilometerFilter(banner(4), under5, "ASC")).toBe(false);
  expect(isPastKilometerFilter(banner(5), under5, "ASC")).toBe(true);
  expect(isPastKilometerFilter(banner(2), under5, "DESC")).toBe(false);
  expect(isPastKilometerFilter(banner(9), over10, "DESC")).toBe(true);
  expect(isPastKilometerFilter(banner(12), over10, "DESC")).toBe(false);
  expect(isPastKilometerFilter(banner(50), over10, "ASC")).toBe(false);
  expect(isPastKilometerFilter(undefined, under5, "ASC")).toBe(false);
});
