// A Bannergress banner keys its missions by position in the banner ("0", "2", "3", …).
// Positions can be left out on purpose: filler slots, e.g. a mission that belongs to
// another banner. Bannergress then keeps an empty tile in the artwork (so the picture
// still lines up), lists and numbers only the missions that are there (1, 2, 3, …) and
// doesn't join the route across the gap.

function positionOf(key) {
  const position = Number(key);
  return Number.isInteger(position) && position >= 0 ? position : null;
}

// [{ position, mission }] in banner order; empty entries are left out.
export function getMissionEntries(missionsByPosition) {
  const entries = Object.entries(missionsByPosition ?? {})
    .filter(([, mission]) => mission && typeof mission === "object")
    .map(([key, mission], order) => ({ position: positionOf(key), mission, order }));
  const numbered = entries
    .filter((entry) => entry.position !== null)
    .sort((a, b) => a.position - b.position);
  // Keys that aren't positions (never seen from Bannergress) go after the rest.
  let next = numbered.length ? numbered[numbered.length - 1].position + 1 : 0;
  const unnumbered = entries
    .filter((entry) => entry.position === null)
    .map((entry) => ({ ...entry, position: next++ }));

  return [...numbered, ...unnumbered].map(({ position, mission }) => ({ position, mission }));
}

// The banner's missions in banner order, without the gaps.
export function getMissionList(missionsByPosition) {
  return getMissionEntries(missionsByPosition).map((entry) => entry.mission);
}

// For every mission of getMissionList, its 0-based position (slot) in the banner.
export function getMissionSlots(missionsByPosition) {
  return getMissionEntries(missionsByPosition).map((entry) => entry.position);
}

// Slots of the artwork: one per position up to the last mission's.
export function getSlotCount(slots) {
  return slots.length ? Math.max(...slots) + 1 : 0;
}

// Whether mission index and index + 1 sit side by side (no filler slot between them).
export function areAdjacent(slots, index) {
  return !slots || slots[index + 1] === undefined || slots[index + 1] === slots[index] + 1;
}
