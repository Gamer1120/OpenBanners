import { areAdjacent, getMissionEntries, getMissionList, getMissionSlots, getSlotCount } from "./bannerMissions";

// Shape of https://api.bannergress.com/bnrs/广式双马尾-f8aa: width 6, position 1 is a
// filler slot (the Bronze mission belongs to another banner).
const missionsWithGap = {
  0: { id: "locked", title: "Locked" },
  2: { id: "silver", title: "Silver" },
  3: { id: "gold", title: "Gold" },
  4: { id: "platinum", title: "Platinum" },
  5: { id: "onyx", title: "Onyx" },
};

test("keeps each mission's position when a position is left out", () => {
  expect(getMissionList(missionsWithGap).map((mission) => mission.id)).toEqual([
    "locked",
    "silver",
    "gold",
    "platinum",
    "onyx",
  ]);
  expect(getMissionSlots(missionsWithGap)).toEqual([0, 2, 3, 4, 5]);
  expect(getSlotCount(getMissionSlots(missionsWithGap))).toBe(6);
});

test("sorts positions numerically and skips empty entries", () => {
  const entries = getMissionEntries({ 10: { id: "c" }, 2: { id: "b" }, 0: { id: "a" }, 1: null });
  expect(entries.map((entry) => [entry.position, entry.mission.id])).toEqual([
    [0, "a"],
    [2, "b"],
    [10, "c"],
  ]);
  expect(getMissionList(undefined)).toEqual([]);
  expect(getSlotCount([])).toBe(0);
});

test("a banner without gaps keeps index = position", () => {
  const missions = { 0: { id: "a" }, 1: { id: "b" }, 2: { id: "c" } };
  expect(getMissionSlots(missions)).toEqual([0, 1, 2]);
  expect(getMissionList(missions)).toEqual(Object.values(missions));
});

test("missions on both sides of a filler slot are not adjacent", () => {
  const slots = [0, 2, 3];
  expect(areAdjacent(slots, 0)).toBe(false);
  expect(areAdjacent(slots, 1)).toBe(true);
  expect(areAdjacent(undefined, 0)).toBe(true);
});
