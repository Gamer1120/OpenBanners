import React, { useEffect, useState } from "react";
import {
  Container,
  Typography,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Grid,
  Button,
} from "@mui/material";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  section: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
  },
  card: {
    maxWidth: 345,
    margin: theme.spacing(2),
  },
  cardMediaWrapper: {
    position: "relative",
    paddingTop: "66.6667%", // 2:3 aspect ratio (height:width)
    overflow: "hidden",
  },
  cardMedia: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto",
    height: "auto",
    objectFit: "contain",
  },
}));

export default function BannersNearMe() {
  const classes = useStyles();
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState("prompt");
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);

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
      console.log("Geolocation API not supported.");
      handlePermission("denied");
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
          setLoading(false);
        })
        .catch((error) => {
          console.error("Error fetching banner data:", error);
        });
    }
  }, [location]);

  const handleGrantLocationAccess = () => {
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
  };

  return (
    <Container className={classes.section}>
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
        <Grid container spacing={2}>
          {bannerData.map((banner) => (
            <Grid item xs={12} sm={6} md={4} key={banner.id}>
              <Card className={classes.card}>
                <CardActionArea>
                  <div className={classes.cardMediaWrapper}>
                    <CardMedia
                      component="img"
                      image={`https://api.bannergress.com${banner.picture}`}
                      alt={banner.title}
                      className={classes.cardMedia}
                    />
                  </div>
                  <CardContent>
                    <Typography gutterBottom variant="h6" component="div">
                      {banner.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {banner.numberOfMissions} Missions,{" "}
                      {Math.round(banner.lengthMeters / 1000)} km
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {banner.formattedAddress}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
