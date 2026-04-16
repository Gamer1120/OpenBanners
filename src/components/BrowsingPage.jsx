import React, { useEffect, useMemo, useRef, useState } from "react";
import BannerListItem from "./BannerListItem";
import BannerCard from "./BannerCard";
import BannerResultsViewToggle from "./BannerResultsViewToggle";
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
} from "../bannerFilters";

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
}) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("limit", String(BROWSE_PAGE_SIZE));
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
const BROWSE_PAGE_SIZE = 9;
const FILTERED_BROWSE_PREFETCH_TARGET = BROWSE_PAGE_SIZE * 2;

export default function BrowsingPage({
  placeId,
  authorName,
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  const [banners, setBanners] = useState([]);
  const [sortOption, setSortOption] = useState("Created");
  const [sortOrder, setSortOrder] = useState("DESC");
  const [bannersFetchedForEfficiency, setBannersFetchedForEfficiency] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [requestedOffset, setRequestedOffset] = useState(0);
  const [isPlacesListExpanded, setIsPlacesListExpanded] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const syncState = useBannergressSync();
  const loadMoreRef = useRef(null);
  const [activeBrowseQueryKey, setActiveBrowseQueryKey] = useState("");
  const [viewMode, setViewMode] = useState(() => {
    const storedValue = window.localStorage.getItem(viewModeStorageKey);
    return storedValue === "compact" ? "compact" : "visual";
  });

  const isSmallScreen = useMediaQuery((theme) => theme.breakpoints.down("sm"));

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
    setSortOption("Created");
    setSortOrder("DESC");
  }, [authorName, placeId]);

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
    setActiveBrowseQueryKey(browseQueryKey);
    setBanners([]);
    setBannersFetchedForEfficiency(false);
    setLoading(false);
    setLoadingMore(false);
    setHasMore(true);
    setRequestedOffset(0);
    setError("");
  }, [browseQueryKey]);

  useEffect(() => {
    if (browseQueryKey !== activeBrowseQueryKey) {
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
            return;
          }

          let offset = 0;
          let allBanners = [];

          while (!ignore) {
            const response = await fetchBannergress(
              buildBannersUrl({
                placeId,
                authorName,
                sortOption: null,
                sortOrder,
                showOfflineBanners: bannerFilters.showOfflineBanners,
                offset,
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

            offset += 100;
          }

          if (!ignore) {
            setBanners(sortJsonByMissionsPerLength(allBanners, sortOrder));
            setBannersFetchedForEfficiency(true);
            setHasMore(false);
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
          } else {
            console.error("Invalid response data:", data);
            if (requestedOffset === 0) {
              setBanners([]);
            }
            setError("Couldn't load banners.");
            setHasMore(false);
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error(fetchError);
          if (requestedOffset === 0) {
            setBanners([]);
          }
          setError("Couldn't load banners. Please try again.");
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

  const minimumMissions = Number(bannerFilters?.minimumMissions) || 0;
  const nextOffset = banners.length;
  const displayedBanners = useMemo(
    () =>
      applyBannerFilters(banners, syncState, bannerFilters).filter(
        (banner) => Number(banner?.numberOfMissions) >= minimumMissions
      ),
    [banners, bannerFilters, minimumMissions, syncState]
  );
  const filteredPrefetchTarget =
    minimumMissions > 0 ? FILTERED_BROWSE_PREFETCH_TARGET : BROWSE_PAGE_SIZE;
  const needsFilteredBackfill =
    displayedBanners.length === 0 ||
    (minimumMissions > 0 &&
      displayedBanners.length < Math.min(filteredPrefetchTarget, banners.length));
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

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRequestedOffset((currentOffset) =>
              currentOffset === nextOffset ? currentOffset : nextOffset
            );
          }
        });
      },
      {
        rootMargin: "320px 0px",
      }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, loadingMore, nextOffset, sortOption]);

  return (
    <Container
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        color: "common.white",
        fontSize: 24,
        pt: 3,
        pb: 4,
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
        >
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
            <Grid container spacing={2.5} sx={{ mt: 2, mb: 2 }}>
              {displayedBanners.map((banner) => (
                <Grid
                  item
                  xs={12}
                  sm={6}
                  lg={4}
                  key={banner.id}
                  sx={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "stretch",
                  }}
                >
                  <BannerCard banner={banner} />
                </Grid>
              ))}
              {loadingMore
                ? Array.from({ length: 3 }).map((_, index) => (
                    <Grid
                      item
                      xs={12}
                      sm={6}
                      lg={4}
                      key={`browse-grid-loading-more-${index}`}
                    >
                      <Box
                        sx={{
                          height: 260,
                          borderRadius: 3,
                          bgcolor: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      />
                    </Grid>
                  ))
                : null}
              {hasMore ? (
                <Grid item xs={12}>
                  <Box ref={loadMoreRef} sx={{ height: 1 }} />
                </Grid>
              ) : null}
            </Grid>
          )}
        </Grid>
      </Grid>
    </Container>
  );
}
