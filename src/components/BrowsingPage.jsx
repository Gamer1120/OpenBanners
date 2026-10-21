import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { NearMe } from "@mui/icons-material";
import { savePickedCity } from "../cityPlace";
import {
  getHistoryEntryKey,
  readHistoryEntryCache,
  useRememberEntry,
} from "../scrollRestoration";
import BannerWall, { BannerRows, useInfiniteScroll } from "./BannerWall";
import ViewModeToggle, { useBannerViewMode } from "./ViewModeToggle";
import SortingButtons from "./SortingButtons";
import AboutNotice from "./AboutNotice";
import PlaceCloud, { getChipName, usePlaces } from "./PlaceCloud";
import { getFlagForPlace } from "./CountryFlags";
import {
  fetchBannergress,
  forgetTemporarilyVisibleHiddenBanners,
  useBannergressSync,
} from "../bannergressSync";
import {
  applyBannerFilters,
  DEFAULT_BANNER_FILTERS,
  getMissionCountBounds,
} from "../bannerFilters";
import {
  getBrowseStateScope,
  readBrowseState,
  resetBrowseState,
  saveBrowseState,
} from "../browseState";

function sortJsonByMissionsPerLength(data, sortOrder) {
  return [...data].sort((a, b) => {
    const missionsPerLengthA = a.numberOfMissions / a.lengthMeters;
    const missionsPerLengthB = b.numberOfMissions / b.lengthMeters;

    if (sortOrder === "ASC") {
      return missionsPerLengthA - missionsPerLengthB;
    }

    return missionsPerLengthB - missionsPerLengthA;
  });
}

function buildBannersUrl({
  placeId,
  authorName,
  sortOption,
  sortOrder,
  showOfflineBanners,
  offset,
  limit = BROWSE_PAGE_SIZE,
}) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (placeId) {
    url.searchParams.set("placeId", placeId);
  }

  if (authorName) {
    url.searchParams.set("author", authorName);
  }

  if (sortOption) {
    url.searchParams.set("orderBy", sortOption);
    url.searchParams.set("orderDirection", sortOrder);
  }

  if (!showOfflineBanners) {
    url.searchParams.set("online", "true");
  }

  return url.toString();
}

const sortOptionsMap = {
  Created: "created",
  "A-Z": "title",
  Distance: "lengthMeters",
  "Nr. of Missions": "numberOfMissions",
};
const BROWSE_PAGE_SIZE = 24;
const FILTERED_BROWSE_PREFETCH_TARGET = BROWSE_PAGE_SIZE * 2;

function useCurrentPlace(placeId) {
  const [currentPlace, setCurrentPlace] = useState(null);

  useEffect(() => {
    if (!placeId) {
      setCurrentPlace(null);
      return undefined;
    }

    let ignore = false;
    setCurrentPlace(null);

    fetch(`https://api.bannergress.com/places/${encodeURIComponent(placeId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!ignore) {
          setCurrentPlace(data && typeof data === "object" && data.id ? data : null);
        }
      })
      .catch((fetchError) => {
        console.error(fetchError);

        if (!ignore) {
          setCurrentPlace(null);
        }
      });

    return () => {
      ignore = true;
    };
  }, [placeId]);

  return currentPlace;
}

function getPlaceTrail(place) {
  const trail = [];
  let current = place?.parentPlace;

  while (current && trail.length < 8) {
    trail.unshift(current);
    current = current.parentPlace;
  }

  return trail;
}

export default function BrowsingPage({
  placeId,
  authorName,
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  const browseStateScope = useMemo(
    () => getBrowseStateScope({ placeId, authorName }),
    [authorName, placeId]
  );
  const location = useLocation();
  const navigationType = useNavigationType();
  const entryKey = getHistoryEntryKey(location);
  // Back (POP) gets this history entry's own list from memory; otherwise the
  // last Browse state of this place (localStorage).
  const readInitialState = () =>
    (navigationType === "POP" &&
      readHistoryEntryCache(entryKey, browseStateScope)) ||
    readBrowseState(browseStateScope);
  const [initialBrowseState] = useState(readInitialState);
  // The place whose list is in state (it lags one render behind a change).
  const [stateScope, setStateScope] = useState(browseStateScope);
  const [banners, setBanners] = useState(initialBrowseState.banners);
  const [sortOption, setSortOption] = useState(
    initialBrowseState.sortOption
  );
  const [sortOrder, setSortOrder] = useState(initialBrowseState.sortOrder);
  const [bannersFetchedForEfficiency, setBannersFetchedForEfficiency] =
    useState(initialBrowseState.bannersFetchedForEfficiency);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialBrowseState.hasMore);
  const [requestedOffset, setRequestedOffset] = useState(
    initialBrowseState.requestedOffset
  );
  const [isPlacesListExpanded, setIsPlacesListExpanded] = useState(
    initialBrowseState.isPlacesListExpanded
  );
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(initialBrowseState.hasLoaded);
  const syncState = useBannergressSync();
  // Entering (or switching) a Browse list drops banners that were only kept
  // visible right after "Hide"; hidden banners never show up in Browse again.
  const hiddenScopeRef = useRef(null);
  const hiddenScope = `${placeId ?? ""}|${authorName ?? ""}`;

  if (hiddenScopeRef.current !== hiddenScope) {
    hiddenScopeRef.current = hiddenScope;
    forgetTemporarilyVisibleHiddenBanners();
  }
  const loadMoreRef = useRef(null);
  const resultsAreaRef = useRef(null);
  const resultsContentRef = useRef(null);
  const [activeBrowseQueryKey, setActiveBrowseQueryKey] = useState(
    initialBrowseState.queryKey
  );
  const shouldSkipRestoredLoadRef = useRef(initialBrowseState.hasLoaded);
  const [viewMode, handleViewModeChange] = useBannerViewMode();
  const navigate = useNavigate();
  const currentPlace = useCurrentPlace(placeId);
  const placesState = usePlaces(placeId, !authorName);
  const placeTrail = useMemo(() => getPlaceTrail(currentPlace), [currentPlace]);

  // A city you browse to becomes the Banners tab's start page when location is off.
  useEffect(() => {
    if (currentPlace?.id && currentPlace.type === "locality") {
      savePickedCity(currentPlace);
    }
  }, [currentPlace]);

  const handleSort = (option) => {
    if (option === sortOption) {
      setSortOrder(sortOrder === "ASC" ? "DESC" : "ASC");
    } else {
      setBannersFetchedForEfficiency(false);
      setSortOption(option);
      setSortOrder("DESC");
    }
  };

  const handleRetry = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  useEffect(() => {
    if (stateScope === browseStateScope) {
      return;
    }

    const nextState = readInitialState();

    setStateScope(browseStateScope);
    shouldSkipRestoredLoadRef.current = nextState.hasLoaded;

    setSortOption(nextState.sortOption);
    setSortOrder(nextState.sortOrder);
    setBanners(nextState.banners);
    setBannersFetchedForEfficiency(nextState.bannersFetchedForEfficiency);
    setHasMore(nextState.hasMore);
    setRequestedOffset(nextState.requestedOffset);
    setIsPlacesListExpanded(nextState.isPlacesListExpanded);
    setActiveBrowseQueryKey(nextState.queryKey);
    setHasLoaded(nextState.hasLoaded);
    setLoading(false);
    setLoadingMore(false);
    setError("");
    setReloadToken(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseStateScope]);

  const browseQueryKey = [
    placeId ?? "",
    authorName ?? "",
    sortOption,
    sortOrder,
    bannerFilters.showOfflineBanners ? "offline" : "online-only",
    bannerFilters.showHiddenBanners ? "show-hidden" : "hide-hidden",
    bannerFilters.hideDoneBanners ? "hide-done" : "show-done",
    reloadToken,
  ].join("|");

  useEffect(() => {
    // A place change first swaps in that place's state (effect above).
    if (browseQueryKey === activeBrowseQueryKey || stateScope !== browseStateScope) {
      return;
    }

    shouldSkipRestoredLoadRef.current = false;
    setActiveBrowseQueryKey(browseQueryKey);
    setBanners([]);
    setBannersFetchedForEfficiency(false);
    setHasLoaded(false);
    setLoading(false);
    setLoadingMore(false);
    setHasMore(true);
    setRequestedOffset(0);
    setError("");
  }, [activeBrowseQueryKey, browseQueryKey, browseStateScope, stateScope]);

  useEffect(() => {
    if (browseQueryKey !== activeBrowseQueryKey || stateScope !== browseStateScope) {
      return undefined;
    }

    if (shouldSkipRestoredLoadRef.current) {
      shouldSkipRestoredLoadRef.current = false;
      return undefined;
    }

    let ignore = false;

    const loadBanners = async () => {
      const isInitialPage = requestedOffset === 0;

      if (isInitialPage) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      setError("");

      try {
        if (sortOption === "Efficiency") {
          if (bannersFetchedForEfficiency) {
            setBanners((currentBanners) =>
              sortJsonByMissionsPerLength(currentBanners, sortOrder)
            );
            setLoading(false);
            setLoadingMore(false);
            return;
          }

          if (!placeId) {
            setBanners([]);
            setLoading(false);
            setLoadingMore(false);
            setHasMore(false);
            setHasLoaded(true);
            return;
          }

          let offset = 0;
          let allBanners = [];
          const efficiencyPageSize = 100;

          while (!ignore) {
            const response = await fetchBannergress(
              buildBannersUrl({
                placeId,
                authorName,
                sortOption: null,
                sortOrder,
                showOfflineBanners: bannerFilters.showOfflineBanners,
                offset,
                limit: efficiencyPageSize,
              }),
              {
                authenticate: !bannerFilters.showHiddenBanners,
              }
            );
            const data = await response.json();

            if (!Array.isArray(data)) {
              console.error("Invalid response data:", data);
              setError("Couldn't load banners for this place.");
              break;
            }

            allBanners = [...allBanners, ...data];

            if (data.length === 0) {
              break;
            }

            offset += efficiencyPageSize;
          }

          if (!ignore) {
            setBanners(sortJsonByMissionsPerLength(allBanners, sortOrder));
            setBannersFetchedForEfficiency(true);
            setHasMore(false);
            setHasLoaded(true);
          }

          return;
        }

        const response = await fetchBannergress(
          buildBannersUrl({
            placeId,
            authorName,
            sortOption: sortOptionsMap[sortOption],
            sortOrder,
            showOfflineBanners: bannerFilters.showOfflineBanners,
            offset: requestedOffset,
          }),
          {
            authenticate: !bannerFilters.showHiddenBanners,
          }
        );
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setBanners((currentBanners) =>
              requestedOffset === 0 ? data : [...currentBanners, ...data]
            );
            setHasMore(data.length === BROWSE_PAGE_SIZE);
            setHasLoaded(true);
          } else {
            console.error("Invalid response data:", data);
            if (requestedOffset === 0) {
              setBanners([]);
            }
            setError("Couldn't load banners.");
            setHasMore(false);
            setHasLoaded(false);
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error(fetchError);
          if (requestedOffset === 0) {
            setBanners([]);
          }
          setError("Couldn't load banners. Please try again.");
          setHasLoaded(false);
        }
      } finally {
        if (!ignore) {
          if (requestedOffset === 0) {
            setLoading(false);
          } else {
            setLoadingMore(false);
          }
        }
      }
    };

    loadBanners();

    return () => {
      ignore = true;
    };
  }, [
    activeBrowseQueryKey,
    browseQueryKey,
    requestedOffset,
    sortOption,
    sortOrder,
    placeId,
    authorName,
    bannerFilters.showOfflineBanners,
    bannerFilters.showHiddenBanners,
    bannerFilters.hideDoneBanners,
    bannersFetchedForEfficiency,
    browseStateScope,
    stateScope,
  ]);

  const { minimumMissions, maximumMissions, hasMissionCountFilter } =
    getMissionCountBounds(bannerFilters);
  const nextOffset = banners.length;
  const displayedBanners = useMemo(
    () =>
      applyBannerFilters(banners, syncState, bannerFilters).filter((banner) => {
        const missionCount = Number(banner?.numberOfMissions);

        if (!Number.isFinite(missionCount)) {
          return minimumMissions === null && maximumMissions === null;
        }

        if (minimumMissions !== null && missionCount < minimumMissions) {
          return false;
        }

        if (maximumMissions !== null && missionCount > maximumMissions) {
          return false;
        }

        return true;
      }),
    [banners, bannerFilters, maximumMissions, minimumMissions, syncState]
  );
  const browseSnapshot = {
    filters: bannerFilters,
    sortOption,
    sortOrder,
    banners,
    hasMore,
    requestedOffset,
    bannersFetchedForEfficiency,
    isPlacesListExpanded,
    scrollY: 0,
    queryKey: browseQueryKey,
    hasLoaded,
  };

  // Right after a place change the old list is still in state; it must not
  // be remembered for the new entry.
  useRememberEntry(
    entryKey,
    browseStateScope,
    stateScope === browseStateScope && !loading ? browseSnapshot : null
  );

  useEffect(() => {
    if (stateScope !== browseStateScope) {
      return;
    }

    saveBrowseState(browseStateScope, {
      filters: bannerFilters,
      sortOption,
      sortOrder,
      banners,
      hasMore,
      requestedOffset,
      bannersFetchedForEfficiency,
      isPlacesListExpanded,
      queryKey: browseQueryKey,
      hasLoaded,
    });
  }, [
    bannerFilters,
    banners,
    bannersFetchedForEfficiency,
    browseQueryKey,
    browseStateScope,
    hasLoaded,
    hasMore,
    isPlacesListExpanded,
    requestedOffset,
    sortOption,
    sortOrder,
    stateScope,
  ]);

  const filteredPrefetchTarget =
    hasMissionCountFilter ||
    bannerFilters.showHiddenBanners ||
    bannerFilters.hideDoneBanners ||
    bannerFilters.showOfflineBanners ||
    minimumMissions !== null ||
    maximumMissions !== null
      ? FILTERED_BROWSE_PREFETCH_TARGET
      : BROWSE_PAGE_SIZE;
  const needsFilteredBackfill =
    displayedBanners.length === 0 ||
    displayedBanners.length < Math.min(filteredPrefetchTarget, banners.length);
  const isAgentView = Boolean(authorName);
  const canUseLocation = typeof navigator !== "undefined" && "geolocation" in navigator;
  const placeName = currentPlace
    ? getChipName(currentPlace, currentPlace.type === "country")
    : "";
  const headerTitle = isAgentView
    ? authorName
    : placeId
      ? placeName || "Loading…"
      : "All countries";
  const headerDescription = isAgentView
    ? `Banners created by ${authorName}.`
    : placeId
      ? currentPlace && Number.isFinite(currentPlace.numberOfBanners)
        ? `${currentPlace.numberOfBanners.toLocaleString("en-US")} banners${
            currentPlace.formattedAddress && currentPlace.formattedAddress !== placeName
              ? ` · ${currentPlace.formattedAddress}`
              : ""
          }`
        : ""
      : placesState.loading
        ? ""
        : `${placesState.places
            .reduce((total, place) => total + (Number(place.numberOfBanners) || 0), 0)
            .toLocaleString("en-US")} banners in ${placesState.places.length} countries`;
  const cloudHeading = !placeId
    ? "Countries"
    : currentPlace?.type === "country"
      ? "Regions and cities"
      : "Places";

  useEffect(() => {
    if (
      sortOption === "Efficiency" ||
      !hasMore ||
      loading ||
      loadingMore ||
      banners.length === 0 ||
      !needsFilteredBackfill ||
      nextOffset <= requestedOffset
    ) {
      return;
    }

    setRequestedOffset((currentOffset) =>
      currentOffset === nextOffset ? currentOffset : nextOffset
    );
  }, [
    banners.length,
    hasMore,
    loading,
    loadingMore,
    needsFilteredBackfill,
    nextOffset,
    requestedOffset,
    sortOption,
  ]);

  const requestNextPage = useCallback(() => {
    setRequestedOffset((currentOffset) =>
      currentOffset === nextOffset ? currentOffset : nextOffset
    );
  }, [nextOffset]);

  useInfiniteScroll(loadMoreRef, {
    enabled: sortOption !== "Efficiency" && hasMore && !loading && !loadingMore,
    onLoadMore: requestNextPage,
    itemCount: displayedBanners.length,
  });

  return (
    <div className="ob-page" ref={resultsAreaRef}>
      <header className="ob-sec-head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          {!isAgentView ? (
            <nav className="crumbs scope" aria-label="Scope">
              {canUseLocation ? (
                <>
                  <Link className="scope-near" to="/near">
                    <NearMe fontSize="inherit" />
                    Near you
                  </Link>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              {placeId ? (
                <Link to="/browse/">All countries</Link>
              ) : (
                <span aria-current="page">All countries</span>
              )}
              {placeTrail
                .filter(
                  (place) =>
                    !currentPlace ||
                    getChipName(place, false) !== getChipName(currentPlace, false)
                )
                .map((place) => (
                <React.Fragment key={place.id}>
                  <span aria-hidden="true">›</span>
                  <Link to={`/browse/${encodeURIComponent(place.id)}`}>
                    {getChipName(place, place.type === "country")}
                  </Link>
                </React.Fragment>
              ))}
              {placeId && currentPlace ? (
                <>
                  <span aria-hidden="true">›</span>
                  <span aria-current="page">
                    {getChipName(currentPlace, currentPlace.type === "country")}
                  </span>
                </>
              ) : null}
            </nav>
          ) : null}
          <h1 className="ob-h1">
            {currentPlace?.type === "country" && getFlagForPlace(currentPlace.formattedAddress) ? (
              <span aria-hidden="true">{getFlagForPlace(currentPlace.formattedAddress)} </span>
            ) : null}
            {headerTitle}
          </h1>
          {headerDescription ? <p className="small muted">{headerDescription}</p> : null}
        </div>
      </header>

      {isAgentView ? null : (
        <PlaceCloud
          places={placesState.places}
          loading={placesState.loading}
          error={placesState.error}
          isCountryList={!placeId}
          heading={cloudHeading}
          rows={placeId && currentPlace && currentPlace.type !== "country" ? 3 : 5}
        />
      )}

      <section
        ref={resultsContentRef}
        aria-label="Banners"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div className="toolbar">
          <SortingButtons
            handleSort={handleSort}
            sortOption={sortOption}
            sortOrder={sortOrder}
            placeId={placeId}
            bannerFilters={bannerFilters}
            onBannerFiltersChange={onBannerFiltersChange}
          />
          <span className="grow" />
          <ViewModeToggle viewMode={viewMode} onChange={handleViewModeChange} />
        </div>

        {error ? (
          <div className="ob-alert bad" role="alert">
            <div className="grow">{error}</div>
            <button type="button" className="btn text sl" onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : null}
        {loading ? (
          viewMode === "compact" ? (
            <BannerRows banners={[]} loadingMore label="Loading banners" />
          ) : (
            <BannerWall banners={[]} skeletonCount={8} label="Loading banners" />
          )
        ) : displayedBanners.length === 0 && !error ? (
          <div className="ob-alert">No banners matched this selection.</div>
        ) : viewMode === "compact" ? (
          <BannerRows banners={displayedBanners} loadingMore={loadingMore} />
        ) : (
          <BannerWall banners={displayedBanners} loadingMore={loadingMore} />
        )}
        {hasMore && !loading ? <div ref={loadMoreRef} style={{ height: 1 }} /> : null}
      </section>

      <AboutNotice />

    </div>
  );
}
