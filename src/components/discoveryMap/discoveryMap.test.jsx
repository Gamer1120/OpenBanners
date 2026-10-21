import { beforeEach, describe, expect, test } from "vitest";
import { applyMapFilters, countActiveMapFilters, filterSummary, normalizeMapFilters } from "./mapFilters";
import { getBannerStatus, withStatus } from "./mapStatus";
import { formatMinutes, isInsideArea, walkingMinutes } from "./mapMath";

function banner(id, latitude, longitude, extra = {}) {
  return { id, title: id, _latitude: latitude, _longitude: longitude, ...extra };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("map math", () => {
  test("formats walking time", () => {
    expect(walkingMinutes(4500)).toBeCloseTo(60);
    expect(walkingMinutes("x")).toBeNull();
    expect(formatMinutes(42)).toBe("40 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(137)).toBe("2 h 15");
    expect(formatMinutes(NaN)).toBe("?");
  });

  test("counts a banner in view by its start point", () => {
    const area = { minLatitude: 52, maxLatitude: 53, minLongitude: 6, maxLongitude: 7 };
    expect(isInsideArea(banner("in", 52.2, 6.9), area)).toBe(true);
    expect(isInsideArea(banner("out", 51.9, 6.9), area)).toBe(false);
    expect(isInsideArea({ startLatitude: "52.5", startLongitude: "6.5" }, area)).toBe(true);
    expect(isInsideArea({ id: "nowhere" }, area)).toBe(false);
  });
});

describe("filters", () => {
  const banners = [
    banner("todo-short", 0, 0, { _status: "todo", lengthMeters: 1500, numberOfMissions: 6 }),
    banner("done-long", 0, 0, { _status: "done", lengthMeters: 12000, numberOfMissions: 36 }),
    banner("none-hour", 0, 0, { _status: "none", lengthMeters: 3500, numberOfMissions: 12 }),
    banner("none-unknown", 0, 0, { _status: "none" }),
  ];
  const ids = (filters) => applyMapFilters(banners, filters).map((item) => item.id);

  test("status: all, To do only, hide Done", () => {
    expect(ids({ status: "all" })).toEqual(["todo-short", "done-long", "none-hour", "none-unknown"]);
    expect(ids({ status: "todo" })).toEqual(["todo-short"]);
    expect(ids({ status: "hideDone" })).toEqual(["todo-short", "none-hour", "none-unknown"]);
  });

  test("mission count is a minimum (6+ … 30+); unknown counts drop out", () => {
    expect(ids({ status: "all", missions: "6+" })).toEqual(["todo-short", "done-long", "none-hour"]);
    expect(ids({ status: "all", missions: "12+" })).toEqual(["done-long", "none-hour"]);
    expect(ids({ status: "all", missions: "18+" })).toEqual(["done-long"]);
    expect(ids({ status: "all", missions: "30+" })).toEqual(["done-long"]);
  });

  test("normalizes and counts filters", () => {
    expect(normalizeMapFilters({ missions: "nope" })).toEqual({ missions: "any", status: "hideDone" });
    expect(countActiveMapFilters({ missions: "12+", status: "all" })).toBe(1);
    expect(countActiveMapFilters({ status: "all" })).toBe(0);
    expect(filterSummary({})).toEqual({ missions: "Any missions", status: "Hide Done" });
  });
});

describe("status", () => {
  const syncState = { bannerLists: { a: "todo", b: "done", c: "blacklist", d: null } };

  test("uses the synced list first and the API listType as fallback", () => {
    expect(getBannerStatus({ id: "a" }, syncState)).toBe("todo");
    expect(getBannerStatus({ id: "b", listType: "todo" }, syncState)).toBe("done");
    expect(getBannerStatus({ id: "c" }, syncState)).toBe("hidden");
    expect(getBannerStatus({ id: "d", listType: "done" }, syncState)).toBe("none");
    expect(getBannerStatus({ id: "x", listType: "done" }, syncState)).toBe("done");
    expect(getBannerStatus({ id: "y" }, syncState)).toBe("none");
  });

  test("withStatus tags banners and leaves Hidden ones out", () => {
    const tagged = withStatus([{ id: "a" }, { id: "c" }, { id: "y" }], syncState);
    expect(tagged).toEqual([
      { id: "a", _status: "todo" },
      { id: "y", _status: "none" },
    ]);
  });
});

test("clusterByPixels groups dots within the radius and keeps far ones apart", async () => {
  const { clusterByPixels } = await import("./mapMath");
  const clusters = clusterByPixels(
    [
      { x: 0, y: 0, id: "a" },
      { x: 20, y: 10, id: "b" },
      { x: 200, y: 0, id: "c" },
    ],
    34
  );

  expect(clusters.map((cluster) => cluster.items.map((item) => item.id))).toEqual([["a", "b"], ["c"]]);
});
