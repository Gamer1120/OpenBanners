import React, { useEffect, useState } from "react";
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
  sortOption,
  sortOrder,
  showOffline,
  offset,
}) {
  let url = `https://api.bannergress.com/bnrs?limit=100&offset=${offset}`;

  if (placeId) {
    url += `&placeId=${placeId}`;
  }

  if (sortOption) {
    url += `&orderBy=${sortOption}&orderDirection=${sortOrder}`;
  }

  if (!showOffline) {
    url += "&online=true";
  }

  return url;
}

const sortOptionsMap = {
  Created: "created",
  "A-Z": "title",
  Distance: "lengthMeters",
  "Nr. of Missions": "numberOfMissions",
};
const viewModeStorageKey = "openbanners-banner-view-mode";

export default function BrowsingPage({ placeId }) {
  const [banners, setBanners] = useState([]);
  const [sortOption, setSortOption] = useState("Created");
  const [sortOrder, setSortOrder] = useState("DESC");
  const [bannersFetchedForEfficiency, setBannersFetchedForEfficiency] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [isPlacesListExpanded, setIsPlacesListExpanded] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
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

  const toggleShowOffline = () => {
    setShowOffline(!showOffline);
    setBannersFetchedForEfficiency(false);
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
    setBanners([]);
    setBannersFetchedForEfficiency(false);
    setError("");
  }, [placeId]);

  useEffect(() => {
    let ignore = false;

    const loadBanners = async () => {
      setLoading(true);
      setError("");

      try {
        if (sortOption === "Efficiency") {
          if (bannersFetchedForEfficiency) {
            setBanners((currentBanners) =>
              sortJsonByMissionsPerLength(currentBanners, sortOrder)
            );
            setLoading(false);
            return;
          }

          if (!placeId) {
            setBanners([]);
            setLoading(false);
            return;
          }

          let offset = 0;
          let allBanners = [];

          while (!ignore) {
            const response = await fetch(
              buildBannersUrl({
                placeId,
                sortOption: null,
                sortOrder,
                showOffline,
                offset,
              })
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
          }

          return;
        }

        const response = await fetch(
          buildBannersUrl({
            placeId,
            sortOption: sortOptionsMap[sortOption],
            sortOrder,
            showOffline,
            offset: 0,
          })
        );
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setBanners(data);
          } else {
            console.error("Invalid response data:", data);
            setBanners([]);
            setError("Couldn't load banners.");
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error(fetchError);
          setBanners([]);
          setError("Couldn't load banners. Please try again.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadBanners();

    return () => {
      ignore = true;
    };
  }, [
    placeId,
    sortOption,
    sortOrder,
    showOffline,
    bannersFetchedForEfficiency,
    reloadToken,
  ]);

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
      <BrowsingHeader />
      <Grid container spacing={2.5}>
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

        <Grid item xs={12} sm={isSmallScreen ? 12 : 9} md={isSmallScreen ? 12 : 10}>
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
              showOffline={showOffline}
              toggleShowOffline={toggleShowOffline}
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
          ) : banners.length === 0 && !error ? (
            <Alert severity="info">No banners matched this selection.</Alert>
          ) : viewMode === "compact" ? (
            <Stack spacing={1.25} sx={{ mt: 2, mb: 2 }}>
              {banners.map((banner) => (
                <BannerListItem key={banner.id} banner={banner} />
              ))}
            </Stack>
          ) : (
            <Grid container spacing={2.5} sx={{ mt: 2, mb: 2 }}>
              {banners.map((banner) => (
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
            </Grid>
          )}
        </Grid>
      </Grid>
    </Container>
  );
}
