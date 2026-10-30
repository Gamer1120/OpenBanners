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
