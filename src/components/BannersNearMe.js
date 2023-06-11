import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Container, Typography, Grid, Button } from "@mui/material";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";

const useStyles = makeStyles((theme) => ({
  section: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
  },
  loadMoreButton: {
    marginTop: theme.spacing(2),
  },
}));

export default function BannersNearMe() {
  const classes = useStyles();
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState("prompt");
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [limit, setLimit] = useState(9);

  useEffect(() => {
    const handlePermission = (status) => {
      setPermissionStatus(status);
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
    <Container className={classes.section}>
      <Typography variant="subtitle2" color="textSecondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end...
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
              <Grid item xs={12} sm={6} md={4} key={banner.id}>
                <BannerCard banner={banner} />
              </Grid>
            ))}
          </Grid>
          {limit === 9 && (
            <Button
              variant="contained"
              className={classes.loadMoreButton}
              onClick={handleLoadMore}
            >
              Load more...
            </Button>
          )}
        </>
      )}
    </Container>
  );
}
