export const MISSION_OPTIONS = Object.freeze([
  { id: "any", label: "Any missions" },
  ...[6, 12, 18, 24, 30].map((min) => ({ id: `${min}+`, label: `${min}+`, min })),
]);

export const STATUS_OPTIONS = Object.freeze([
  { id: "all", label: "All" },
  { id: "todo", label: "To do only" },
  { id: "hideDone", label: "Hide Done" },
]);

export const DEFAULT_MAP_FILTERS = Object.freeze({ missions: "any", status: "hideDone" });
// Key from the filters prototype, kept so saved filters survive.
export const MAP_FILTERS_STORAGE_KEY = "openbanners.mapVariant.filters";

function findOption(options, id) {
  return options.find((option) => option.id === id) ?? options[0];
}

export function normalizeMapFilters(value) {
  return {
    missions: findOption(MISSION_OPTIONS, value?.missions).id,
    status: findOption(STATUS_OPTIONS, value?.status ?? DEFAULT_MAP_FILTERS.status).id,
  };
}

export function countActiveMapFilters(filters) {
  const normalized = normalizeMapFilters(filters);
  return [normalized.missions !== "any", normalized.status !== "all"].filter(Boolean)
    .length;
}

// banners carry _status (see mapStatus.withStatus).
export function applyMapFilters(banners, filters) {
  const missions = findOption(MISSION_OPTIONS, filters?.missions);
  const status = findOption(STATUS_OPTIONS, filters?.status).id;

  return banners.filter((banner) => {
    if (status === "todo" && banner._status !== "todo") {
      return false;
    }

    if (status === "hideDone" && banner._status === "done") {
      return false;
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
    missions: findOption(MISSION_OPTIONS, normalized.missions).label,
    status: findOption(STATUS_OPTIONS, normalized.status).label,
  };
}
