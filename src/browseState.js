import { DEFAULT_BANNER_FILTERS } from "./bannerFilters";

const BROWSE_STATE_STORAGE_KEY = "openbanners.browse.state";
// Search results keep their own slot, so a search doesn't wipe the place you
// were browsing.
const SEARCH_STATE_STORAGE_KEY = "openbanners.search.state";
const SEARCH_SCOPE_PREFIX = "search:";
const BROWSE_STATE_VERSION = 1;
// "Show offline banners" lasts for this tab only (sessionStorage), so Back
// keeps it but a new visit starts with offline banners hidden again.
const SESSION_OFFLINE_STORAGE_KEY = "openbanners.browse.showOffline";
const DEFAULT_SORT_OPTION = "Created";
const DEFAULT_SORT_ORDER = "DESC";
const SEARCH_SORT_OPTION = "Relevance";
const SORT_OPTIONS = new Set([
  "Relevance",
  "Created",
  "A-Z",
  "Distance",
  "Nr. of Missions",
  "Efficiency",
]);
const SORT_ORDERS = new Set(["ASC", "DESC"]);

function isSearchScope(scope) {
  return typeof scope === "string" && scope.startsWith(SEARCH_SCOPE_PREFIX);
}

function getStorageKey(scope) {
  return isSearchScope(scope) ? SEARCH_STATE_STORAGE_KEY : BROWSE_STATE_STORAGE_KEY;
}

function readStoredState(scope) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return JSON.parse(
      window.localStorage.getItem(getStorageKey(scope)) ?? "null"
    );
  } catch {
    return null;
  }
}

function readSessionOffline() {
  try {
    return JSON.parse(window.sessionStorage.getItem(SESSION_OFFLINE_STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writeSessionOffline(scope, showOfflineBanners) {
  try {
    const byScope = readSessionOffline();
    if (showOfflineBanners) {
      byScope[scope] = true;
    } else {
      delete byScope[scope];
    }
    window.sessionStorage.setItem(SESSION_OFFLINE_STORAGE_KEY, JSON.stringify(byScope));
  } catch {
    // Without sessionStorage it just isn't remembered.
  }
}

function writeStoredState(nextState) {
  if (typeof window === "undefined") {
    return;
  }

  if (nextState.filters) {
    writeSessionOffline(nextState.scope, Boolean(nextState.filters.showOfflineBanners));
  }

  try {
    window.localStorage.setItem(
      getStorageKey(nextState.scope),
      JSON.stringify({
        ...nextState,
        // Offline banners are hidden by default; showing them is only
        // remembered for this tab (see SESSION_OFFLINE_STORAGE_KEY).
        filters: nextState.filters
          ? { ...nextState.filters, showOfflineBanners: false }
          : nextState.filters,
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

// Best match is the default (and only makes sense) for search results.
function normalizeSortOption(sortOption, scope) {
  const searching = isSearchScope(scope);

  if (SORT_OPTIONS.has(sortOption) && (searching || sortOption !== SEARCH_SORT_OPTION)) {
    return sortOption;
  }

  return searching ? SEARCH_SORT_OPTION : DEFAULT_SORT_OPTION;
}

function normalizeSortOrder(sortOrder) {
  return SORT_ORDERS.has(sortOrder) ? sortOrder : DEFAULT_SORT_ORDER;
}

export function getBrowseStateScope({ placeId, authorName, query } = {}) {
  if (typeof query === "string" && query) {
    return `${SEARCH_SCOPE_PREFIX}${query}`;
  }

  if (typeof authorName === "string" && authorName) {
    return `agent:${authorName}`;
  }

  return `browse:${typeof placeId === "string" ? placeId : ""}`;
}

export function getDefaultBrowseState(scope) {
  return {
    filters: DEFAULT_BANNER_FILTERS,
    sortOption: normalizeSortOption(null, scope),
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

function normalizeBrowseState(state, scope) {
  const defaultState = getDefaultBrowseState(scope);
  const requestedOffset = Math.max(
    0,
    Math.floor(toFiniteNumber(state?.requestedOffset, 0))
  );
  const scrollY = Math.max(0, toFiniteNumber(state?.scrollY, 0));

  return {
    filters: normalizeFilters(state?.filters) ?? defaultState.filters,
    sortOption: normalizeSortOption(state?.sortOption, scope),
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
  const storedState = readStoredState(scope);

  if (
    !storedState ||
    storedState.version !== BROWSE_STATE_VERSION ||
    storedState.scope !== scope
  ) {
    return getDefaultBrowseState(scope);
  }

  const state = normalizeBrowseState(storedState, scope);
  return readSessionOffline()[scope]
    ? { ...state, filters: { ...state.filters, showOfflineBanners: true } }
    : state;
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
    sortOption: normalizeSortOption(
      patch?.sortOption ?? currentState.sortOption,
      scope
    ),
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
    ...getDefaultBrowseState(scope),
    scope,
  });
}
