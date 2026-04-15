import React, { useEffect, useState } from "react";
import BannerCard from "./BannerCard";
import {
  Alert,
  Box,
  Button,
  Container,
  Grid,
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
        pt: 2,
        pb: 2,
      }}
    >
      <BrowsingHeader />
      <Grid container spacing={2}>
        <Grid item xs={12} sm={3} md={2}>
          {isSmallScreen && (
            <div>
              <Button variant="outlined" onClick={handlePlacesListToggle}>
                {isPlacesListExpanded ? "Collapse Places" : "Expand Places"}
              </Button>
            </div>
          )}
          <div>
            {isPlacesListExpanded || !isSmallScreen ? (
              <PlacesList parentPlaceId={placeId} />
            ) : null}
          </div>
        </Grid>

        <Grid item xs={12} sm={isSmallScreen ? 12 : 9} md={isSmallScreen ? 12 : 10}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              mb: 2,
            }}
          >
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
            <Typography variant="body2" color="text.secondary">
              Loading...
            </Typography>
          ) : banners.length === 0 && !error ? (
            <Alert severity="info">No banners matched this selection.</Alert>
          ) : (
            <Grid container spacing={2} sx={{ mt: 2, mb: 2 }}>
              {banners.map((banner) => (
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
          )}
        </Grid>
      </Grid>
    </Container>
  );
}
