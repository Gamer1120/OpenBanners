// Banner facts Bannergress shows on its banner page and the banner page here
// didn't: event dates, last checked, unique portals, actions per type, mixed
// mission types, start-to-finish distance and a time that admits missing data.
// Pure helpers over the Bannergress banner DTO; see bannerFacts.test.js.

import { getLanguage, t, tk, tn } from "./i18n";

export const OBJECTIVE_LABELS = {
  hack: tk("Hack"),
  captureOrUpgrade: tk("Capture or upgrade"),
  createLink: tk("Create link"),
  createField: tk("Create field"),
  installMod: tk("Install mod"),
  takePhoto: tk("Take photo"),
  viewWaypoint: tk("View waypoint"),
  enterPassphrase: tk("Enter passphrase"),
  hidden: tk("Hidden"),
};

export const MISSION_TYPE_LABELS = {
  sequential: tk("In sequence"),
  anyOrder: tk("Any order"),
  hidden: tk("Hidden"),
};

function stepsOf(mission) {
  return Object.values(mission?.steps ?? {});
}

function positionOf(step) {
  const poi = step?.poi;
  if (!poi || poi.type === "unavailable") {
    return null;
  }
  const latitude = Number(poi.latitude);
  const longitude = Number(poi.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
}

// Distinct portals visited; `hidden` when a hidden mission may add more (Bannergress shows "+").
export function getUniquePortals(missions) {
  const ids = new Set();
  for (const mission of missions) {
    for (const step of stepsOf(mission)) {
      if (step?.poi?.type === "portal" && step.poi.id) {
        ids.add(step.poi.id);
      }
    }
  }
  return { count: ids.size, hidden: missions.some((mission) => mission?.type === "hidden") };
}

// [{ key, label, count }] in first-seen order. Hidden steps (no objective)
// count as "Hidden"; unavailable waypoints with an objective don't count.
export function getActionCounts(missions) {
  const counts = new Map();
  for (const mission of missions) {
    for (const step of stepsOf(mission)) {
      if (step?.objective && step?.poi?.type === "unavailable") {
        continue;
      }
      const key = step?.objective || "hidden";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([key, count]) => ({ key, label: OBJECTIVE_LABELS[key] ? t(OBJECTIVE_LABELS[key]) : key, count }));
}

// [{ key, label, count }] of the missions' own types.
export function getMissionTypes(missions) {
  const counts = new Map();
  for (const mission of missions) {
    if (mission?.type) {
      counts.set(mission.type, (counts.get(mission.type) ?? 0) + 1);
    }
  }
  return [...counts].map(([key, count]) => ({
    key,
    label: MISSION_TYPE_LABELS[key] ? t(MISSION_TYPE_LABELS[key]) : key,
    count,
  }));
}

// The oldest "latest update" of all missions, as YYYY-MM-DD; null unless every
// mission has one (as Bannergress does).
export function getLastChecked(missions, numberOfMissions) {
  const dates = missions
    .map((mission) => (mission?.latestUpdateStatus ? new Date(mission.latestUpdateStatus) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));
  const expected = Number(numberOfMissions) || missions.length;
  if (!dates.length || dates.length !== expected) {
    return null;
  }
  const oldest = dates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  return oldest.toISOString().slice(0, 10);
}

function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

// Straight line from the first to the last waypoint; null when it's 100 m or
// less (a loop) or either end is unknown, as on Bannergress.
export function getStartToFinishMeters(missions) {
  if (!missions.length) {
    return null;
  }
  const first = stepsOf(missions[0]).map(positionOf).find(Boolean);
  const last = stepsOf(missions[missions.length - 1]).map(positionOf).filter(Boolean).pop();
  if (!first || !last) {
    return null;
  }
  const meters = haversineMeters(first, last);
  return meters > 100 ? meters : null;
}

// Total time, or null ("missing data") when any mission is offline, a
// placeholder or has no time: a partial sum would look shorter than it is.
export function getTotalDurationMs(missions, numberOfMissions) {
  const expected = Number(numberOfMissions) || missions.length;
  if (!missions.length || missions.length < expected) {
    return null;
  }
  let total = 0;
  for (const mission of missions) {
    const ms = Number(mission?.averageDurationMilliseconds) || 0;
    if (!mission || mission.status !== "published" || ms <= 0) {
      return null;
    }
    total += ms;
  }
  return total;
}

// "Event on …" / "Event from … to …"; "" without an event date.
export function formatEvent(start, end, locale) {
  if (!start) {
    return "";
  }
  const fmt = (value) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  return !end || end === start
    ? t("Event on {date}", { date: fmt(start) })
    : t("Event from {start} to {end}", { start: fmt(start), end: fmt(end) });
}

// "bad" when the planned offline date has passed, "warn" within 14 days, "" otherwise.
export function plannedOfflineTone(date, now = Date.now()) {
  const days = (new Date(date).getTime() - now) / 86_400_000;
  if (!Number.isFinite(days)) {
    return "";
  }
  return days <= 0 ? "bad" : days <= 14 ? "warn" : "";
}

export function isPassphraseStep(step) {
  return step?.objective === "enterPassphrase";
}

// Missions with a passphrase step, as [{ index, steps: [stepIndex, …] }] in
// banner order. Hidden steps can't be known, so hidden missions never count.
export function getPassphraseMissions(missions) {
  return missions
    .map((mission, index) => ({
      index,
      steps: stepsOf(mission)
        .map((step, stepIndex) => (isPassphraseStep(step) ? stepIndex : -1))
        .filter((stepIndex) => stepIndex >= 0),
    }))
    .filter((entry) => entry.steps.length);
}

// The separators before each of `count` list items in the user's language
// ("", ", ", " and " in English), so JSX lists can join links the same way.
export function listJoins(count) {
  const language = getLanguage();
  // en-GB: no comma before "and", as the English texts always had.
  const parts = new Intl.ListFormat(language === "en" ? "en-GB" : language, { type: "conjunction" }).formatToParts(
    Array.from({ length: count }, (_, index) => String(index))
  );
  const joins = Array(count).fill("");
  let pending = "";
  let item = 0;
  for (const part of parts) {
    if (part.type === "element") {
      joins[item++] = pending;
      pending = "";
    } else {
      pending += part.value;
    }
  }
  return joins;
}

function formatList(items) {
  const joins = listJoins(items.length);
  return items.map((value, index) => joins[index] + value).join("");
}

// "Mission 4", "Missions 2 and 5", "Missions 1, 3 and 6", "Missions 2–30"
// (1-based; runs of three or more become a range). `withWord` false gives just
// the numbers ("1, 3 and 6") for a sentence that has its own "Mission(s)".
export function formatMissionNumbers(indexes, withWord = true) {
  const numbers = [...indexes].sort((a, b) => a - b).map((index) => index + 1);
  const parts = [];
  for (let i = 0; i < numbers.length; ) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) {
      j++;
    }
    if (j - i >= 2) {
      parts.push(`${numbers[i]}–${numbers[j]}`);
    } else {
      parts.push(...numbers.slice(i, j + 1).map(String));
    }
    i = j + 1;
  }
  const list = formatList(parts);
  return withWord ? tn("Mission {numbers}", "Missions {numbers}", numbers.length, { numbers: list }) : list;
}
