import { walkingMinutes } from "./mapMath";

export const WALK_OPTIONS = Object.freeze([
  { id: "any", label: "Any length" },
  { id: "short", label: "< 30 min", maxMinutes: 30 },
  { id: "hour", label: "30 min – 1 h", minMinutes: 30, maxMinutes: 60 },
  { id: "half", label: "1 – 2 h", minMinutes: 60, maxMinutes: 120 },
  { id: "long", label: "2 h +", minMinutes: 120 },
]);

export const MISSION_OPTIONS = Object.freeze([
  { id: "any", label: "Any missions" },
  { id: "6", label: "≤ 6", max: 6 },
  { id: "12", label: "7 – 12", min: 7, max: 12 },
  { id: "24", label: "13 – 24", min: 13, max: 24 },
  { id: "25", label: "25 +", min: 25 },
]);

export const STATUS_OPTIONS = Object.freeze([
  { id: "all", label: "All" },
  { id: "todo", label: "To do only" },
  { id: "hideDone", label: "Hide Done" },
]);

export const DEFAULT_MAP_FILTERS = Object.freeze({ walk: "any", missions: "any", status: "hideDone" });
// Key from the filters prototype, kept so saved filters survive.
export const MAP_FILTERS_STORAGE_KEY = "openbanners.mapVariant.filters";

function findOption(options, id) {
  return options.find((option) => option.id === id) ?? options[0];
}

export function normalizeMapFilters(value) {
  return {
    walk: findOption(WALK_OPTIONS, value?.walk).id,
    missions: findOption(MISSION_OPTIONS, value?.missions).id,
    status: findOption(STATUS_OPTIONS, value?.status ?? DEFAULT_MAP_FILTERS.status).id,
  };
}

export function countActiveMapFilters(filters) {
  const normalized = normalizeMapFilters(filters);
  return [normalized.walk !== "any", normalized.missions !== "any", normalized.status !== "all"].filter(Boolean)
    .length;
}

// banners carry _status (see mapStatus.withStatus).
export function applyMapFilters(banners, filters) {
  const walk = findOption(WALK_OPTIONS, filters?.walk);
  const missions = findOption(MISSION_OPTIONS, filters?.missions);
  const status = findOption(STATUS_OPTIONS, filters?.status).id;

  return banners.filter((banner) => {
    if (status === "todo" && banner._status !== "todo") {
      return false;
    }

    if (status === "hideDone" && banner._status === "done") {
      return false;
    }

    if (walk.id !== "any") {
      const minutes = walkingMinutes(banner?.lengthMeters);

      if (minutes === null) {
        return false;
      }

      if (walk.minMinutes !== undefined && minutes < walk.minMinutes) {
        return false;
      }

      if (walk.maxMinutes !== undefined && minutes >= walk.maxMinutes) {
        return false;
      }
    }

    if (missions.id !== "any") {
      const count = Number(banner?.numberOfMissions);

      if (!Number.isFinite(count)) {
        return false;
      }

      if (missions.min !== undefined && count < missions.min) {
        return false;
      }

      if (missions.max !== undefined && count > missions.max) {
        return false;
      }
    }

    return true;
  });
}

export function filterSummary(filters) {
  const normalized = normalizeMapFilters(filters);
  return {
    walk: findOption(WALK_OPTIONS, normalized.walk).label,
    missions: findOption(MISSION_OPTIONS, normalized.missions).label,
    status: findOption(STATUS_OPTIONS, normalized.status).label,
  };
}
