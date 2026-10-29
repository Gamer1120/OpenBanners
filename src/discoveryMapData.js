import { useEffect, useMemo, useState } from "react";
import { fetchBannergress } from "./bannergressSync";
import { t } from "./i18n";

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

// One page of a /bnrs bounding-box query; null when the answer isn't a list.
export async function fetchDiscoveryMapPage({
  visibleArea,
  originLatitude,
  originLongitude,
  showOfflineBanners,
  showHiddenBanners,
  offset,
  signal,
}) {
  const response = await fetchBannergress(
    buildDiscoveryMapUrl({
      visibleArea,
      originLatitude,
      originLongitude,
      showOfflineBanners,
      limit: DISCOVERY_MAP_PAGE_SIZE,
      offset,
    }),
    {
      authenticate: !showHiddenBanners,
      signal,
    }
  );
  const pageData = await response.json();
  return Array.isArray(pageData) ? pageData : null;
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
  for (const [key, load] of [...tileInflight]) {
    stopTile(key, load);
  }
  tileCache.clear();
  tileInflight.clear();
  pageWaiters.splice(0).forEach((waiter) => waiter.resolve(null));
  pageActive = 0;
  pageEpoch += 1;
}

/* ---------- tiles ---------- */

const TILE_MIN_LEVEL = 1;
const TILE_MAX_LEVEL = 18;
// How many levels of smaller loaded tiles may stand in for a bigger one.
const TILE_CHILD_DEPTH = 3;
// Pages fetched at the same time, over all tiles.
const TILE_CONCURRENCY = 3;
// A tile no view wants any more stops this long after the view left it
// (longer than the view debounce, so a small pan doesn't restart it).
const TILE_RELEASE_GRACE_MS = 400;

const tileCache = new globalThis.Map();
const tileInflight = new globalThis.Map();

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

// Every banner already downloaded inside a tile, complete or not: from its
// own (partial) entry, from loaded or loading smaller tiles inside it at any
// depth, and from bigger tiles around it (cut to this one). Shown while the
// tile itself is still loading, so zooming out never hides dots that were
// already on the map (2026-10-29).
export function knownTileBanners(tile, filterKey) {
  const bounds = tileBounds(tile);
  const suffix = `:${filterKey}`;
  const found = [];
  for (const [key, entry] of tileCache) {
    if (!key.endsWith(suffix)) {
      continue;
    }
    const [level, x, y] = key.slice(0, -suffix.length).split("/").map(Number);
    const shift = level - tile.level;
    if (shift >= 0) {
      if (Math.floor(x / 2 ** shift) === tile.x && Math.floor(y / 2 ** shift) === tile.y) {
        found.push(...entry.banners);
      }
    } else if (Math.floor(tile.x / 2 ** -shift) === x && Math.floor(tile.y / 2 ** -shift) === y) {
      found.push(...entry.banners.filter((banner) => inTile(banner, bounds)));
    }
  }
  return found;
}

/* ---------- page scheduler ----------
 * Zoomed out, one tile can hold thousands of banners (hundreds of pages of
 * 50, fetched one after another). The slots used to be taken per tile and
 * handed out first come, first served, so after zooming out and then in
 * somewhere else the new view waited minutes behind the old tiles
 * (2026-10-29, Michael). Now slots are taken per page and go to the newest
 * view first, centre tile first; a tile no view wants any more stops (its
 * open request is aborted, its queued pages dropped) and keeps the pages it
 * already has, continuing from there when a view needs it again.
 */
let pageActive = 0;
let pageEpoch = 0;
let viewGeneration = 0;
const pageWaiters = [];

function tilePriority(load) {
  let generation = -1;
  let distance = Infinity;
  for (const holder of load.holders.values()) {
    const latScale = Math.cos((holder.centerLatitude * Math.PI) / 180);
    const d =
      (load.centerLatitude - holder.centerLatitude) ** 2 +
      ((load.centerLongitude - holder.centerLongitude) * latScale) ** 2;
    if (holder.generation > generation || (holder.generation === generation && d < distance)) {
      generation = holder.generation;
      distance = d;
    }
  }
  return { generation, distance };
}

// The order waiting pages get a slot in: newest view first, then nearest
// to that view's centre.
export function comparePagePriority(a, b) {
  return b.generation - a.generation || a.distance - b.distance;
}

function drainPageWaiters() {
  for (let index = pageWaiters.length - 1; index >= 0; index -= 1) {
    if (pageWaiters[index].load.stopped) {
      pageWaiters.splice(index, 1)[0].resolve(null);
    }
  }
  while (pageActive < TILE_CONCURRENCY && pageWaiters.length) {
    let best = 0;
    let bestPriority = tilePriority(pageWaiters[0].load);
    for (let index = 1; index < pageWaiters.length; index += 1) {
      const priority = tilePriority(pageWaiters[index].load);
      if (comparePagePriority(priority, bestPriority) < 0) {
        best = index;
        bestPriority = priority;
      }
    }
    const [next] = pageWaiters.splice(best, 1);
    pageActive += 1;
    next.resolve(pageEpoch);
  }
}

// Resolves with a slot ticket, or null when the tile was stopped meanwhile.
function acquirePageSlot(load) {
  return new Promise((resolve) => {
    pageWaiters.push({ load, resolve });
    drainPageWaiters();
  });
}

function releasePageSlot(ticket) {
  if (ticket === pageEpoch) {
    pageActive -= 1;
  }
  drainPageWaiters();
}

function stopTile(key, load) {
  load.stopped = true;
  if (tileInflight.get(key) === load) {
    tileInflight.delete(key);
  }
  load.controller?.abort();
  drainPageWaiters();
}

function releaseTile(key, load, token) {
  load.holders.delete(token);
  if (load.holders.size || load.stopped) {
    return;
  }
  window.setTimeout(() => {
    if (!load.holders.size && !load.stopped) {
      stopTile(key, load);
    }
  }, TILE_RELEASE_GRACE_MS);
}

async function runTile(load, key, tile, filters) {
  const bounds = tileBounds(tile);
  const origin = {
    originLatitude: roundCoordinate(load.centerLatitude, 5),
    originLongitude: roundCoordinate(load.centerLongitude, 5),
  };
  // Continue a tile that was stopped part-way instead of starting over.
  let banners = tileCache.get(key)?.banners ?? [];
  let offset = banners.length;

  while (true) {
    const ticket = await acquirePageSlot(load);
    if (ticket === null) {
      return null;
    }
    let pageData;
    try {
      if (load.stopped) {
        return null;
      }
      load.controller = typeof AbortController === "function" ? new AbortController() : null;
      pageData = await fetchDiscoveryMapPage({
        visibleArea: bounds,
        ...origin,
        showOfflineBanners: filters.showOfflineBanners,
        showHiddenBanners: filters.showHiddenBanners,
        offset,
        signal: load.controller?.signal,
      });
    } catch (error) {
      if (load.stopped) {
        return null;
      }
      throw error;
    } finally {
      load.controller = null;
      releasePageSlot(ticket);
    }

    if (load.stopped) {
      return null;
    }
    if (!pageData) {
      throw new Error("Map results returned an unexpected response.");
    }
    const known = new Set(banners.map((banner) => banner?.id));
    banners = [...banners, ...pageData.filter((banner) => !known.has(banner?.id))];
    const complete = pageData.length < DISCOVERY_MAP_PAGE_SIZE;
    tileCache.set(key, { banners, complete });
    load.holders.forEach((holder) => holder.onPage());
    if (complete) {
      return banners;
    }
    offset += pageData.length;
  }
}

// Fetches one tile (all pages) once; later callers share the same load.
// holder: { generation, centerLatitude, centerLongitude, onPage }, called
// with the tile's banners in the cache after every page. Returns the load's
// promise (banners, or null if it was stopped) and a release function.
function loadTile(tile, filters, filterKey, holder) {
  const key = tileKey(tile, filterKey);
  const token = {};
  let load = tileInflight.get(key);
  if (!load) {
    const bounds = tileBounds(tile);
    load = {
      holders: new globalThis.Map(),
      controller: null,
      stopped: false,
      centerLatitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
      centerLongitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
      promise: null,
    };
    load.holders.set(token, holder);
    const current = load;
    load.promise = runTile(load, key, tile, filters).finally(() => {
      if (tileInflight.get(key) === current) {
        tileInflight.delete(key);
      }
    });
    tileInflight.set(key, load);
  } else {
    load.holders.set(token, holder);
    drainPageWaiters();
  }
  const current = load;
  return { promise: load.promise, release: () => releaseTile(key, current, token) };
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
    const releases = [];
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
        const partial = complete ?? knownTileBanners(tile, filterKey);
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
      // Centre tile first; this view's pages go before any older view's.
      const generation = (viewGeneration += 1);
      const holder = {
        generation,
        centerLatitude: normalizedVisibleArea.centerLatitude,
        centerLongitude: normalizedVisibleArea.centerLongitude,
        onPage: publish,
      };
      const centerDistance = (tile) => {
        const bounds = tileBounds(tile);
        return (
          ((bounds.minLatitude + bounds.maxLatitude) / 2 - holder.centerLatitude) ** 2 +
          ((bounds.minLongitude + bounds.maxLongitude) / 2 - holder.centerLongitude) ** 2
        );
      };
      const loads = [...missing]
        .sort((a, b) => centerDistance(a) - centerDistance(b))
        .map((tile) => loadTile(tile, filters, filterKey, holder));
      loads.forEach((load) => releases.push(load.release));
      const results = await Promise.allSettled(loads.map((load) => load.promise));
      if (ignore) {
        return;
      }
      publish();
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        console.error("Error fetching banners:", failed.reason);
        setError(t("Couldn't load banners in this area. Please try again."));
      }
      setLoading(false);
    }, 220);

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
      // Tiles only this view wanted stop shortly (see the page scheduler).
      releases.forEach((release) => release());
    };
    // filters is read through filterKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, filterKey]);

  return { banners, hasMore: hasMoreBannersInView, loading, error };
}
