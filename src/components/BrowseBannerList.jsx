import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  getHistoryEntryKey,
  readHistoryEntryCache,
  useRememberEntry,
} from "../scrollRestoration";
import BannerWall, { BannerRows, useInfiniteScroll } from "./BannerWall";
import ViewModeToggle, { useBannerViewMode } from "./ViewModeToggle";
import SortingButtons from "./SortingButtons";
import {
  fetchBannergress,
  forgetTemporarilyVisibleHiddenBanners,
  getBannergressAccountId,
  useBannergressSync,
} from "../bannergressSync";
import {
  deleteEfficiencyCache,
  getEfficiencyCacheKey,
  readEfficiencyCache,
  writeEfficiencyCache,
} from "../efficiencyCache";
import {
  applyBannerFilters,
  DEFAULT_BANNER_FILTERS,
  getMissionCountBounds,
} from "../bannerFilters";
import { getLanguage, t, tn } from "../i18n";
import {
  getBrowseStateScope,
  readBrowseState,
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

// Bannergress matches whole words; a trailing * makes the last word a
// prefix, so "Amst" finds Amsterdam while you type. Only for plain English
// letters for now: Bannergress stores Chinese and Japanese per character, so
// "上理工*" or "へいく*" finds nothing while "上理工" does (Michael 10-25).
export function toPrefixQuery(query) {
  const trimmed = String(query).trim();
  // eslint-disable-next-line no-control-regex
  return !trimmed || trimmed.endsWith("*") || /[^\x00-\x7f]/.test(trimmed) ? trimmed : `${trimmed}*`;
}

function buildBannersUrl({
  placeId,
  authorName,
  query,
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

  if (query) {
    url.searchParams.set("query", toPrefixQuery(query));
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
  Relevance: "relevance",
  Created: "created",
  "A-Z": "title",
  Distance: "lengthMeters",
  "Nr. of Missions": "numberOfMissions",
};
const BROWSE_PAGE_SIZE = 24;
const FILTERED_BROWSE_PREFETCH_TARGET = BROWSE_PAGE_SIZE * 2;
const EFFICIENCY_PAGE_SIZE = 100;
// A search can match a lot; Efficiency sorts at most this many of them.
const SEARCH_EFFICIENCY_MAX_BANNERS = 1000;

// The banner list of Browse, an agent and search results: sort, filters,
// Wall/List, infinite scroll, and the state Back restores.
export default function BrowseBannerList({
  placeId,
  authorName,
  query,
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
  heading = null,
  label = t("Banners"),
  onStatusChange,
  // The place's banner count (Bannergress counts offline ones too), for the
  // Efficiency progress line.
  placeBannerCount = null,
  // Search while typing: a new query keeps the sort and shows the current
  // banners until the new ones are in (no skeleton flash between letters).
  liveQuery = false,
}) {
  const browseStateScope = useMemo(
    () => getBrowseStateScope({ placeId, authorName, query }),
    [authorName, placeId, query]
  );
  const location = useLocation();
  const navigationType = useNavigationType();
  const entryKey = getHistoryEntryKey(location);
  // Back (POP) gets this history entry's own list from memory; otherwise the
  // last state of this list (localStorage).
  const readInitialState = () =>
    (navigationType === "POP" &&
      readHistoryEntryCache(entryKey, browseStateScope)) ||
    readBrowseState(browseStateScope);
  const [initialBrowseState] = useState(readInitialState);
  // The list whose banners are in state (it lags one render behind a change).
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
  // Banners fetched so far while Efficiency loads all of them (null otherwise).
  const [efficiencyFetchedCount, setEfficiencyFetchedCount] = useState(null);
  // When the Efficiency banners came from the browser cache: when they were
  // fetched (ms). null for a fresh fetch.
  const [efficiencyCachedAt, setEfficiencyCachedAt] = useState(
    initialBrowseState.efficiencyCachedAt ?? null
  );
  // Refresh: the next Efficiency load skips (and replaces) the cache.
  const efficiencyRefreshRef = useRef(false);
  const [cacheAgeNow, setCacheAgeNow] = useState(() => Date.now());
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
  // The previous results, shown while a live query loads its first page.
  const [placeholderBanners, setPlaceholderBanners] = useState([]);
  const displayedBannersRef = useRef([]);
  const syncState = useBannergressSync();
  // Entering (or switching) a list drops banners that were only kept
  // visible right after "Hide"; hidden banners never show up in Browse again.
  const hiddenScopeRef = useRef(null);
  const hiddenScope = `${placeId ?? ""}|${authorName ?? ""}|${query ?? ""}`;

  if (hiddenScopeRef.current !== hiddenScope) {
    hiddenScopeRef.current = hiddenScope;
    forgetTemporarilyVisibleHiddenBanners();
  }
  const loadMoreRef = useRef(null);
  const [activeBrowseQueryKey, setActiveBrowseQueryKey] = useState(
    initialBrowseState.queryKey
  );
  const shouldSkipRestoredLoadRef = useRef(initialBrowseState.hasLoaded);
  const [viewMode, handleViewModeChange] = useBannerViewMode();

  const handleSort = (option) => {
    if (option === sortOption) {
      // Best match only goes one way.
      if (option !== "Relevance") {
        setSortOrder(sortOrder === "ASC" ? "DESC" : "ASC");
      }
    } else {
      setBannersFetchedForEfficiency(false);
      setEfficiencyCachedAt(null);
      setSortOption(option);
      setSortOrder("DESC");
    }
  };

  const handleRetry = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  const handleEfficiencyRefresh = () => {
    efficiencyRefreshRef.current = true;
    setEfficiencyCachedAt(null);
    setReloadToken((currentValue) => currentValue + 1);
  };

  useEffect(() => {
    if (stateScope === browseStateScope) {
      return;
    }

    setStateScope(browseStateScope);

    if (liveQuery && navigationType !== "POP") {
      shouldSkipRestoredLoadRef.current = false;
      setPlaceholderBanners(displayedBannersRef.current);
      setBanners([]);
      setBannersFetchedForEfficiency(false);
      setEfficiencyCachedAt(null);
      setHasMore(true);
      setRequestedOffset(0);
      setActiveBrowseQueryKey(null);
      setHasLoaded(false);
      setLoading(false);
      setLoadingMore(false);
      setError("");
      setReloadToken(0);
      return;
    }

    const nextState = readInitialState();

    shouldSkipRestoredLoadRef.current = nextState.hasLoaded;

    setSortOption(nextState.sortOption);
    setSortOrder(nextState.sortOrder);
    setBanners(nextState.banners);
    setBannersFetchedForEfficiency(nextState.bannersFetchedForEfficiency);
    setEfficiencyCachedAt(nextState.efficiencyCachedAt ?? null);
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
    query ?? "",
    sortOption,
    sortOrder,
    bannerFilters.showOfflineBanners ? "offline" : "online-only",
    bannerFilters.showHiddenBanners ? "show-hidden" : "hide-hidden",
    bannerFilters.hideDoneBanners ? "hide-done" : "show-done",
    reloadToken,
  ].join("|");

  useEffect(() => {
    // A list change first swaps in that list's state (effect above).
    if (browseQueryKey === activeBrowseQueryKey || stateScope !== browseStateScope) {
      return;
    }

    shouldSkipRestoredLoadRef.current = false;
    setActiveBrowseQueryKey(browseQueryKey);

    if (liveQuery && activeBrowseQueryKey !== null) {
      setPlaceholderBanners(displayedBannersRef.current);
    }

    setBanners([]);
    setBannersFetchedForEfficiency(false);
    setEfficiencyCachedAt(null);
    setHasLoaded(false);
    setLoading(false);
    setLoadingMore(false);
    setHasMore(true);
    setRequestedOffset(0);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // A newer query (or page) cancels this request; its answer never lands.
    const controller = new AbortController();

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

          if (!placeId && !query) {
            setBanners([]);
            setLoading(false);
            setLoadingMore(false);
            setHasMore(false);
            setHasLoaded(true);
            return;
          }

          // Same set for both directions and for the filters applied here.
          const cacheKey = getEfficiencyCacheKey({
            placeId,
            authorName,
            query,
            showOfflineBanners: bannerFilters.showOfflineBanners,
            showHiddenBanners: bannerFilters.showHiddenBanners,
            accountId: getBannergressAccountId(),
          });

          if (efficiencyRefreshRef.current) {
            efficiencyRefreshRef.current = false;
            await deleteEfficiencyCache(cacheKey);
          } else {
            const cached = await readEfficiencyCache(cacheKey);

            if (ignore) {
              return;
            }

            if (cached) {
              setBanners(sortJsonByMissionsPerLength(cached.banners, sortOrder));
              setEfficiencyCachedAt(cached.savedAt);
              setCacheAgeNow(Date.now());
              setBannersFetchedForEfficiency(true);
              setHasMore(false);
              setHasLoaded(true);
              return;
            }
          }

          if (ignore) {
            return;
          }

          let offset = 0;
          let allBanners = [];
          let complete = true;

          setEfficiencyCachedAt(null);
          setEfficiencyFetchedCount(0);

          while (!ignore) {
            const response = await fetchBannergress(
              buildBannersUrl({
                placeId,
                authorName,
                query,
                sortOption: query ? "relevance" : null,
                sortOrder: "DESC",
                showOfflineBanners: bannerFilters.showOfflineBanners,
                offset,
                limit: EFFICIENCY_PAGE_SIZE,
              }),
              {
                authenticate: !bannerFilters.showHiddenBanners,
                signal: controller.signal,
              }
            );
            const data = await response.json();

            if (!Array.isArray(data)) {
              console.error("Invalid response data:", data);
              setError(t("Couldn't load banners for this place."));
              complete = false;
              break;
            }

            allBanners = [...allBanners, ...data];
            setEfficiencyFetchedCount(allBanners.length);

            if (
              data.length === 0 ||
              (query &&
                (data.length < EFFICIENCY_PAGE_SIZE ||
                  allBanners.length >= SEARCH_EFFICIENCY_MAX_BANNERS))
            ) {
              break;
            }

            offset += EFFICIENCY_PAGE_SIZE;
          }

          if (!ignore) {
            if (complete) {
              writeEfficiencyCache(cacheKey, allBanners);
            }
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
            query,
            sortOption: sortOptionsMap[sortOption],
            sortOrder,
            showOfflineBanners: bannerFilters.showOfflineBanners,
            offset: requestedOffset,
          }),
          {
            authenticate: !bannerFilters.showHiddenBanners,
            signal: controller.signal,
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
            setError(t("Couldn't load banners."));
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
          setError(t("Couldn't load banners. Please try again."));
          setHasLoaded(false);
        }
      } finally {
        if (!ignore) {
          setEfficiencyFetchedCount(null);
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
      controller.abort();
      setEfficiencyFetchedCount(null);
    };
  }, [
    activeBrowseQueryKey,
    browseQueryKey,
    requestedOffset,
    sortOption,
    sortOrder,
    placeId,
    authorName,
    query,
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
  displayedBannersRef.current =
    displayedBanners.length > 0 || hasLoaded ? displayedBanners : placeholderBanners;
  const showPlaceholder = !hasLoaded && !error && placeholderBanners.length > 0;

  useEffect(() => {
    if ((hasLoaded || error) && placeholderBanners.length > 0) {
      setPlaceholderBanners([]);
    }
  }, [error, hasLoaded, placeholderBanners.length]);
  const browseSnapshot = {
    filters: bannerFilters,
    sortOption,
    sortOrder,
    banners,
    hasMore,
    requestedOffset,
    bannersFetchedForEfficiency,
    efficiencyCachedAt,
    isPlacesListExpanded,
    scrollY: 0,
    queryKey: browseQueryKey,
    hasLoaded,
  };

  // Right after a list change the old list is still in state; it must not
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

    // Efficiency's full set lives in its own cache (efficiencyCache.js), so
    // after a reload it comes from there, with its age and an expiry.
    const efficiency = sortOption === "Efficiency";

    saveBrowseState(browseStateScope, {
      filters: bannerFilters,
      sortOption,
      sortOrder,
      banners: efficiency ? [] : banners,
      hasMore,
      requestedOffset,
      bannersFetchedForEfficiency: efficiency ? false : bannersFetchedForEfficiency,
      isPlacesListExpanded,
      queryKey: browseQueryKey,
      hasLoaded: efficiency ? false : hasLoaded,
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

  // Search: Efficiency sorts at most SEARCH_EFFICIENCY_MAX_BANNERS. Place:
  // its count is exact only with offline and hidden banners shown.
  const efficiencyTotal = query
    ? SEARCH_EFFICIENCY_MAX_BANNERS
    : Number.isFinite(placeBannerCount)
      ? placeBannerCount
      : null;
  const efficiencyTotalIsExact =
    !query && bannerFilters.showOfflineBanners && bannerFilters.showHiddenBanners;
  const efficiencyProgress =
    efficiencyFetchedCount !== null && efficiencyTotal !== null
      ? (() => {
          const total = Math.max(efficiencyTotal, efficiencyFetchedCount);
          const vars = {
            fetched: efficiencyFetchedCount.toLocaleString(getLanguage()),
            count: total.toLocaleString(getLanguage()),
          };

          return efficiencyTotalIsExact
            ? tn("Fetched {fetched} of {count} banner", "Fetched {fetched} of {count} banners", total, vars)
            : tn("Fetched {fetched} of up to {count} banner", "Fetched {fetched} of up to {count} banners", total, vars);
        })()
      : null;

  const showEfficiencyCacheNote =
    sortOption === "Efficiency" &&
    efficiencyCachedAt !== null &&
    !loading &&
    !efficiencyProgress;

  // Keeps the age current while the note is up.
  useEffect(() => {
    if (!showEfficiencyCacheNote) {
      return undefined;
    }

    setCacheAgeNow(Date.now());
    const timer = setInterval(() => setCacheAgeNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, [showEfficiencyCacheNote]);

  const efficiencyCacheAgeMinutes = showEfficiencyCacheNote
    ? Math.max(0, Math.floor((cacheAgeNow - efficiencyCachedAt) / 60000))
    : 0;
  const efficiencyCacheNote = !showEfficiencyCacheNote
    ? null
    : efficiencyCacheAgeMinutes < 1
      ? t("Cached results from less than a minute ago")
      : tn(
          "Cached results from {count} minute ago",
          "Cached results from {count} minutes ago",
          efficiencyCacheAgeMinutes,
          { count: efficiencyCacheAgeMinutes.toLocaleString(getLanguage()) }
        );

  const listReady = stateScope === browseStateScope && hasLoaded && !loading;
  const listCount = banners.length;

  useEffect(() => {
    onStatusChange?.({ ready: listReady, error: Boolean(error), count: listCount });
  }, [error, listCount, listReady, onStatusChange]);

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
    <section
      aria-label={heading ? undefined : label}
      aria-labelledby={heading ? "banner-list-heading" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: heading ? 12 : 16 }}
    >
      {heading ? (
        <h2 id="banner-list-heading" className="ob-h2">
          {heading}
        </h2>
      ) : null}
      <div className="toolbar">
        <SortingButtons
          handleSort={handleSort}
          sortOption={sortOption}
          sortOrder={sortOrder}
          placeId={placeId}
          searchQuery={query}
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
            {t("Retry")}
          </button>
        </div>
      ) : null}
      {efficiencyProgress ? (
        <p className="small muted" role="status" style={{ margin: 0 }}>
          {efficiencyProgress}
        </p>
      ) : null}
      {efficiencyCacheNote ? (
        <p className="small muted" style={{ margin: 0 }}>
          <span>{efficiencyCacheNote}</span>
          {" · "}
          <button
            type="button"
            onClick={handleEfficiencyRefresh}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              font: "inherit",
              color: "var(--primary)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {t("Refresh")}
          </button>
        </p>
      ) : null}
      {showPlaceholder ? (
        <div aria-busy="true" className="list-refreshing">
          {viewMode === "compact" ? (
            <BannerRows banners={placeholderBanners} label={label} />
          ) : (
            <BannerWall banners={placeholderBanners} label={label} />
          )}
        </div>
      ) : loading ? (
        viewMode === "compact" ? (
          <BannerRows banners={[]} loadingMore label={t("Loading banners")} />
        ) : (
          <BannerWall banners={[]} skeletonCount={8} label={t("Loading banners")} />
        )
      ) : displayedBanners.length === 0 && !error ? (
        <div className="ob-alert">
          {query && banners.length === 0 && !hasMore
            ? t("No matching banners found.")
            : t("No banners matched this selection.")}
        </div>
      ) : viewMode === "compact" ? (
        <BannerRows banners={displayedBanners} loadingMore={loadingMore} label={label} />
      ) : (
        <BannerWall banners={displayedBanners} loadingMore={loadingMore} label={label} />
      )}
      {hasMore && !loading ? <div ref={loadMoreRef} style={{ height: 1 }} /> : null}
    </section>
  );
}
