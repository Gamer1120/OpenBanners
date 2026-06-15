import { DEFAULT_BANNER_FILTERS } from "./bannerFilters";

const BROWSE_STATE_STORAGE_KEY = "openbanners.browse.state";
const BROWSE_STATE_VERSION = 1;
const DEFAULT_SORT_OPTION = "Created";
const DEFAULT_SORT_ORDER = "DESC";
const SORT_OPTIONS = new Set([
  "Created",
  "A-Z",
  "Distance",
  "Nr. of Missions",
  "Efficiency",
]);
const SORT_ORDERS = new Set(["ASC", "DESC"]);

function readStoredState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return JSON.parse(
      window.localStorage.getItem(BROWSE_STATE_STORAGE_KEY) ?? "null"
    );
  } catch {
    return null;
  }
}

function writeStoredState(nextState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      BROWSE_STATE_STORAGE_KEY,
      JSON.stringify({
        ...nextState,
        version: BROWSE_STATE_VERSION,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Storage can fail when the loaded banner list becomes too large.
  }
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object") {
    return null;
  }

  return {
    ...DEFAULT_BANNER_FILTERS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_BANNER_FILTERS).map((key) => [
        key,
        filters[key] ?? DEFAULT_BANNER_FILTERS[key],
      ])
    ),
  };
}

function normalizeBanners(banners) {
  return Array.isArray(banners) ? banners.filter(Boolean) : [];
}

function normalizeSortOption(sortOption) {
  return SORT_OPTIONS.has(sortOption) ? sortOption : DEFAULT_SORT_OPTION;
}

function normalizeSortOrder(sortOrder) {
  return SORT_ORDERS.has(sortOrder) ? sortOrder : DEFAULT_SORT_ORDER;
}

export function getBrowseStateScope({ placeId, authorName } = {}) {
  if (typeof authorName === "string" && authorName) {
    return `agent:${authorName}`;
  }

  return `browse:${typeof placeId === "string" ? placeId : ""}`;
}

export function getDefaultBrowseState() {
  return {
    filters: DEFAULT_BANNER_FILTERS,
    sortOption: DEFAULT_SORT_OPTION,
    sortOrder: DEFAULT_SORT_ORDER,
    banners: [],
    hasMore: true,
    requestedOffset: 0,
    bannersFetchedForEfficiency: false,
    isPlacesListExpanded: false,
    scrollY: 0,
    queryKey: "",
    hasLoaded: false,
  };
}

function normalizeBrowseState(state) {
  const defaultState = getDefaultBrowseState();
  const requestedOffset = Math.max(
    0,
    Math.floor(toFiniteNumber(state?.requestedOffset, 0))
  );
  const scrollY = Math.max(0, toFiniteNumber(state?.scrollY, 0));

  return {
    filters: normalizeFilters(state?.filters) ?? defaultState.filters,
    sortOption: normalizeSortOption(state?.sortOption),
    sortOrder: normalizeSortOrder(state?.sortOrder),
    banners: normalizeBanners(state?.banners),
    hasMore:
      typeof state?.hasMore === "boolean"
        ? state.hasMore
        : defaultState.hasMore,
    requestedOffset,
    bannersFetchedForEfficiency:
      typeof state?.bannersFetchedForEfficiency === "boolean"
        ? state.bannersFetchedForEfficiency
        : defaultState.bannersFetchedForEfficiency,
    isPlacesListExpanded:
      typeof state?.isPlacesListExpanded === "boolean"
        ? state.isPlacesListExpanded
        : defaultState.isPlacesListExpanded,
    scrollY,
    queryKey: typeof state?.queryKey === "string" ? state.queryKey : "",
    hasLoaded:
      typeof state?.hasLoaded === "boolean"
        ? state.hasLoaded
        : defaultState.hasLoaded,
  };
}

export function readBrowseState(scope) {
  const storedState = readStoredState();

  if (
    !storedState ||
    storedState.version !== BROWSE_STATE_VERSION ||
    storedState.scope !== scope
  ) {
    return getDefaultBrowseState();
  }

  return normalizeBrowseState(storedState);
}

export function readBrowseFilters(scope) {
  return readBrowseState(scope).filters;
}

export function saveBrowseState(scope, patch) {
  if (!scope) {
    return;
  }

  const currentState = readBrowseState(scope);

  writeStoredState({
    ...currentState,
    ...patch,
    scope,
    filters: normalizeFilters(patch?.filters ?? currentState.filters),
    sortOption: normalizeSortOption(patch?.sortOption ?? currentState.sortOption),
    sortOrder: normalizeSortOrder(patch?.sortOrder ?? currentState.sortOrder),
    banners: normalizeBanners(patch?.banners ?? currentState.banners),
    requestedOffset: Math.max(
      0,
      Math.floor(toFiniteNumber(patch?.requestedOffset, currentState.requestedOffset))
    ),
    scrollY: Math.max(0, toFiniteNumber(patch?.scrollY, currentState.scrollY)),
  });
}

export function saveBrowseFilters(scope, filters) {
  saveBrowseState(scope, { filters });
}

export function resetBrowseState(scope) {
  if (!scope) {
    return;
  }

  writeStoredState({
    ...getDefaultBrowseState(),
    scope,
  });
}
