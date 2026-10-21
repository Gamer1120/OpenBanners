export const MISSION_OPTIONS = Object.freeze([
  { id: "any", label: "Any missions" },
  ...[6, 12, 18, 24, 30].map((min) => ({ id: `${min}+`, label: `${min}+`, min })),
]);

export const STATUS_OPTIONS = Object.freeze([
  { id: "all", label: "All" },
  { id: "todo", label: "To do only" },
  { id: "hideDone", label: "Hide Done" },
]);

export const METERS_PER_UNIT = Object.freeze({ km: 1000, mi: 1609.344 });
const MILE_REGIONS = new Set(["US", "GB", "LR", "MM"]);

// Miles for people whose locale is in a miles country (US, UK, Liberia, Myanmar).
export function preferredDistanceUnit(languages = globalThis.navigator?.languages ?? []) {
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).maximize().region;

      if (region) {
        return MILE_REGIONS.has(region) ? "mi" : "km";
      }
    } catch {
      // Malformed tag: try the next one.
    }
  }

  return "km";
}

// "< 5 km" … "< 20 km" (or mi), plus a custom min–max range.
export function distanceOptions(unit = "km") {
  return [
    { id: "any", label: "Any distance" },
    ...[5, 10, 15, 20].map((max) => ({ id: `lt${max}`, label: `< ${max} ${unit}`, max })),
    { id: "custom", label: "Custom" },
  ];
}

export const DEFAULT_MAP_FILTERS = Object.freeze({
  missions: "any",
  status: "hideDone",
  distance: "any",
  distMin: null,
  distMax: null,
});
// Key from the filters prototype, kept so saved filters survive.
export const MAP_FILTERS_STORAGE_KEY = "openbanners.mapVariant.filters";

function findOption(options, id) {
  return options.find((option) => option.id === id) ?? options[0];
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// distMin / distMax are in the user's unit (whatever the inputs showed).
export function normalizeMapFilters(value) {
  return {
    missions: findOption(MISSION_OPTIONS, value?.missions).id,
    status: findOption(STATUS_OPTIONS, value?.status ?? DEFAULT_MAP_FILTERS.status).id,
    distance: findOption(distanceOptions(), value?.distance).id,
    distMin: toNumberOrNull(value?.distMin),
    distMax: toNumberOrNull(value?.distMax),
  };
}

function distanceActive(normalized) {
  if (normalized.distance === "custom") {
    return normalized.distMin !== null || normalized.distMax !== null;
  }

  return normalized.distance !== "any";
}

export function countActiveMapFilters(filters) {
  const normalized = normalizeMapFilters(filters);
  return [normalized.missions !== "any", normalized.status !== "all", distanceActive(normalized)].filter(Boolean)
    .length;
}

// banners carry _status (see mapStatus.withStatus).
export function applyMapFilters(banners, filters, unit = "km") {
  const normalized = normalizeMapFilters(filters);
  const missions = findOption(MISSION_OPTIONS, normalized.missions);
  const status = normalized.status;
  const perUnit = METERS_PER_UNIT[unit] ?? METERS_PER_UNIT.km;
  let minMeters = null;
  let maxMeters = null;

  if (normalized.distance === "custom") {
    minMeters = normalized.distMin === null ? null : normalized.distMin * perUnit;
    maxMeters = normalized.distMax === null ? null : normalized.distMax * perUnit;
  } else if (normalized.distance !== "any") {
    maxMeters = findOption(distanceOptions(unit), normalized.distance).max * perUnit;
  }

  return banners.filter((banner) => {
    if (status === "todo" && banner._status !== "todo") {
      return false;
    }

    if (status === "hideDone" && banner._status === "done") {
      return false;
    }

    if (minMeters !== null || maxMeters !== null) {
      const meters = Number(banner?.lengthMeters);

      if (!Number.isFinite(meters)) {
        return false;
      }

      if (minMeters !== null && meters < minMeters) {
        return false;
      }

      if (maxMeters !== null && meters >= maxMeters) {
        return false;
      }
    }

    if (missions.id !== "any") {
      const count = Number(banner?.numberOfMissions);

      if (!Number.isFinite(count) || count < missions.min) {
        return false;
      }
    }

    return true;
  });
}

function customDistanceLabel({ distMin, distMax }, unit) {
  if (distMin !== null && distMax !== null) {
    return `${distMin}–${distMax} ${unit}`;
  }

  if (distMin !== null) {
    return `≥ ${distMin} ${unit}`;
  }

  if (distMax !== null) {
    return `< ${distMax} ${unit}`;
  }

  return "Any distance";
}

export function filterSummary(filters, unit = "km") {
  const normalized = normalizeMapFilters(filters);
  return {
    missions: findOption(MISSION_OPTIONS, normalized.missions).label,
    status: findOption(STATUS_OPTIONS, normalized.status).label,
    distance:
      normalized.distance === "custom"
        ? customDistanceLabel(normalized, unit)
        : findOption(distanceOptions(unit), normalized.distance).label,
  };
}
