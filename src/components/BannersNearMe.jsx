import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Explore,
  LocationCity,
  Map as MapIcon,
  MyLocation,
  NearMe,
} from "@mui/icons-material";
import BannerWall, { useInfiniteScroll } from "./BannerWall";
import SearchForm from "./SearchForm";
import {
  fetchBannergress,
  forgetTemporarilyVisibleHiddenBanners,
  useBannergressSync,
} from "../bannergressSync";
import { withoutHiddenBanners } from "../bannerFilters";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import {
  getPlaceName,
  readCachedCity,
  resolveCityAt,
} from "../cityPlace";

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

function loadCachedNearbyLocation() {
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

function saveCachedNearbyLocation(location) {
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

export default function BannersNearMe() {
  const navigate = useNavigate();
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState([]);
  // Coming back here drops banners that were only kept visible right after "Hide".
  useState(forgetTemporarilyVisibleHiddenBanners);
  const syncState = useBannergressSync();
  const visibleBanners = useMemo(
    () => withoutHiddenBanners(bannerData, syncState),
    [bannerData, syncState]
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [error, setError] = useState("");
  const [permissionState, setPermissionState] = useState("checking");
  const [city, setCity] = useState(() => {
    const cached = readCachedCity();
    return cached?.picked ? cached.place : null;
  });
  const nearSectionRef = useRef(null);
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
          currentLocation &&
          Math.abs(currentLocation.latitude - latitude) < 0.0005 &&
          Math.abs(currentLocation.longitude - longitude) < 0.0005
            ? currentLocation
            : nextLocation
        );
      },
      (positionError) => {
        console.error("Error getting location:", positionError);

        if (!silent) {
          setLoading(false);
          setError(
            "Couldn't determine your location. Please check your browser location settings and try again."
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
          setLocation(cachedLocation);
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
      setError("This browser does not support geolocation.");
    }

    return () => {
      ignore = true;
    };
  }, []);

  const loadPage = useCallback(
    async (offset, { signal } = {}) => {
      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint&orderDirection=ASC&online=true&proximityLatitude=${location.latitude}&proximityLongitude=${location.longitude}&limit=${NEARBY_PAGE_SIZE}&offset=${offset}`;
      const response = await fetchBannergress(apiUrl, { signal });
      return response.json();
    },
    [location]
  );

  useEffect(() => {
    if (!location) {
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
          setError("Nearby banners returned an unexpected response.");
        }
      })
      .catch((fetchError) => {
        console.error("Error fetching banner data:", fetchError);

        if (!ignore) {
          setBannerData([]);
          setHasMore(false);
          setError("Couldn't load nearby banners. Please try again.");
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

  const handleNearbyClick = () => {
    nearSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });

    if (!location && permissionState !== "denied" && permissionState !== "unsupported") {
      handleGrantLocationAccess();
    }
  };

  const openCity = (place) => {
    resetBrowseState(getBrowseStateScope({ placeId: place.id }));
    navigate(`/browse/${encodeURIComponent(place.id)}`);
  };

  const cityName = getPlaceName(city);

  return (
    <div className="ob-page">
      <section className="hero-s" aria-labelledby="home-title">
        <h1 className="ob-h1" id="home-title">
          Find a banner
        </h1>
        <SearchForm big placeholder="Search banners or places" />
        <div className="quick">
          <button type="button" className="q-act sl" onClick={handleNearbyClick}>
            <span className="q-ic">
              <NearMe />
            </span>
            <b>Nearby</b>
            <span className="small">Closest start points</span>
          </button>
          <Link className="q-act sl" to="/map">
            <span className="q-ic">
              <MapIcon />
            </span>
            <b>Map</b>
            <span className="small">All banners on a map</span>
          </Link>
          <Link
            className="q-act sl"
            to="/browse/"
            onClick={() => resetBrowseState(getBrowseStateScope())}
          >
            <span className="q-ic">
              <Explore />
            </span>
            <b>Browse</b>
            <span className="small">By city or region</span>
          </Link>
        </div>
        {city ? (
          <Link
            className="city-cta sl"
            to={`/browse/${encodeURIComponent(city.id)}`}
            onClick={() => resetBrowseState(getBrowseStateScope({ placeId: city.id }))}
          >
            <span className="cc-ic">
              <LocationCity />
            </span>
            <span className="grow">
              <b>Banners in {cityName}</b>
              <span className="small">
                {Number.isFinite(city.numberOfBanners)
                  ? `${city.numberOfBanners} banners · `
                  : ""}
                {city.formattedAddress}
              </span>
            </span>
            <ChevronRight className="cc-go" />
          </Link>
        ) : null}
      </section>

      <section ref={nearSectionRef} aria-labelledby="near-title" style={{ scrollMarginTop: 80 }}>
        <div className="ob-sec-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="ob-h2" id="near-title">
              Banners near you
            </h2>
            <p className="small muted">Closest start point first.</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!location && (showPermissionPrompt || permissionState === "checking" || permissionState === "unknown") ? (
            <div className="loc-card">
              <span className="loc-ic">
                <NearMe />
              </span>
              <div className="grow">
                <b>See what’s around you</b>
                <span className="small">
                  Enable location access to load nearby banners. Your location
                  stays in this browser, only the search itself is sent.
                </span>
                <div className="acts">
                  <button type="button" className="btn filled sl" onClick={handleGrantLocationAccess}>
                    <MyLocation fontSize="small" />
                    Grant location access
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!showPermissionPrompt && permissionState === "denied" ? (
            <div className="ob-alert warn" role="alert">
              <div className="grow">
                Location access is blocked. Allow it in your browser to use nearby
                banners.
              </div>
              <button type="button" className="btn text sl" onClick={handleRetry}>
                Retry
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="ob-alert bad" role="alert">
              <div className="grow">{error}</div>
              <button type="button" className="btn text sl" onClick={handleRetry}>
                Retry
              </button>
            </div>
          ) : null}

          {loading && !showPermissionPrompt ? (
            <>
              <p className="small muted">Loading banners near you...</p>
              <BannerWall banners={[]} skeletonCount={8} label="Loading banners" />
            </>
          ) : null}

          {!loading && !error && location && visibleBanners.length === 0 && (!hasMore || bannerData.length === 0) ? (
            <div className="ob-alert">No nearby banners were found for your current location.</div>
          ) : null}

          {!loading && visibleBanners.length > 0 ? (
            <>
              <BannerWall
                banners={visibleBanners}
                here={location}
                loadingMore={loadingMore}
                label="Banners near you"
              />
            </>
          ) : null}
          {!loading && bannerData.length > 0 && hasMore ? (
            <div ref={sentinelRef} style={{ height: 1 }} />
          ) : null}
        </div>
      </section>

      <section className="ob-about small muted">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </section>

    </div>
  );
}
