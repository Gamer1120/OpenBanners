import React, { useEffect, useState } from "react";
import { Container, Typography } from "@mui/material";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  section: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
  },
  permissionText: {
    color: theme.palette.error.main,
  },
}));

export default function BannersNearMe() {
  const classes = useStyles();
  const [permissionStatus, setPermissionStatus] = useState("unknown");

  useEffect(() => {
    const handlePermission = (status) => {
      setPermissionStatus(status);
      if (status === "granted") {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            console.log("Latitude:", latitude);
            console.log("Longitude:", longitude);
          },
          (error) => {
            console.error("Error getting location:", error);
          }
        );
      }
    };

    if ("permissions" in navigator) {
      navigator.permissions.query({ name: "geolocation" }).then((result) => {
        handlePermission(result.state);
        result.onchange = () => {
          handlePermission(result.state);
        };
      });
    } else if ("geolocation" in navigator) {
      handlePermission("granted");
    } else {
      handlePermission("denied");
    }
  }, []);

  return (
    <Container className={classes.section}>
      <Typography variant="h5">Banners near me</Typography>
      {permissionStatus !== "granted" && (
        <Typography variant="body2" className={classes.permissionText}>
          Location Permission not allowed
        </Typography>
      )}
    </Container>
  );
}
