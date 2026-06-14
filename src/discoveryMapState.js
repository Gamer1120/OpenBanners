import { DEFAULT_MAP_BANNER_FILTERS } from "./bannerFilters";

const DISCOVERY_MAP_STATE_STORAGE_KEY = "openbanners.discoveryMap.state";
const DISCOVERY_MAP_STATE_VERSION = 1;

function readStoredState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return JSON.parse(
      window.localStorage.getItem(DISCOVERY_MAP_STATE_STORAGE_KEY) ?? "null"
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
      DISCOVERY_MAP_STATE_STORAGE_KEY,
      JSON.stringify({
        ...nextState,
        version: DISCOVERY_MAP_STATE_VERSION,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore storage failures; the map should continue working normally.
  }
}

function toFiniteNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object") {
    return null;
  }

  return {
    ...DEFAULT_MAP_BANNER_FILTERS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_MAP_BANNER_FILTERS).map((key) => [
        key,
        filters[key] ?? DEFAULT_MAP_BANNER_FILTERS[key],
      ])
    ),
  };
}

function normalizeViewport(viewport) {
  if (!viewport || typeof viewport !== "object") {
    return null;
  }

  const latitude = toFiniteNumber(viewport.center?.latitude);
  const longitude = toFiniteNumber(viewport.center?.longitude);
  const zoom = toFiniteNumber(viewport.zoom);

  if (
    latitude === null ||
    longitude === null ||
    zoom === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    center: {
      latitude,
      longitude,
    },
    zoom,
  };
}

export function readDiscoveryMapState() {
  const storedState = readStoredState();

  if (!storedState || storedState.version !== DISCOVERY_MAP_STATE_VERSION) {
    return {
      filters: DEFAULT_MAP_BANNER_FILTERS,
      viewport: null,
      selectedBannerId: null,
    };
  }

  return {
    filters: normalizeFilters(storedState.filters) ?? DEFAULT_MAP_BANNER_FILTERS,
    viewport: normalizeViewport(storedState.viewport),
    selectedBannerId:
      typeof storedState.selectedBannerId === "string"
        ? storedState.selectedBannerId
        : null,
  };
}

export function readDiscoveryMapFilters() {
  return readDiscoveryMapState().filters;
}

export function saveDiscoveryMapFilters(filters) {
  const currentState = readDiscoveryMapState();

  writeStoredState({
    ...currentState,
    filters: normalizeFilters(filters) ?? DEFAULT_MAP_BANNER_FILTERS,
  });
}

export function saveDiscoveryMapViewport(viewport) {
  const currentState = readDiscoveryMapState();
  const normalizedViewport = normalizeViewport(viewport);

  if (!normalizedViewport) {
    return;
  }

  writeStoredState({
    ...currentState,
    viewport: normalizedViewport,
  });
}

export function saveDiscoveryMapSelectedBanner(selectedBannerId) {
  const currentState = readDiscoveryMapState();

  writeStoredState({
    ...currentState,
    selectedBannerId:
      typeof selectedBannerId === "string" ? selectedBannerId : null,
  });
}
