import { describe, expect, it } from "vitest";
import {
  formatEvent,
  getActionCounts,
  getLastChecked,
  getMissionTypes,
  getStartToFinishMeters,
  getTotalDurationMs,
  getUniquePortals,
  plannedOfflineTone,
} from "./bannerFacts";

const portal = (id, lat, lng) => ({ id, type: "portal", latitude: lat, longitude: lng });
const missions = [
  {
    type: "sequential",
    status: "published",
    averageDurationMilliseconds: 60000,
    latestUpdateStatus: "2026-10-01T10:00:00Z",
    steps: [
      { objective: "hack", poi: portal("a", 52.0, 6.0) },
      { objective: "captureOrUpgrade", poi: portal("b", 52.001, 6.0) },
    ],
  },
  {
    type: "anyOrder",
    status: "published",
    averageDurationMilliseconds: 120000,
    latestUpdateStatus: "2026-09-01T10:00:00Z",
    steps: [
      { objective: "hack", poi: portal("a", 52.0, 6.0) },
      { objective: "hack", poi: { type: "unavailable" } },
      { poi: portal("c", 52.01, 6.0) },
    ],
  },
];

describe("bannerFacts", () => {
  it("counts each portal once", () => {
    expect(getUniquePortals(missions)).toEqual({ count: 3, hidden: false });
  });

  it("counts actions per type, hidden steps included, unavailable ones not", () => {
    expect(getActionCounts(missions)).toEqual([
      { key: "hack", label: "Hack", count: 2 },
      { key: "captureOrUpgrade", label: "Capture or upgrade", count: 1 },
      { key: "hidden", label: "Hidden", count: 1 },
    ]);
  });

  it("lists mixed mission types", () => {
    expect(getMissionTypes(missions).map((t) => t.label)).toEqual(["In sequence", "Any order"]);
  });

  it("takes the oldest update, only when every mission has one", () => {
    expect(getLastChecked(missions, 2)).toBe("2026-09-01");
    expect(getLastChecked(missions, 3)).toBeNull();
  });

  it("measures start to finish only past 100 m", () => {
    expect(Math.round(getStartToFinishMeters(missions))).toBe(1112);
    expect(getStartToFinishMeters([missions[0]])).toBeGreaterThan(100);
    expect(getStartToFinishMeters([{ steps: [{ poi: portal("a", 52, 6) }] }])).toBeNull();
  });

  it("gives no total time when a mission has none or is offline", () => {
    expect(getTotalDurationMs(missions, 2)).toBe(180000);
    expect(getTotalDurationMs([missions[0], { ...missions[1], averageDurationMilliseconds: 0 }], 2)).toBeNull();
    expect(getTotalDurationMs([missions[0], { ...missions[1], status: "disabled" }], 2)).toBeNull();
  });

  it("formats event dates", () => {
    expect(formatEvent("", "")).toBe("");
    expect(formatEvent("2026-10-12", "2026-10-12", "en-GB")).toBe("Event on 12 October 2026");
    expect(formatEvent("2026-10-12", "2026-10-14", "en-GB")).toBe(
      "Event from 12 October 2026 to 14 October 2026"
    );
  });

  it("colours a near planned offline date", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    expect(plannedOfflineTone("2026-10-20", now)).toBe("bad");
    expect(plannedOfflineTone("2026-10-30", now)).toBe("warn");
    expect(plannedOfflineTone("2027-01-01", now)).toBe("");
  });
});
