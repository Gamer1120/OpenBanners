import { useEffect, useMemo, useState } from "react";
import { fetchBannergress } from "./bannergressSync";

// Discovery-map data loading shared by the classic map (components/Map.jsx) and the
// map prototypes (components/mapVariants). Bannergress /bnrs in a bounding box, paged,
// with an in-memory cache per area + origin + filter combination.
const DISCOVERY_MAP_QUERY_PRECISION = 3;
const DISCOVERY_MAP_PAGE_SIZE = 50;

const discoveryMapCache = new globalThis.Map();
const discoveryMapInflightRequests = new globalThis.Map();

function writeDiscoveryMapCacheEntry({
  requestKey,
  banners,
  hasMore,
  complete,
}) {
  discoveryMapCache.set(requestKey, {
    banners,
    hasMore,
    complete,
  });
}

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
  discoveryMapCache.clear();
  discoveryMapInflightRequests.clear();
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
  const discoveryMapQueryKey = useMemo(
    () =>
      createDiscoveryMapQueryKey(normalizedVisibleArea, normalizedOriginLocation),
    [normalizedOriginLocation, normalizedVisibleArea]
  );
  const discoveryMapRequestKey = useMemo(
    () =>
      discoveryMapQueryKey
        ? [
            discoveryMapQueryKey,
            filters.showOfflineBanners ? "offline" : "online-only",
            filters.showHiddenBanners ? "show-hidden" : "hide-hidden",
          ].join(":")
        : "",
    [
      discoveryMapQueryKey,
      filters.showHiddenBanners,
      filters.showOfflineBanners,
    ]
  );

  useEffect(() => {
    if (!normalizedVisibleArea || !normalizedOriginLocation || !discoveryMapRequestKey) {
      return undefined;
    }

    let ignore = false;
    const timeoutId = window.setTimeout(async () => {
      setError("");
      const cachedEntry = discoveryMapCache.get(discoveryMapRequestKey);

      if (cachedEntry) {
        setBanners(cachedEntry.banners);
        setHasMoreBannersInView(Boolean(cachedEntry.hasMore));

        if (cachedEntry.complete) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);

      const originLatitude = normalizedOriginLocation.latitude;
      const originLongitude = normalizedOriginLocation.longitude;

      try {
        let responsePromise = discoveryMapInflightRequests.get(
          discoveryMapRequestKey
        );

        if (!responsePromise) {
          responsePromise = fetchDiscoveryMapBanners({
            visibleArea: normalizedVisibleArea,
            originLatitude,
            originLongitude,
            showOfflineBanners: filters.showOfflineBanners,
            showHiddenBanners: filters.showHiddenBanners,
            onPage: (pageData) => {
              const normalizedBanners = normalizeFetchedBanners(
                pageData.banners,
                originLatitude,
                originLongitude
              );

              if (normalizedBanners) {
                writeDiscoveryMapCacheEntry({
                  requestKey: discoveryMapRequestKey,
                  banners: normalizedBanners,
                  hasMore: pageData.hasMore,
                  complete: !pageData.hasMore,
                });

                if (!ignore) {
                  setBanners(normalizedBanners);
                  setHasMoreBannersInView(pageData.hasMore);
                }
              }
            },
          });
          discoveryMapInflightRequests.set(
            discoveryMapRequestKey,
            responsePromise
          );
        }

        const data = await responsePromise;

        if (ignore) {
          return;
        }

        const normalizedBanners = normalizeFetchedBanners(
          data?.banners,
          originLatitude,
          originLongitude
        );

        if (!normalizedBanners) {
          setBanners([]);
          setHasMoreBannersInView(false);
          setError("Map results returned an unexpected response.");
          return;
        }

        writeDiscoveryMapCacheEntry({
          requestKey: discoveryMapRequestKey,
          banners: normalizedBanners,
          hasMore: data.hasMore,
          complete: true,
        });
        setBanners(normalizedBanners);
        setHasMoreBannersInView(data.hasMore);
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching banners:", fetchError);
          setBanners([]);
          setHasMoreBannersInView(false);
          setError("Couldn't load banners in this area. Please try again.");
        }
      } finally {
        discoveryMapInflightRequests.delete(discoveryMapRequestKey);

        if (!ignore) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    discoveryMapRequestKey,
    filters.showHiddenBanners,
    filters.showOfflineBanners,
    normalizedOriginLocation,
    normalizedVisibleArea,
  ]);

  return { banners, hasMore: hasMoreBannersInView, loading, error };
}
