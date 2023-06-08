import React, { useEffect, useState } from "react";
import { Container, Typography } from "@mui/material";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  section: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
  },
}));

export default function BannersNearMe() {
  const classes = useStyles();
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState(null);

  useEffect(() => {
    const handlePermission = (status) => {
      console.log("Permission status:", status);

      if (status === "granted") {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log(
              "Location granted. Latitude:",
              position.coords.latitude,
              "Longitude:",
              position.coords.longitude
            );
            setLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => {
            console.error("Error getting location:", error);
          }
        );
      }
    };

    console.log("Is secure context:", window.isSecureContext);

    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          console.log("Permission result:", result.state);
          handlePermission(result.state);
          result.onchange = () => {
            console.log("Permission change:", result.state);
            handlePermission(result.state);
          };
        })
        .catch((error) => {
          console.error("Error requesting location permission:", error);
        });
    } else if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log("Location granted without permission request.");
          console.log(
            "Latitude:",
            position.coords.latitude,
            "Longitude:",
            position.coords.longitude
          );
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    } else {
      console.log("Geolocation API not supported.");
    }
  }, []);

  useEffect(() => {
    if (location) {
      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint&orderDirection=ASC&online=true&proximityLatitude=${location.latitude}&proximityLongitude=${location.longitude}&limit=9`;

      console.log("API URL:", apiUrl);

      fetch(apiUrl)
        .then((response) => response.json())
        .then((data) => {
          console.log("API response:", data);
          setBannerData(data);
        })
        .catch((error) => {
          console.error("Error fetching banner data:", error);
        });
    }
  }, [location]);

  return (
    <Container className={classes.section}>
      <Typography variant="h5">Banners near me</Typography>
      {bannerData ? (
        <Typography variant="body2">{JSON.stringify(bannerData)}</Typography>
      ) : location ? (
        <Typography variant="body2">Getting banner data...</Typography>
      ) : (
        <Typography variant="body2">Location permission not allowed</Typography>
      )}
    </Container>
  );
}
