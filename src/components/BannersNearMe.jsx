import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Container,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import BannerCard from "./BannerCard";
import { fetchBannergress } from "../bannergressSync";

export default function BannersNearMe() {
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [limit, setLimit] = useState(9);
  const [error, setError] = useState("");
  const [permissionState, setPermissionState] = useState("checking");

  const requestCurrentPosition = (options) => {
    setError("");
    setLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ latitude, longitude });
      },
      (positionError) => {
        console.error("Error getting location:", positionError);
        setLoading(false);
        setError(
          "Couldn't determine your location. Please check your browser location settings and try again."
        );
      },
      options
    );
  };

  useEffect(() => {
    let ignore = false;

    const handlePermission = (status) => {
      if (ignore) {
        return;
      }

      setPermissionState(status);

      if (status === "granted") {
        setShowPermissionPrompt(false);
        requestCurrentPosition();
      } else if (status === "prompt") {
        setShowPermissionPrompt(true);
        setLoading(false);
      } else {
        setShowPermissionPrompt(false);
        setLoading(false);
      }
    };

    if ("geolocation" in navigator) {
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
    } else {
      setPermissionState("unsupported");
      setLoading(false);
      setError("This browser does not support geolocation.");
    }

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!location) {
      return;
    }

    let ignore = false;

    const loadNearbyBanners = async () => {
      setLoading(true);
      setError("");

      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint&orderDirection=ASC&online=true&proximityLatitude=${location.latitude}&proximityLongitude=${location.longitude}&limit=${limit}`;

      try {
        const response = await fetchBannergress(apiUrl);
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setBannerData(data);
          } else {
            setBannerData([]);
            setError("Nearby banners returned an unexpected response.");
          }
        }
      } catch (fetchError) {
        console.error("Error fetching banner data:", fetchError);

        if (!ignore) {
          setBannerData([]);
          setError("Couldn't load nearby banners. Please try again.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadNearbyBanners();

    return () => {
      ignore = true;
    };
  }, [location, limit]);

  const handleGrantLocationAccess = () => {
    setShowPermissionPrompt(false);
    requestCurrentPosition({ enableHighAccuracy: true });
  };

  const handleLoadMore = () => {
    setLimit(60);
  };

  const handleRetry = () => {
    if (location) {
      requestCurrentPosition({ enableHighAccuracy: true });
      return;
    }

    if (permissionState === "denied" || permissionState === "unsupported") {
      setShowPermissionPrompt(true);
      return;
    }

    handleGrantLocationAccess();
  };

  return (
    <Container sx={{ mt: 3, color: "common.white", pb: 4 }}>
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
          Discover
        </Typography>
        <Typography variant="h4" sx={{ mb: 1 }}>
          Banners near me
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" sx={{ maxWidth: 700 }}>
          Find live banners around your current location and jump into details
          quickly.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          This website is not associated with Bannergress, Ingress and/or
          Niantic. This website is an alternative, open-source front-end for
          Bannergress's back-end.
        </Typography>
      </Box>
      <Stack spacing={2} sx={{ mt: 2 }}>
        {showPermissionPrompt && (
          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={handleGrantLocationAccess}
              >
                Grant location access
              </Button>
            }
          >
            Enable location access to load nearby banners.
          </Alert>
        )}

        {!showPermissionPrompt && permissionState === "denied" && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={handleRetry}>
                Retry
              </Button>
            }
          >
            Location access is blocked. Allow it in your browser to use nearby
            banners.
          </Alert>
        )}

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

        {loading && !showPermissionPrompt && (
          <Typography variant="body2">Loading banners near you...</Typography>
        )}

        {!loading && !error && location && bannerData.length === 0 && (
          <Alert severity="info">
            No nearby banners were found for your current location.
          </Alert>
        )}

        {bannerData.length > 0 && (
          <>
            <Grid container spacing={2.5}>
              {bannerData.map((banner) => (
                <Grid item xs={12} sm={6} md={4} key={banner.id} sx={{ display: "flex" }}>
                  <BannerCard banner={banner} />
                </Grid>
              ))}
            </Grid>
            {limit === 9 && (
              <Button
                variant="contained"
                onClick={handleLoadMore}
                sx={{ mt: 2, alignSelf: "flex-start" }}
                disabled={loading}
              >
                Load more...
              </Button>
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
