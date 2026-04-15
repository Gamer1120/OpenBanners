import React, { useEffect, useState } from "react";
import { Container, Typography, Grid, Button } from "@mui/material";
import BannerCard from "./BannerCard";

export default function BannersNearMe() {
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [limit, setLimit] = useState(9);

  useEffect(() => {
    const handlePermission = (status) => {
      if (status === "granted") {
        setShowPermissionPrompt(false);
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            setLocation({ latitude, longitude });
          },
          (error) => {
            console.error("Error getting location:", error);
          }
        );
      } else if (status === "prompt") {
        setShowPermissionPrompt(true);
      }
    };

    if ("geolocation" in navigator) {
      navigator.permissions.query({ name: "geolocation" }).then((result) => {
        handlePermission(result.state);
        result.onchange = () => {
          handlePermission(result.state);
        };
      });
    } else {
      handlePermission("denied");
    }
  }, []);

  useEffect(() => {
    if (location) {
      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint&orderDirection=ASC&online=true&proximityLatitude=${location.latitude}&proximityLongitude=${location.longitude}&limit=${limit}`;

      fetch(apiUrl)
        .then((response) => response.json())
        .then((data) => {
          setBannerData(data);
          setLoading(false);
        })
        .catch((error) => {
          console.error("Error fetching banner data:", error);
        });
    }
  }, [location, limit]);

  const handleGrantLocationAccess = () => {
    setShowPermissionPrompt(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ latitude, longitude });
      },
      (error) => {
        console.error("Error getting location:", error);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleLoadMore = () => {
    setLimit(60);
  };

  return (
    <Container sx={{ mt: 2, color: "common.white" }}>
      <Typography variant="subtitle2" color="textSecondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
      <Typography variant="h5">Banners near me</Typography>
      {loading ? (
        showPermissionPrompt ? (
          <Button variant="contained" onClick={handleGrantLocationAccess}>
            Grant location access
          </Button>
        ) : (
          <Typography variant="body2">Loading banners near you...</Typography>
        )
      ) : (
        <>
          <Grid container spacing={2}>
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
              sx={{ mt: 2 }}
            >
              Load more...
            </Button>
          )}
        </>
      )}
    </Container>
  );
}
