import { describe, expect, it } from "vitest";
import { getStartBadges, groupStartMarkers, pickBadgeMission } from "./startMarkers";

describe("shared start portals", () => {
  it("puts missions that start at the same portal on one marker", () => {
    const groups = groupStartMarkers([
      [[52, 6], [52.001, 6]],
      [[52.002, 6]],
      [[52, 6.00001]],
      [],
      [[52.002, 6], [52.003, 6]],
      [[52, 6]],
    ]);

    expect(groups).toEqual([
      { position: [52, 6], indexes: [0, 2, 5] },
      { position: [52.002, 6], indexes: [1, 4] },
    ]);
  });

  it("shows every mission number, runs of three or more as a range", () => {
    expect(getStartBadges([4]).map((badge) => badge.label)).toEqual(["5"]);
    expect(getStartBadges([2, 3]).map((badge) => badge.label)).toEqual(["3", "4"]);
    expect(getStartBadges([2, 6]).map((badge) => badge.label)).toEqual(["3", "7"]);
    expect(getStartBadges([0, 2, 3, 4, 8, 9]).map((badge) => badge.label)).toEqual([
      "1",
      "3–5",
      "9",
      "10",
    ]);
    expect(getStartBadges([2, 3, 4])[0].indexes).toEqual([2, 3, 4]);
  });

  it("cycles through the missions of a range badge", () => {
    expect(pickBadgeMission([6], -1)).toBe(6);
    expect(pickBadgeMission([2, 3, 4], -1)).toBe(2);
    expect(pickBadgeMission([2, 3, 4], 2)).toBe(3);
    expect(pickBadgeMission([2, 3, 4], 4)).toBe(2);
    expect(pickBadgeMission([2, 3, 4], 7)).toBe(2);
  });
});
