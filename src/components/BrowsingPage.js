import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";
import { Container, Typography, Grid } from "@mui/material";
import PlacesList from "./PlacesList";

const useStyles = makeStyles((theme) => ({
  browsingContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minHeight: "100vh",
    color: theme.palette.common.white,
    fontSize: "24px",
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
  },
  bannerContainer: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  bannerGridItem: {
    display: "flex",
    justifyContent: "center",
  },
  bannerColumn: {
    minWidth: "300px",
  },
}));

export default function BrowsingPage({ placeId }) {
  const classes = useStyles();
  const [banners, setBanners] = useState([]);

  useEffect(() => {
    const fetchBanners = async () => {
      try {
        let url =
          "https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&limit=9&offset=0";
        if (placeId) {
          url += `&placeId=${placeId}`;
        }
        console.log("Fetch URL:", url);
        const response = await fetch(url);
        const data = await response.json();
        setBanners(data);
      } catch (error) {
        console.error(error);
      }
    };

    fetchBanners();
  }, [placeId]);

  return (
    <Container className={classes.browsingContainer}>
      <Typography variant="subtitle2" color="textSecondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
      <Typography variant="h5">Browsing</Typography>

      <Grid container spacing={2}>
        {!placeId && (
          <Grid item xs={12} sm={6} md={2}>
            <PlacesList />
          </Grid>
        )}
        {placeId && (
          <Grid item xs={12} sm={6} md={2}>
            <PlacesList parentPlaceId={placeId} />
          </Grid>
        )}
        <Grid item xs={12} sm={12} md={8} className={classes.bannerContainer}>
          <Grid container spacing={2}>
            {banners.map((banner) => (
              <Grid
                item
                xs={4}
                key={banner.id}
                className={classes.bannerGridItem}
              >
                <BannerCard banner={banner} />
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>
    </Container>
  );
}
