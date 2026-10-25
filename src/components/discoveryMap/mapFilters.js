import { tk } from "../../i18n";
export const MISSION_OPTIONS = Object.freeze([
  { id: "any", label: tk("Any missions") },
  ...[6, 12, 18, 24, 30].map((min) => ({ id: `${min}+`, label: `${min}+`, min })),
]);

export const STATUS_OPTIONS = Object.freeze([
  { id: "all", label: tk("All") },
  { id: "todo", label: tk("To do only") },
  { id: "hideDone", label: tk("Hide Done") },
]);

// "< 5 km" … "< 20 km", plus a custom min–max range. Always km.
export function distanceOptions() {
  return [
    { id: "any", label: tk("Any distance") },
    ...[5, 10, 15, 20].map((max) => ({ id: `lt${max}`, label: `< ${max} km`, max })),
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

// distMin / distMax are in km.
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
export function applyMapFilters(banners, filters) {
  const normalized = normalizeMapFilters(filters);
  const missions = findOption(MISSION_OPTIONS, normalized.missions);
  const status = normalized.status;
  let minMeters = null;
  let maxMeters = null;

  if (normalized.distance === "custom") {
    minMeters = normalized.distMin === null ? null : normalized.distMin * 1000;
    maxMeters = normalized.distMax === null ? null : normalized.distMax * 1000;
  } else if (normalized.distance !== "any") {
    maxMeters = findOption(distanceOptions(), normalized.distance).max * 1000;
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

function customDistanceLabel({ distMin, distMax }) {
  if (distMin !== null && distMax !== null) {
    return `${distMin}–${distMax} km`;
  }

  if (distMin !== null) {
    return `≥ ${distMin} km`;
  }

  if (distMax !== null) {
    return `< ${distMax} km`;
  }

  return tk("Any distance");
}

export function filterSummary(filters) {
  const normalized = normalizeMapFilters(filters);
  return {
    missions: findOption(MISSION_OPTIONS, normalized.missions).label,
    status: findOption(STATUS_OPTIONS, normalized.status).label,
    distance:
      normalized.distance === "custom"
        ? customDistanceLabel(normalized)
        : findOption(distanceOptions(), normalized.distance).label,
  };
}
