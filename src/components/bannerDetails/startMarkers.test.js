import { describe, expect, it } from "vitest";
import { getStartBadges, groupStartMarkers, pickBadgeMission, clusterStartGroups, getClusterLabel, getClusterReach } from "./startMarkers";

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

describe("start marker clusters", () => {
  // 1 px per 0.001° so distances are easy to read.
  const project = ([lat, lng]) => ({ x: lng * 1000, y: -lat * 1000 });
  const group = (lat, lng, ...indexes) => ({ position: [lat, lng], indexes });

  it("merges start markers that would overlap on screen, in mission order", () => {
    const groups = [group(0, 0, 0), group(0, 0.015, 1), group(0, 0.03, 2), group(0, 0.1, 3), group(0, 0.11, 4)];
    const clusters = clusterStartGroups(groups, project, 26);
    expect(clusters.map((cluster) => cluster.indexes)).toEqual([[0, 1], [2], [3, 4]]);
    // The cluster sits on its first mission's start.
    expect(clusters[2].position).toEqual([0, 0.1]);
  });

  it("keeps the selected mission's marker on its own", () => {
    const groups = [group(0, 0, 0), group(0, 0.005, 1), group(0, 0.01, 2)];
    const clusters = clusterStartGroups(groups, project, 26, (marker) => marker.indexes.includes(1));
    expect(clusters.map((cluster) => cluster.indexes)).toEqual([[0, 2], [1]]);
  });

  it("leaves markers alone when it can't project (no map yet)", () => {
    const groups = [group(0, 0, 0), group(0, 0, 1)];
    expect(clusterStartGroups(groups, () => null).map((cluster) => cluster.indexes)).toEqual([[0], [1]]);
  });

  it("reaches further across for wider pills", () => {
    expect(getClusterReach(6)).toEqual({ x: 35, y: 26 });
    expect(getClusterReach(1152)).toEqual({ x: 77, y: 26 });
    // 40 px apart across: separate for a 6-mission banner, one pill for a 1152-mission one.
    const groups = [group(0, 0, 0), group(0, 0.04, 1)];
    expect(clusterStartGroups(groups, project, getClusterReach(6))).toHaveLength(2);
    expect(clusterStartGroups(groups, project, getClusterReach(1152))).toHaveLength(1);
  });

  it("labels consecutive missions as a range, others as first + count", () => {
    expect(getClusterLabel([11, 12, 13])).toBe("12–14");
    expect(getClusterLabel([4, 0])).toBe("1 +1");
    expect(getClusterLabel([7])).toBe("8");
  });
});
