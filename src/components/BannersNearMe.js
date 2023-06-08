import React, { useEffect, useState } from "react";
import {
  Container,
  Typography,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Grid,
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
}));

export default function BannersNearMe() {
  const classes = useStyles();
  const [location, setLocation] = useState(null);
  const [bannerData, setBannerData] = useState([]);

  useEffect(() => {
    const handlePermission = (status) => {
      if (status === "granted") {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            setLocation({ latitude, longitude });
          },
          (error) => {
            console.error("Error getting location:", error);
          }
        );
      }
    };

    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          handlePermission(result.state);
          result.onchange = () => {
            handlePermission(result.state);
          };
        })
        .catch((error) => {
          console.error("Error requesting location permission:", error);
        });
    } else if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
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
      {location ? (
        <Grid container spacing={2}>
          {bannerData.map((banner) => (
            <Grid item xs={12} sm={6} md={4} key={banner.id}>
              <Card className={classes.card}>
                <CardActionArea component="a" href={`/banner/${banner.id}`}>
                  <CardMedia
                    component="img"
                    alt={banner.title}
                    height="140"
                    image={`https://api.bannergress.com${banner.picture}`}
                  />
                  <CardContent>
                    <Typography gutterBottom variant="h6" component="div">
                      {banner.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {banner.numberOfMissions} Missions,{" "}
                      {(banner.lengthMeters / 1000).toFixed(1)} km
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
      ) : (
        <Typography variant="body2">Location permission not allowed</Typography>
      )}
    </Container>
  );
}
