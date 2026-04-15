import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BannerCard from "./BannerCard";
import {
  Alert,
  Box,
  Button,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";

export default function SearchResults() {
  const [results, setResults] = useState([]);
  const [bannerData, setBannerData] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [bannersError, setBannersError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
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
        const response = await fetch(
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

  const finishedLoading = !placesLoading && !bannersLoading;
  const noResults =
    finishedLoading &&
    !placesError &&
    !bannersError &&
    results.length === 0 &&
    bannerData.length === 0;

  return (
    <Box sx={{ mt: 2, px: 2, color: "common.white" }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
            Search: {query}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Places and banners load independently.
          </Typography>
        </Box>

        <Box>
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

        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Banners
          </Typography>
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
          ) : bannersLoading ? (
            <Grid container spacing={2} sx={{ mt: 0 }}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Grid item xs={6} sm={4} key={`search-skeleton-${index}`}>
                  <Skeleton variant="rounded" height={260} />
                </Grid>
              ))}
            </Grid>
          ) : bannerData.length > 0 ? (
            <Grid container spacing={2} sx={{ mt: 0 }}>
              {bannerData.map((banner) => (
                <Grid
                  item
                  xs={6}
                  sm={4}
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
