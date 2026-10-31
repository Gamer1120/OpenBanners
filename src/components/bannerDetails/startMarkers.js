// Start markers of missions that begin at the same portal. Like Bannergress (its
// MapCluster stacks the labels of markers on one spot in a single pin, one row each),
// these missions share one marker with every mission number stacked in it, instead of
// numbered circles hidden under each other.

// Same tolerance as isOnStartMarker in shared.jsx (~15 m).
export const SAME_START_DEGREES = 0.00015;

function isSameSpot(a, b) {
  return Math.abs(a[0] - b[0]) < SAME_START_DEGREES && Math.abs(a[1] - b[1]) < SAME_START_DEGREES;
}

// missionPositions: per mission (in order) its step positions [[lat, lng], ...].
// Returns [{ position, indexes }] with indexes ascending; one entry per start portal.
export function groupStartMarkers(missionPositions) {
  const groups = [];

  missionPositions.forEach((positions, index) => {
    const start = positions?.[0];

    if (!start) {
      return;
    }

    const group = groups.find((candidate) => isSameSpot(candidate.position, start));

    if (group) {
      group.indexes.push(index);
    } else {
      groups.push({ position: start, indexes: [index] });
    }
  });

  return groups;
}

// The badges of one start marker: a badge per mission, except that a run of three or
// more consecutive missions becomes one range badge ("3–5") so the stack stays short
// while every number stays visible.
export function getStartBadges(indexes) {
  const runs = [];

  indexes.forEach((index) => {
    const run = runs[runs.length - 1];

    if (run && index === run[run.length - 1] + 1) {
      run.push(index);
    } else {
      runs.push([index]);
    }
  });

  return runs.flatMap((run) =>
    run.length >= 3
      ? [{ label: `${run[0] + 1}–${run[run.length - 1] + 1}`, indexes: run }]
      : run.map((index) => ({ label: String(index + 1), indexes: [index] }))
  );
}

// Which mission a tap on a badge selects: its mission, or for a range badge the next
// mission of the range after the selected one (cycling), so each one can be reached.
export function pickBadgeMission(badgeIndexes, selectedMission) {
  const position = badgeIndexes.indexOf(selectedMission);

  return position < 0 ? badgeIndexes[0] : badgeIndexes[(position + 1) % badgeIndexes.length];
}

// Start markers closer together than this many screen pixels share one cluster marker.
export const CLUSTER_RADIUS = 26;

// How close (in screen pixels, across and up/down) two markers may be before they
// overlap: a cluster pill is as wide as its longest possible label ("1111–1146"),
// so for banners with more digits the clusters take in more across.
export function getClusterReach(missionCount) {
  const digits = String(Math.max(1, missionCount)).length;

  return { x: Math.max(CLUSTER_RADIUS, 14 + (2 * digits + 1) * 7), y: CLUSTER_RADIUS };
}

// Start markers (groupStartMarkers) that would overlap on screen at the current zoom
// become one cluster marker, like Bannergress' MapCluster (radius 25). `project` maps
// a [lat, lng] to screen pixels at the current zoom; `reach` is a radius or { x, y };
// `keepAlone(group)` keeps a group out of every cluster (the selected mission). Greedy
// in mission order: a group joins the nearest cluster whose first group (where the
// cluster marker sits) is within reach. Returns [{ position, groups, indexes }] with
// indexes ascending.
export function clusterStartGroups(groups, project, reach = CLUSTER_RADIUS, keepAlone = () => false) {
  const reachX = typeof reach === "number" ? reach : reach.x;
  const reachY = typeof reach === "number" ? reach : reach.y;
  const clusters = [];
  const grid = new Map();
  const cellKey = (x, y) => `${x}:${y}`;

  groups.forEach((group) => {
    const point = project(group.position);

    if (keepAlone(group) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      clusters.push({ groups: [group], point: null });
      return;
    }

    const cellX = Math.floor(point.x / reachX);
    const cellY = Math.floor(point.y / reachY);
    let found = null;
    let foundDistance = Infinity;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        (grid.get(cellKey(cellX + dx, cellY + dy)) ?? []).forEach((cluster) => {
          const across = Math.abs(cluster.point.x - point.x) / reachX;
          const down = Math.abs(cluster.point.y - point.y) / reachY;
          const distance = Math.max(across, down);

          if (distance < 1 && distance < foundDistance) {
            found = cluster;
            foundDistance = distance;
          }
        });
      }
    }

    if (found) {
      found.groups.push(group);
      return;
    }

    const cluster = { groups: [group], point };
    const key = cellKey(cellX, cellY);
    clusters.push(cluster);
    grid.set(key, [...(grid.get(key) ?? []), cluster]);
  });

  return clusters.map(({ groups: members }) => ({
    position: members[0].position,
    groups: members,
    indexes: members.flatMap((group) => group.indexes).sort((a, b) => a - b),
  }));
}

// Label of a cluster marker: "12–40" when its missions are consecutive, else the
// lowest number and how many more ("12 +5").
export function getClusterLabel(indexes) {
  const sorted = [...indexes].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (sorted.length === 1) {
    return String(first + 1);
  }

  return last - first === sorted.length - 1 ? `${first + 1}–${last + 1}` : `${first + 1} +${sorted.length - 1}`;
}

// Waypoints of every mission show from this zoom level on (the selected mission's
// always), like Bannergress showing a mission's portals only from zoom 14.
export const WAYPOINTS_FROM_ZOOM = 15;
