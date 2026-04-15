import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BannerCard from "./BannerCard";
import BannerListItem from "./BannerListItem";
import BannerResultsViewToggle from "./BannerResultsViewToggle";
import {
  Alert,
  Box,
  Button,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { fetchBannergress } from "../bannergressSync";

const viewModeStorageKey = "openbanners-banner-view-mode";

export default function SearchResults() {
  const [results, setResults] = useState([]);
  const [bannerData, setBannerData] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [bannersError, setBannersError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [viewMode, setViewMode] = useState(() => {
    const storedValue = window.localStorage.getItem(viewModeStorageKey);
    return storedValue === "compact" ? "compact" : "visual";
  });
  const { query } = useParams();

  useEffect(() => {
    let ignore = false;

    const fetchPlaces = async () => {
      setPlacesLoading(true);
      setPlacesError("");

      try {
        const response = await fetch(
          `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
            query
          )}&limit=100&offset=0`
        );
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setResults(data);
          } else {
            setResults([]);
            setPlacesError("Place results returned an unexpected response.");
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching place results:", fetchError);
          setResults([]);
          setPlacesError("Couldn't load matching places.");
        }
      } finally {
        if (!ignore) {
          setPlacesLoading(false);
        }
      }
    };

    const fetchBanners = async () => {
      setBannersLoading(true);
      setBannersError("");

      try {
        const response = await fetchBannergress(
          `https://api.bannergress.com/bnrs?orderBy=relevance&orderDirection=DESC&online=true&query=${encodeURIComponent(
            query
          )}&limit=100&offset=0`
        );
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setBannerData(data);
          } else {
            setBannerData([]);
            setBannersError("Banner results returned an unexpected response.");
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching banner results:", fetchError);
          setBannerData([]);
          setBannersError("Couldn't load matching banners.");
        }
      } finally {
        if (!ignore) {
          setBannersLoading(false);
        }
      }
    };

    fetchPlaces();
    fetchBanners();

    return () => {
      ignore = true;
    };
  }, [query, reloadToken]);

  const reloadSearch = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  const handleViewModeChange = (nextViewMode) => {
    setViewMode(nextViewMode);
    window.localStorage.setItem(viewModeStorageKey, nextViewMode);
  };

  const finishedLoading = !placesLoading && !bannersLoading;
  const noResults =
    finishedLoading &&
    !placesError &&
    !bannersError &&
    results.length === 0 &&
    bannerData.length === 0;

  return (
    <Box sx={{ mt: 3, px: 2, pb: 4, color: "common.white" }}>
      <Stack spacing={3}>
        <Box
          sx={{
            p: { xs: 2.25, sm: 3 },
            borderRadius: 3,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(20, 27, 33, 0.78)",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.22)",
          }}
        >
          <Typography
            variant="overline"
            sx={{ color: "text.secondary", letterSpacing: "0.18em" }}
          >
            Search
          </Typography>
          <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
            Search: {query}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Places and banners load independently so you can act on early results.
          </Typography>
        </Box>

        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            borderRadius: 3,
            bgcolor: "rgba(20, 27, 33, 0.72)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 14px 32px rgba(0,0,0,0.14)",
          }}
        >
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Places
          </Typography>
          {placesError ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={reloadSearch}>
                  Retry
                </Button>
              }
            >
              {placesError}
            </Alert>
          ) : placesLoading ? (
            <Stack spacing={1}>
              <Skeleton variant="text" width={220} height={32} />
              <Skeleton variant="text" width={260} height={32} />
            </Stack>
          ) : results.length > 0 ? (
            <Stack spacing={1}>
              {results.map((result, index) => (
                <Typography
                  key={index}
                  component={Link}
                  to={`/browse/${result.id}`}
                  sx={{
                    color: "common.white",
                    cursor: "pointer",
                    textDecoration: "none",
                    "&:hover": {
                      textDecoration: "underline",
                    },
                  }}
                >
                  {`${result.shortName} (${result.type}) (${result.numberOfBanners})`}
                </Typography>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No matching places found.
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            borderRadius: 3,
            bgcolor: "rgba(20, 27, 33, 0.72)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 14px 32px rgba(0,0,0,0.14)",
          }}
        >
          <Box
            sx={{
              mb: 1.5,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1.5,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="h6" component="h2">
              Banners
            </Typography>
            <BannerResultsViewToggle
              viewMode={viewMode}
              onChange={handleViewModeChange}
            />
          </Box>
          {bannersError ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={reloadSearch}>
                  Retry
                </Button>
              }
            >
              {bannersError}
            </Alert>
          ) : bannersLoading && viewMode === "compact" ? (
            <Stack spacing={1.25} sx={{ mt: 0.5 }}>
              {Array.from({ length: 3 }).map((_, index) => (
                <BannerListItem key={`search-skeleton-${index}`} loading />
              ))}
            </Stack>
          ) : bannersLoading ? (
            <Grid container spacing={2} sx={{ mt: 0 }}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Grid item xs={12} sm={6} lg={4} key={`search-grid-skeleton-${index}`}>
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
          ) : bannerData.length > 0 && viewMode === "compact" ? (
            <Stack spacing={1.25} sx={{ mt: 0.5 }}>
              {bannerData.map((banner) => (
                <BannerListItem key={banner.id} banner={banner} />
              ))}
            </Stack>
          ) : bannerData.length > 0 ? (
            <Grid container spacing={2} sx={{ mt: 0 }}>
              {bannerData.map((banner) => (
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
          ) : (
            <Typography variant="body2" color="text.secondary">
              No matching banners found.
            </Typography>
          )}
        </Box>

        {noResults && (
          <Alert severity="info">No results found for "{query}".</Alert>
        )}
      </Stack>
    </Box>
  );
}
