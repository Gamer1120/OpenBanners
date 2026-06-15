import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import BannerListItem from "./BannerListItem";
import BannerCard from "./BannerCard";
import BannerResultsViewToggle from "./BannerResultsViewToggle";
import VisualCardSizeButton from "./VisualCardSizeButton";
import {
  Alert,
  Box,
  Button,
  Container,
  Grid,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import BrowsingHeader from "./BrowsingHeader";
import SortingButtons from "./SortingButtons";
import PlacesList from "./PlacesList";
import { fetchBannergress, useBannergressSync } from "../bannergressSync";
import {
  applyBannerFilters,
  DEFAULT_BANNER_FILTERS,
  getMissionCountBounds,
} from "../bannerFilters";
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
const viewModeStorageKey = "openbanners-banner-view-mode";
const visualCardColumnsStorageKey = "openbanners-visual-card-columns";
const BROWSE_PAGE_SIZE = 9;
const FILTERED_BROWSE_PREFETCH_TARGET = BROWSE_PAGE_SIZE * 2;
const VISUAL_CARD_COLUMN_MIN = 3;
const VISUAL_CARD_FALLBACK_MAX = 8;
const VISUAL_CARD_GAP_PX = 20;
const VISUAL_CARD_MIN_WIDTH_PX = 220;

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
  const [initialBrowseState] = useState(() =>
    readBrowseState(browseStateScope)
  );
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
  const loadMoreRef = useRef(null);
  const resultsAreaRef = useRef(null);
  const resultsContentRef = useRef(null);
  const [activeBrowseQueryKey, setActiveBrowseQueryKey] = useState(
    initialBrowseState.queryKey
  );
  const shouldSkipRestoredLoadRef = useRef(initialBrowseState.hasLoaded);
  const restoredScrollYRef = useRef(initialBrowseState.scrollY);
  const shouldRestoreScrollRef = useRef(
    initialBrowseState.hasLoaded && initialBrowseState.scrollY > 0
  );
  const [viewMode, setViewMode] = useState(() => {
    const storedValue = window.localStorage.getItem(viewModeStorageKey);
    return storedValue === "compact" ? "compact" : "visual";
  });
  const [visualCardColumns, setVisualCardColumns] = useState(() => {
    const storedValue = Number(window.localStorage.getItem(visualCardColumnsStorageKey));
    return Number.isFinite(storedValue) && storedValue >= VISUAL_CARD_COLUMN_MIN
      ? storedValue
      : 5;
  });
  const [visualCardSliderMax, setVisualCardSliderMax] = useState(VISUAL_CARD_FALLBACK_MAX);

  const isSmallScreen = useMediaQuery((theme) => theme.breakpoints.down("sm"));
  const visualCardColumnsTarget = Math.min(
    Math.max(visualCardColumns, VISUAL_CARD_COLUMN_MIN),
    visualCardSliderMax
  );
  const visualCardWidth = `calc((100% - ${(visualCardColumnsTarget - 1) * VISUAL_CARD_GAP_PX}px) / ${visualCardColumnsTarget})`;

  const handleSort = (option) => {
    if (option === sortOption) {
      setSortOrder(sortOrder === "ASC" ? "DESC" : "ASC");
    } else {
      setBannersFetchedForEfficiency(false);
      setSortOption(option);
      setSortOrder("DESC");
    }
  };

  const handlePlacesListToggle = () => {
    setIsPlacesListExpanded(!isPlacesListExpanded);
  };

  const handleRetry = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  const handleViewModeChange = (nextViewMode) => {
    setViewMode(nextViewMode);
    window.localStorage.setItem(viewModeStorageKey, nextViewMode);
  };

  useEffect(() => {
    const nextState = readBrowseState(browseStateScope);

    shouldSkipRestoredLoadRef.current = nextState.hasLoaded;
    restoredScrollYRef.current = nextState.scrollY;
    shouldRestoreScrollRef.current =
      nextState.hasLoaded && nextState.scrollY > 0;

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
  }, [browseStateScope]);

  useEffect(() => {
    const updateVisualCardSliderMax = () => {
      const width = resultsAreaRef.current?.clientWidth ?? window.innerWidth;
      const computedMax = Math.max(
        VISUAL_CARD_COLUMN_MIN,
        Math.floor((width + VISUAL_CARD_GAP_PX) / (VISUAL_CARD_MIN_WIDTH_PX + VISUAL_CARD_GAP_PX))
      );
      setVisualCardSliderMax(computedMax);
      setVisualCardColumns((currentValue) => {
        const nextValue = Math.min(Math.max(currentValue, VISUAL_CARD_COLUMN_MIN), computedMax);
        window.localStorage.setItem(visualCardColumnsStorageKey, String(nextValue));
        return nextValue;
      });
    };

    updateVisualCardSliderMax();
    window.addEventListener("resize", updateVisualCardSliderMax);
    return () => {
      window.removeEventListener("resize", updateVisualCardSliderMax);
    };
  }, []);

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
    if (browseQueryKey === activeBrowseQueryKey) {
      return;
    }

    shouldSkipRestoredLoadRef.current = false;
    shouldRestoreScrollRef.current = false;
    setActiveBrowseQueryKey(browseQueryKey);
    setBanners([]);
    setBannersFetchedForEfficiency(false);
    setHasLoaded(false);
    setLoading(false);
    setLoadingMore(false);
    setHasMore(true);
    setRequestedOffset(0);
    setError("");
  }, [activeBrowseQueryKey, browseQueryKey]);

  useEffect(() => {
    if (browseQueryKey !== activeBrowseQueryKey) {
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
  const saveCurrentScrollPosition = useCallback(() => {
    saveBrowseState(browseStateScope, {
      scrollY: window.scrollY || window.pageYOffset || 0,
    });
  }, [browseStateScope]);

  useEffect(() => {
    saveBrowseState(browseStateScope, {
      filters: bannerFilters,
      sortOption,
      sortOrder,
      banners,
      hasMore,
      requestedOffset,
      bannersFetchedForEfficiency,
      isPlacesListExpanded,
      scrollY: window.scrollY || window.pageYOffset || 0,
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
  ]);

  useEffect(() => {
    let animationFrameId = null;

    const handleScroll = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        saveCurrentScrollPosition();
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", saveCurrentScrollPosition);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", saveCurrentScrollPosition);
      saveCurrentScrollPosition();
    };
  }, [saveCurrentScrollPosition]);

  useEffect(() => {
    if (!shouldRestoreScrollRef.current || !hasLoaded || loading) {
      return undefined;
    }

    const scrollY = restoredScrollYRef.current;
    shouldRestoreScrollRef.current = false;

    const restoreScroll = () => {
      window.scrollTo(0, scrollY);
    };
    const animationFrameId = window.requestAnimationFrame(restoreScroll);
    const timeoutId = window.setTimeout(restoreScroll, 120);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [displayedBanners.length, hasLoaded, loading]);

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
  const headerEyebrow = isAgentView ? "Agent" : "Explore";
  const headerTitle = isAgentView ? authorName : "Browsing";
  const headerDescription = isAgentView
    ? `Banners created by ${authorName}.`
    : "This website is not associated with Bannergress, Ingress and/or Niantic. This website is an alternative, open-source front-end for Bannergress's back-end.";

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

  useEffect(() => {
    if (
      sortOption === "Efficiency" ||
      !hasMore ||
      loading ||
      loadingMore ||
      !loadMoreRef.current
    ) {
      return undefined;
    }

    const maybeRequestMore = () => {
      setRequestedOffset((currentOffset) =>
        currentOffset === nextOffset ? currentOffset : nextOffset
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            maybeRequestMore();
          }
        });
      },
      {
        rootMargin: "320px 0px",
      }
    );

    observer.observe(loadMoreRef.current);

    const handleScrollCheck = () => {
      if (!resultsContentRef.current) {
        return;
      }

      const rect = resultsContentRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

      if (rect.bottom - viewportHeight < 320) {
        maybeRequestMore();
      }
    };

    handleScrollCheck();
    window.addEventListener("scroll", handleScrollCheck, { passive: true });
    window.addEventListener("resize", handleScrollCheck);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", handleScrollCheck);
      window.removeEventListener("resize", handleScrollCheck);
    };
  }, [hasMore, loading, loadingMore, nextOffset, sortOption]);

  return (
    <Container
      maxWidth={viewMode === "visual" ? false : "lg"}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        color: "common.white",
        fontSize: 24,
        pt: 3,
        pb: 4,
        px: viewMode === "visual" ? { xs: 2, sm: 3, lg: 4 } : undefined,
      }}
    >
      <BrowsingHeader
        eyebrow={headerEyebrow}
        title={headerTitle}
        description={headerDescription}
      />
      <Grid container spacing={2.5}>
        {isAgentView ? null : (
          <Grid item xs={12} sm={3} md={2}>
            {isSmallScreen && (
              <Box sx={{ mb: 1.5 }}>
                <Button
                  variant="outlined"
                  onClick={handlePlacesListToggle}
                  sx={{ width: "100%" }}
                >
                  {isPlacesListExpanded ? "Collapse Places" : "Expand Places"}
                </Button>
              </Box>
            )}
            <Box
              sx={{
                p: 1.5,
                borderRadius: 3,
                bgcolor: "rgba(20, 27, 33, 0.72)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 14px 32px rgba(0,0,0,0.14)",
              }}
            >
              {isPlacesListExpanded || !isSmallScreen ? (
                <PlacesList parentPlaceId={placeId} />
              ) : null}
            </Box>
          </Grid>
        )}

        <Grid
          item
          xs={12}
          sm={isAgentView || isSmallScreen ? 12 : 9}
          md={isAgentView || isSmallScreen ? 12 : 10}
          ref={resultsAreaRef}
        >
          <Box ref={resultsContentRef}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1.5,
              flexWrap: "wrap",
              mb: 2,
            }}
          >
            <BannerResultsViewToggle
              viewMode={viewMode}
              onChange={handleViewModeChange}
            />
            <SortingButtons
              handleSort={handleSort}
              sortOption={sortOption}
              sortOrder={sortOrder}
              placeId={placeId}
              bannerFilters={bannerFilters}
              onBannerFiltersChange={onBannerFiltersChange}
              leadingControls={
                viewMode === "visual" ? (
                  <VisualCardSizeButton
                    columns={visualCardColumns}
                    sliderMin={VISUAL_CARD_COLUMN_MIN}
                    sliderMax={visualCardSliderMax}
                    onColumnsChange={(nextValue) => {
                      const value = Math.min(
                        Math.max(nextValue, VISUAL_CARD_COLUMN_MIN),
                        visualCardSliderMax
                      );
                      setVisualCardColumns(value);
                      window.localStorage.setItem(visualCardColumnsStorageKey, String(value));
                    }}
                  />
                ) : null
              }
            />
          </Box>
          {error && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={handleRetry}>
                  Retry
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          {loading ? (
            viewMode === "compact" ? (
              <Stack spacing={1.25} sx={{ mt: 2, mb: 2 }}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <BannerListItem key={`browse-loading-${index}`} loading />
                ))}
              </Stack>
            ) : (
              <Grid container spacing={2.5} sx={{ mt: 2, mb: 2 }}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <Grid item xs={6} sm={4} key={`browse-grid-loading-${index}`}>
                    <Box
                      sx={{
                        height: 260,
                        borderRadius: 3,
                        bgcolor: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            )
          ) : displayedBanners.length === 0 && !error ? (
            <Alert severity="info">No banners matched this selection.</Alert>
          ) : viewMode === "compact" ? (
            <Stack spacing={1.25} sx={{ mt: 2, mb: 2 }}>
              {displayedBanners.map((banner) => (
                <BannerListItem key={banner.id} banner={banner} />
              ))}
              {loadingMore
                ? Array.from({ length: 3 }).map((_, index) => (
                    <BannerListItem key={`browse-loading-more-${index}`} loading />
                  ))
                : null}
              {hasMore ? <Box ref={loadMoreRef} sx={{ height: 1 }} /> : null}
            </Stack>
          ) : (
            <Box
              sx={{
                mt: 2,
                mb: 2,
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(${VISUAL_CARD_MIN_WIDTH_PX}px, ${visualCardWidth}))`,
                gap: 2.5,
                alignItems: "stretch",
              }}
            >
              {displayedBanners.map((banner) => (
                <Box key={banner.id} sx={{ display: "flex", alignItems: "stretch" }}>
                  <BannerCard banner={banner} maxWidth="100%" />
                </Box>
              ))}
              {loadingMore
                ? Array.from({ length: 3 }).map((_, index) => (
                    <Box key={`browse-grid-loading-more-${index}`}>
                      <Box
                        sx={{
                          height: 260,
                          borderRadius: 3,
                          bgcolor: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      />
                    </Box>
                  ))
                : null}
              {hasMore ? <Box ref={loadMoreRef} sx={{ height: 1, gridColumn: "1 / -1" }} /> : null}
            </Box>
          )}
          </Box>
        </Grid>
      </Grid>
    </Container>
  );
}
