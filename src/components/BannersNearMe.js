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

  useEffect(() => {
    const handlePermission = (status) => {
      console.log("Permission status:", status);

      if (status === "granted") {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            console.log(
              "Location granted. Latitude:",
              latitude,
              "Longitude:",
              longitude
            );
            setLocation({ latitude, longitude });
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
          const { latitude, longitude } = position.coords;
          console.log("Latitude:", latitude, "Longitude:", longitude);
          setLocation({ latitude, longitude });
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    } else {
      console.log("Geolocation API not supported.");
    }
  }, []);

  return (
    <Container className={classes.section}>
      <Typography variant="h5">Banners near me</Typography>
      {location ? (
        <Typography variant="body2">
          Latitude: {location.latitude}, Longitude: {location.longitude}
        </Typography>
      ) : (
        <Typography variant="body2">Location permission not allowed</Typography>
      )}
    </Container>
  );
}
