import { useEffect, useMemo, useState } from "react";
import { fetchBannergress } from "./bannergressSync";

// Discovery-map data loading for the map on /map (components/discoveryMap).
// Bannergress /bnrs in a bounding box, paged. The view is covered by fixed
// square tiles on a power-of-two degree grid (2–9 tiles per view), each fetched
// once per filter combination and kept in memory until the page is refreshed.
// Zooming in reuses a loaded bigger tile, zooming out reuses four loaded
// smaller ones, and panning back reuses what was already there (2026-10-22:
// every zoom used to fetch everything again, the cache was per exact view).
const DISCOVERY_MAP_QUERY_PRECISION = 3;
const DISCOVERY_MAP_PAGE_SIZE = 50;

export function roundCoordinate(value, precision = DISCOVERY_MAP_QUERY_PRECISION) {
  return Number.parseFloat(value.toFixed(precision));
}

export function normalizeVisibleArea(visibleArea) {
  if (!visibleArea) {
    return null;
  }

  return {
    minLatitude: roundCoordinate(visibleArea.minLatitude),
    maxLatitude: roundCoordinate(visibleArea.maxLatitude),
    minLongitude: roundCoordinate(visibleArea.minLongitude),
    maxLongitude: roundCoordinate(visibleArea.maxLongitude),
    centerLatitude: roundCoordinate(visibleArea.centerLatitude),
    centerLongitude: roundCoordinate(visibleArea.centerLongitude),
  };
}

export function normalizeOriginLocation(location, fallbackArea) {
  const latitude = location?.latitude ?? fallbackArea?.centerLatitude;
  const longitude = location?.longitude ?? fallbackArea?.centerLongitude;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  };
}

export function createDiscoveryMapQueryKey(visibleArea, originLocation) {
  if (!visibleArea || !originLocation) {
    return "";
  }

  return [
    visibleArea.minLatitude,
    visibleArea.maxLatitude,
    visibleArea.minLongitude,
    visibleArea.maxLongitude,
    originLocation.latitude,
    originLocation.longitude,
  ].join(":");
}

export function buildDiscoveryMapUrl({
  visibleArea,
  originLatitude,
  originLongitude,
  showOfflineBanners,
  limit,
  offset,
}) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("orderBy", "proximityStartPoint");
  url.searchParams.set("orderDirection", "ASC");
  url.searchParams.set("minLatitude", String(visibleArea.minLatitude));
  url.searchParams.set("maxLatitude", String(visibleArea.maxLatitude));
  url.searchParams.set("minLongitude", String(visibleArea.minLongitude));
  url.searchParams.set("maxLongitude", String(visibleArea.maxLongitude));
  url.searchParams.set("proximityLatitude", String(originLatitude));
  url.searchParams.set("proximityLongitude", String(originLongitude));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (!showOfflineBanners) {
    url.searchParams.set("online", "true");
  }

  return url.toString();
}

export async function fetchDiscoveryMapBanners({
  visibleArea,
  originLatitude,
  originLongitude,
  showOfflineBanners,
  showHiddenBanners,
  onPage,
}) {
  let offset = 0;
  let allBanners = [];

  while (true) {
    const pageLimit = DISCOVERY_MAP_PAGE_SIZE;
    const response = await fetchBannergress(
      buildDiscoveryMapUrl({
        visibleArea,
        originLatitude,
        originLongitude,
        showOfflineBanners,
        limit: pageLimit,
        offset,
      }),
      {
        authenticate: !showHiddenBanners,
      }
    );
    const pageData = await response.json();

    if (!Array.isArray(pageData)) {
      return null;
    }

    allBanners = [...allBanners, ...pageData];
    onPage?.({
      banners: allBanners,
      hasMore: pageData.length === pageLimit,
    });

    if (pageData.length < pageLimit) {
      return {
        banners: allBanners,
        hasMore: false,
      };
    }

    offset += pageData.length;
  }
}

export function normalizeFetchedBanners(data, originLatitude, originLongitude) {
  if (!Array.isArray(data)) {
    return null;
  }

  return data
    .map((banner) => {
      const latitude = Number.parseFloat(banner.startLatitude);
      const longitude = Number.parseFloat(banner.startLongitude);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        ...banner,
        _latitude: latitude,
        _longitude: longitude,
        _distanceMeters: calculateDistanceMeters(
          originLatitude,
          originLongitude,
          latitude,
          longitude
        ),
      };
    })
    .filter(Boolean)
    .sort((bannerA, bannerB) => bannerA._distanceMeters - bannerB._distanceMeters);
}

export function getVisibleAreaFromBounds(bounds) {
  const { _southWest, _northEast } = bounds;
  const { lat: minLatitude, lng: minLongitude } = _southWest;
  const { lat: maxLatitude, lng: maxLongitude } = _northEast;

  return {
    minLatitude,
    maxLatitude,
    minLongitude,
    maxLongitude,
    centerLatitude: (minLatitude + maxLatitude) / 2,
    centerLongitude: (minLongitude + maxLongitude) / 2,
  };
}

export function calculateDistanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLatitude = toRadians(latitudeB - latitudeA);
  const dLongitude = toRadians(longitudeB - longitudeA);
  const lat1 = toRadians(latitudeA);
  const lat2 = toRadians(latitudeB);

  const a =
    Math.sin(dLatitude / 2) * Math.sin(dLatitude / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLongitude / 2) *
      Math.sin(dLongitude / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

export function resetDiscoveryMapData() {
  tileCache.clear();
  tileInflight.clear();
}

/* ---------- tiles ---------- */

const TILE_MIN_LEVEL = 1;
const TILE_MAX_LEVEL = 18;
// How many levels of smaller loaded tiles may stand in for a bigger one.
const TILE_CHILD_DEPTH = 3;
// Tiles fetched at the same time (each one pages on its own).
const TILE_CONCURRENCY = 3;

const tileCache = new globalThis.Map();
const tileInflight = new globalThis.Map();
let tileActive = 0;
const tileWaiters = [];

function tileSize(level) {
  return 360 / 2 ** level;
}

// The level whose tiles are at least half the view's larger side, so a view
// spans 2–3 tiles per axis.
export function tileLevelFor(area) {
  const span = Math.max(
    Math.abs(area.maxLatitude - area.minLatitude),
    Math.abs(area.maxLongitude - area.minLongitude),
    1e-6
  );
  const level = Math.floor(Math.log2(360 / (span / 2)));
  return Math.min(TILE_MAX_LEVEL, Math.max(TILE_MIN_LEVEL, level));
}

export function tileBounds({ level, x, y }) {
  const size = tileSize(level);
  return {
    minLongitude: -180 + x * size,
    maxLongitude: -180 + (x + 1) * size,
    minLatitude: Math.max(-90, -90 + y * size),
    maxLatitude: Math.min(90, -90 + (y + 1) * size),
  };
}

export function tilesForArea(area, level = tileLevelFor(area)) {
  const size = tileSize(level);
  const columns = 2 ** level;
  const rows = Math.ceil(180 / size);
  const clamp = (value, max) => Math.min(max - 1, Math.max(0, value));
  const x0 = clamp(Math.floor((area.minLongitude + 180) / size), columns);
  const x1 = clamp(Math.floor((area.maxLongitude + 180) / size), columns);
  const y0 = clamp(Math.floor((area.minLatitude + 90) / size), rows);
  const y1 = clamp(Math.floor((area.maxLatitude + 90) / size), rows);
  const tiles = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      tiles.push({ level, x, y });
    }
  }
  return tiles;
}

function tileKey(tile, filterKey) {
  return `${tile.level}/${tile.x}/${tile.y}:${filterKey}`;
}

function inTile(banner, bounds) {
  const latitude = Number.parseFloat(banner.startLatitude);
  const longitude = Number.parseFloat(banner.startLongitude);
  return (
    latitude >= bounds.minLatitude &&
    latitude <= bounds.maxLatitude &&
    longitude >= bounds.minLongitude &&
    longitude <= bounds.maxLongitude
  );
}

// A tile's complete banners from the cache: its own, a loaded bigger tile's
// (cut to this one), or all four loaded smaller tiles'; null when not known.
export function cachedTileBanners(tile, filterKey, depth = TILE_CHILD_DEPTH) {
  const own = tileCache.get(tileKey(tile, filterKey));
  if (own?.complete) {
    return own.banners;
  }

  let parent = tile;
  while (parent.level > TILE_MIN_LEVEL) {
    parent = { level: parent.level - 1, x: Math.floor(parent.x / 2), y: Math.floor(parent.y / 2) };
    const entry = tileCache.get(tileKey(parent, filterKey));
    if (entry?.complete) {
      const bounds = tileBounds(tile);
      return entry.banners.filter((banner) => inTile(banner, bounds));
    }
  }

  if (depth > 0 && tile.level < TILE_MAX_LEVEL) {
    const parts = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const child = { level: tile.level + 1, x: tile.x * 2 + dx, y: tile.y * 2 + dy };
      const banners = cachedTileBanners(child, filterKey, depth - 1);
      if (!banners) {
        return null;
      }
      parts.push(banners);
    }
    return parts.flat();
  }

  return null;
}

async function withTileSlot(run) {
  if (tileActive >= TILE_CONCURRENCY) {
    await new Promise((resolve) => tileWaiters.push(resolve));
  }
  tileActive += 1;
  try {
    return await run();
  } finally {
    tileActive -= 1;
    tileWaiters.shift()?.();
  }
}

// Fetches one tile (all pages) once; later callers share the same promise.
// onPage gets the tile's banners so far after every page.
function loadTile(tile, filters, filterKey, onPage) {
  const key = tileKey(tile, filterKey);
  const listeners = tileInflight.get(key);
  if (listeners) {
    listeners.onPage.add(onPage);
    return listeners.promise;
  }

  const entry = { onPage: new Set([onPage]), promise: null };
  const bounds = tileBounds(tile);
  entry.promise = withTileSlot(() =>
    fetchDiscoveryMapBanners({
      visibleArea: bounds,
      originLatitude: roundCoordinate((bounds.minLatitude + bounds.maxLatitude) / 2, 5),
      originLongitude: roundCoordinate((bounds.minLongitude + bounds.maxLongitude) / 2, 5),
      showOfflineBanners: filters.showOfflineBanners,
      showHiddenBanners: filters.showHiddenBanners,
      onPage: (pageData) => {
        tileCache.set(key, { banners: pageData.banners, complete: !pageData.hasMore });
        entry.onPage.forEach((listener) => listener());
      },
    })
  )
    .then((data) => {
      if (!data) {
        throw new Error("Map results returned an unexpected response.");
      }
      tileCache.set(key, { banners: data.banners, complete: true });
      return data.banners;
    })
    .finally(() => {
      tileInflight.delete(key);
    });
  tileInflight.set(key, entry);
  return entry.promise;
}

// Loads the banners for a visible area (raw Leaflet-bounds shape, see
// getVisibleAreaFromBounds). filters: { showOfflineBanners, showHiddenBanners }.
export function useDiscoveryMapBanners(visibleArea, userLocation, filters) {
  const [banners, setBanners] = useState([]);
  const [hasMoreBannersInView, setHasMoreBannersInView] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalizedVisibleArea = useMemo(
    () => normalizeVisibleArea(visibleArea),
    [visibleArea]
  );
  const normalizedOriginLocation = useMemo(
    () => normalizeOriginLocation(userLocation, normalizedVisibleArea),
    [normalizedVisibleArea, userLocation]
  );
  const filterKey = [
    filters.showOfflineBanners ? "offline" : "online-only",
    filters.showHiddenBanners ? "show-hidden" : "hide-hidden",
  ].join(":");
  const viewKey = normalizedVisibleArea
    ? createDiscoveryMapQueryKey(normalizedVisibleArea, normalizedOriginLocation)
    : "";

  useEffect(() => {
    if (!normalizedVisibleArea || !normalizedOriginLocation || !viewKey) {
      return undefined;
    }

    let ignore = false;
    const tiles = tilesForArea(normalizedVisibleArea);
    const originLatitude = normalizedOriginLocation.latitude;
    const originLongitude = normalizedOriginLocation.longitude;

    // Everything known for the view's tiles right now, deduplicated.
    const publish = () => {
      if (ignore) {
        return;
      }
      const seen = new Map();
      let pending = false;
      for (const tile of tiles) {
        const complete = cachedTileBanners(tile, filterKey);
        const partial = complete ?? tileCache.get(tileKey(tile, filterKey))?.banners ?? [];
        if (!complete) {
          pending = true;
        }
        for (const banner of partial) {
          if (banner?.id && !seen.has(banner.id)) {
            seen.set(banner.id, banner);
          }
        }
      }
      setBanners(normalizeFetchedBanners([...seen.values()], originLatitude, originLongitude) ?? []);
      setHasMoreBannersInView(pending);
      return pending;
    };

    const timeoutId = window.setTimeout(async () => {
      setError("");
      const missing = tiles.filter((tile) => !cachedTileBanners(tile, filterKey));
      publish();
      if (!missing.length) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const results = await Promise.allSettled(
        missing.map((tile) => loadTile(tile, filters, filterKey, publish))
      );
      if (ignore) {
        return;
      }
      publish();
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        console.error("Error fetching banners:", failed.reason);
        setError("Couldn't load banners in this area. Please try again.");
      }
      setLoading(false);
    }, 220);

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
    };
    // filters is read through filterKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, filterKey]);

  return { banners, hasMore: hasMoreBannersInView, loading, error };
}
