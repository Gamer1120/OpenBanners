import { describe, expect, it } from "vitest";
import { applyOps, missionsOf, sharedTitlePrefix } from "./missionPlans";

describe("mission plans", () => {
  it("applies changes locally like the server", () => {
    let plan = { id: "p", title: "MD", banners: ["b1"], items: [] };
    plan = applyOps(plan, [
      { op: "add", bannerId: "b1", missionId: "m1" },
      { op: "add", bannerId: "b1", missionId: "m2" },
      { op: "add", bannerId: "b2", missionId: "m9", index: 0 },
      { op: "add", bannerId: "b1", missionId: "m1" },
    ]);
    expect(plan.items.map((item) => item.missionId)).toEqual(["m9", "m1", "m2"]);
    expect(plan.banners).toEqual(["b1", "b2"]);
    plan = applyOps(plan, [{ op: "move", missionId: "m9", index: 2 }, { op: "done", missionId: "m1", done: true }]);
    expect(plan.items.map((item) => `${item.missionId}${item.done ? "!" : ""}`)).toEqual(["m1!", "m2", "m9"]);
    plan = applyOps(plan, [{ op: "removeBanner", bannerId: "b2" }, { op: "remove", missionId: "m1" }, { op: "title", title: " " }]);
    expect(plan.items.map((item) => item.missionId)).toEqual(["m2"]);
    expect(plan.title).toBe("MD");
  });

  it("numbers a banner's missions in banner order with their first and last portal", () => {
    const poi = (latitude) => ({ poi: { latitude, longitude: 4 } });
    const missions = missionsOf({
      missions: {
        1: { id: "b", title: "Two", steps: [poi(2), poi(3)], status: "published" },
        0: { id: "a", title: "One", steps: [poi(1)], status: "disabled" },
      },
    });
    expect(missions.map((mission) => [mission.id, mission.number, mission.offline])).toEqual([["a", 1, true], ["b", 2, false]]);
    expect(missions[1].start.latitude).toBe(2);
    expect(missions[1].end.latitude).toBe(3);
  });

  it("leaves out the title part all missions share", () => {
    expect(sharedTitlePrefix(["MD 2026: Paris, Pont de Sully", "MD 2026: Paris, Pont Neuf"])).toBe("MD 2026: Paris,");
    expect(sharedTitlePrefix(["Cats 01", "Cats 02"])).toBe("Cats ");
    expect(sharedTitlePrefix(["Alone"])).toBe("");
    const missions = missionsOf({ missions: { 0: { id: "a", title: "MD: Rome 1", steps: [] }, 1: { id: "b", title: "MD: Rome 2", steps: [] } } });
    expect(missions.map((mission) => mission.shortTitle)).toEqual(["Rome 1", "Rome 2"]);
  });
});
