import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MyLocation, NearMe } from "@mui/icons-material";
import BannerWall, { BannerRows, useInfiniteScroll } from "./BannerWall";
import { useRememberEntry, useRestoredEntry } from "../scrollRestoration";
import AboutNotice from "./AboutNotice";
import BannerFilterButton from "./BannerFilterButton";
import ViewModeToggle, { useBannerViewMode } from "./ViewModeToggle";
import {
  fetchBannergress,
  forgetTemporarilyVisibleHiddenBanners,
  useBannergressSync,
} from "../bannergressSync";
import {
  DEFAULT_BANNER_FILTERS,
  applyBannerFilters,
  getMissionCountBounds,
} from "../bannerFilters";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import { getPlaceName, readCachedCity, resolveCityAt } from "../cityPlace";
import { t } from "../i18n";

const NEARBY_PAGE_SIZE = 24;

const NEARBY_LOCATION_STORAGE_KEY = "openbanners-nearby-location";
const CACHED_LOCATION_MAX_AGE_MS = 10 * 60 * 1000;
const CACHED_LOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: Infinity,
  timeout: 1000,
};
const FRESH_LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 4000,
};

export function loadCachedNearbyLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.sessionStorage.getItem(NEARBY_LOCATION_STORAGE_KEY);

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue);

    if (
      !Number.isFinite(parsedValue?.latitude) ||
      !Number.isFinite(parsedValue?.longitude) ||
      !Number.isFinite(parsedValue?.savedAt)
    ) {
      return null;
    }

    if (Date.now() - parsedValue.savedAt > CACHED_LOCATION_MAX_AGE_MS) {
      return null;
    }

    return {
      latitude: parsedValue.latitude,
      longitude: parsedValue.longitude,
    };
  } catch {
    return null;
  }
}

export function saveCachedNearbyLocation(location) {
  if (
    typeof window === "undefined" ||
    !Number.isFinite(location?.latitude) ||
    !Number.isFinite(location?.longitude)
  ) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      NEARBY_LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

// Small GPS jitter keeps the loaded list.
function isSameSpot(a, b) {
  return Boolean(
    a &&
      b &&
      Math.abs(a.latitude - b.latitude) < 0.0005 &&
      Math.abs(a.longitude - b.longitude) < 0.0005
  );
}

export default function BannersNearMe({
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  // Back to this page brings the loaded pages for the same spot (no refetch).
  const { entryKey, restored } = useRestoredEntry("near");
  const restoredRef = useRef(restored);
  const [location, setLocation] = useState(restored?.location ?? null);
  const [bannerData, setBannerData] = useState(restored?.bannerData ?? []);
  // Coming back here drops banners that were only kept visible right after "Hide".
  useState(forgetTemporarilyVisibleHiddenBanners);
  const syncState = useBannergressSync();
  const [viewMode, setViewMode] = useBannerViewMode();
  const visibleBanners = useMemo(() => {
    const { minimumMissions, maximumMissions } = getMissionCountBounds(bannerFilters);

    return applyBannerFilters(bannerData, syncState, bannerFilters).filter((banner) => {
      const missions = Number(banner?.numberOfMissions);

      if (!Number.isFinite(missions)) {
        return true;
      }

      return (
        (minimumMissions === null || missions >= minimumMissions) &&
        (maximumMissions === null || missions <= maximumMissions)
      );
    });
  }, [bannerData, bannerFilters, syncState]);
  const showOffline = Boolean(bannerFilters?.showOfflineBanners);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(restored?.hasMore ?? true);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [error, setError] = useState("");
  const [permissionState, setPermissionState] = useState("checking");
  const [city, setCity] = useState(() => {
    const cached = readCachedCity();
    return cached?.picked ? cached.place : null;
  });
  const sentinelRef = useRef(null);
  const requestInFlightRef = useRef(false);

  const requestCurrentPosition = (options, { silent = false } = {}) => {
    setError("");

    if (!silent) {
      setLoading(true);
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const nextLocation = { latitude, longitude };
        saveCachedNearbyLocation(nextLocation);
        setLocation((currentLocation) =>
          isSameSpot(currentLocation, nextLocation)
            ? currentLocation
            : nextLocation
        );
      },
      (positionError) => {
        console.error("Error getting location:", positionError);

        if (!silent) {
          setLoading(false);
          setError(
            t("Couldn't determine your location. Please check your browser location settings and try again.")
          );
        }
      },
      options
    );
  };

  useEffect(() => {
    let ignore = false;
    const cachedLocation = loadCachedNearbyLocation();

    const handlePermission = (status) => {
      if (ignore) {
        return;
      }

      setPermissionState(status);

      if (status === "granted") {
        setShowPermissionPrompt(false);
        if (cachedLocation) {
          setLocation((currentLocation) =>
            isSameSpot(currentLocation, cachedLocation)
              ? currentLocation
              : cachedLocation
          );
        }
        if (!cachedLocation) {
          setError("");
          setLoading(true);
        }

        requestCurrentPosition(CACHED_LOCATION_OPTIONS, {
          silent: true,
        });
        requestCurrentPosition(FRESH_LOCATION_OPTIONS, {
          silent: Boolean(cachedLocation),
        });
      } else if (status === "prompt") {
        setShowPermissionPrompt(true);
        setLoading(false);
      } else {
        setShowPermissionPrompt(false);
        setLoading(false);
      }
    };

    if ("geolocation" in navigator && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          handlePermission(result.state);
          result.onchange = () => {
            handlePermission(result.state);
          };
        })
        .catch((permissionError) => {
          console.error("Error checking location permissions:", permissionError);
          setPermissionState("unknown");
          setShowPermissionPrompt(true);
        });
    } else if ("geolocation" in navigator) {
      setPermissionState("unknown");
      setShowPermissionPrompt(true);
    } else {
      setPermissionState("unsupported");
      setLoading(false);
      setError(t("This browser does not support geolocation."));
    }

    return () => {
      ignore = true;
    };
  }, []);

  const loadPage = useCallback(
    async (offset, { signal } = {}) => {
      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint&orderDirection=ASC${
        showOffline ? "" : "&online=true"
      }&proximityLatitude=${location.latitude}&proximityLongitude=${location.longitude}&limit=${NEARBY_PAGE_SIZE}&offset=${offset}`;
      const response = await fetchBannergress(apiUrl, { signal });
      return response.json();
    },
    [location, showOffline]
  );

  useEffect(() => {
    if (!location) {
      return undefined;
    }

    const restoredList = restoredRef.current;
    restoredRef.current = null;

    if (
      restoredList &&
      restoredList.location === location &&
      restoredList.showOffline === showOffline
    ) {
      return undefined;
    }

    let ignore = false;
    requestInFlightRef.current = true;
    setLoading(true);
    setError("");
    setHasMore(true);

    loadPage(0)
      .then((data) => {
        if (ignore) {
          return;
        }

        if (Array.isArray(data)) {
          setBannerData(data);
          setHasMore(data.length === NEARBY_PAGE_SIZE);

          if (!readCachedCity()?.picked) {
            resolveCityAt(location, data)
              .then((resolvedCity) => {
                if (!ignore) {
                  setCity(resolvedCity);
                }
              })
              .catch(() => {});
          }
        } else {
          setBannerData([]);
          setHasMore(false);
          setError(t("Nearby banners returned an unexpected response."));
        }
      })
      .catch((fetchError) => {
        console.error("Error fetching banner data:", fetchError);

        if (!ignore) {
          setBannerData([]);
          setHasMore(false);
          setError(t("Couldn't load nearby banners. Please try again."));
        }
      })
      .finally(() => {
        requestInFlightRef.current = false;

        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [location, loadPage]);

  const handleLoadMore = useCallback(() => {
    if (!location || !hasMore || loading || requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    setLoadingMore(true);

    loadPage(bannerData.length)
      .then((data) => {
        if (Array.isArray(data)) {
          setBannerData((currentBanners) => {
            const seen = new Set(currentBanners.map((banner) => banner.id));
            return [...currentBanners, ...data.filter((banner) => !seen.has(banner.id))];
          });
          setHasMore(data.length === NEARBY_PAGE_SIZE);
        } else {
          setHasMore(false);
        }
      })
      .catch((fetchError) => {
        console.error("Error fetching more banners:", fetchError);
        setHasMore(false);
      })
      .finally(() => {
        requestInFlightRef.current = false;
        setLoadingMore(false);
      });
  }, [bannerData.length, hasMore, loadPage, loading, location]);

  useRememberEntry(
    entryKey,
    "near",
    location && !loading && !error
      ? { location, bannerData, hasMore, showOffline }
      : null
  );

  useInfiniteScroll(sentinelRef, {
    enabled: Boolean(location) && hasMore && !loading && !loadingMore,
    onLoadMore: handleLoadMore,
    itemCount: bannerData.length,
  });

  const handleGrantLocationAccess = () => {
    setShowPermissionPrompt(false);
    requestCurrentPosition(FRESH_LOCATION_OPTIONS);
  };

  const handleRetry = () => {
    if (location) {
      requestCurrentPosition(FRESH_LOCATION_OPTIONS);
      return;
    }

    if (permissionState === "denied" || permissionState === "unsupported") {
      setShowPermissionPrompt(true);
      return;
    }

    handleGrantLocationAccess();
  };

  const cityName = getPlaceName(city);
  // One sentence with a link in the middle, split at the link.
  const [blockedBeforeLink, blockedAfterLink] = t(
    "Location access is blocked. Allow it in your browser to use nearby banners, or pick a place under {link}."
  ).split("{link}");

  return (
    <div className="ob-page">
      <header className="ob-sec-head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <nav className="crumbs scope" aria-label={t("Scope")}>
            <span className="scope-near on" aria-current="page">
              <NearMe fontSize="inherit" />
              {t("Near you")}
            </span>
            <span aria-hidden="true">·</span>
            <Link to="/browse/" onClick={() => resetBrowseState(getBrowseStateScope())}>
              {t("All countries")}
            </Link>
            {city?.id ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  to={`/browse/${encodeURIComponent(city.id)}`}
                  onClick={() => resetBrowseState(getBrowseStateScope({ placeId: city.id }))}
                >
                  {cityName}
                </Link>
              </>
            ) : null}
          </nav>
          <h1 className="ob-h1">{t("Near you")}</h1>
          <p className="small muted">{t("Closest start point first.")}</p>
        </div>
      </header>

      <section aria-label={t("Banners near you")} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="toolbar">
          <BannerFilterButton
            filters={bannerFilters}
            onChange={onBannerFiltersChange}
            showMinimumMissionsFilter
          />
          <span className="grow" />
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>

        {!location && (showPermissionPrompt || permissionState === "checking" || permissionState === "unknown") ? (
          <div className="loc-card">
            <span className="loc-ic">
              <NearMe />
            </span>
            <div className="grow">
              <b>{t("See what’s around you")}</b>
              <span className="small">
                {t(
                  "Enable location access to load nearby banners. Your location stays in this browser, only the search itself is sent."
                )}
              </span>
              <div className="acts">
                <button type="button" className="btn filled sl" onClick={handleGrantLocationAccess}>
                  <MyLocation fontSize="small" />
                  {t("Grant location access")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!showPermissionPrompt && permissionState === "denied" ? (
          <div className="ob-alert warn" role="alert">
            <div className="grow">
              {blockedBeforeLink}
              <Link to="/browse/">{t("All countries")}</Link>
              {blockedAfterLink}
            </div>
            <button type="button" className="btn text sl" onClick={handleRetry}>
              {t("Retry")}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="ob-alert bad" role="alert">
            <div className="grow">{error}</div>
            <button type="button" className="btn text sl" onClick={handleRetry}>
              {t("Retry")}
            </button>
          </div>
        ) : null}

        {loading && !showPermissionPrompt ? (
          viewMode === "compact" ? (
            <BannerRows banners={[]} loadingMore label={t("Loading banners")} />
          ) : (
            <BannerWall banners={[]} skeletonCount={8} label={t("Loading banners")} />
          )
        ) : null}

        {!loading && !error && location && visibleBanners.length === 0 && (!hasMore || bannerData.length === 0) ? (
          <div className="ob-alert">{t("No nearby banners match.")}</div>
        ) : null}

        {!loading && visibleBanners.length > 0 ? (
          viewMode === "compact" ? (
            <BannerRows
              banners={visibleBanners}
              here={location}
              loadingMore={loadingMore}
              label={t("Banners near you")}
            />
          ) : (
            <BannerWall
              banners={visibleBanners}
              here={location}
              loadingMore={loadingMore}
              label={t("Banners near you")}
            />
          )
        ) : null}
        {!loading && bannerData.length > 0 && hasMore ? (
          <div ref={sentinelRef} style={{ height: 1 }} />
        ) : null}
      </section>

      <AboutNotice />
    </div>
  );
}
