import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";
import { Container, Typography, Grid } from "@mui/material";
import CountryList from "./CountryList";
import PlaceList from "./PlaceList";

const useStyles = makeStyles((theme) => ({
  browsingContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    color: theme.palette.common.white,
    fontSize: "24px",
  },
  bannerContainer: {
    marginTop: theme.spacing(2),
  },
  bannerGridItem: {
    display: "flex",
    justifyContent: "center",
  },
  bannerColumn: {
    minWidth: "300px", // Adjust the width as desired
  },
}));

export default function BrowsingPage({ placeId }) {
  const classes = useStyles();
  const [banners, setBanners] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);

  useEffect(() => {
    let url =
      "https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&limit=9&offset=0";
    if (placeId) {
      url += `&placeId=${placeId}`;
    }
    fetch(url)
      .then((response) => response.json())
      .then((data) => setBanners(data))
      .catch((error) => console.error(error));
  }, [placeId]);

  const handleCountryClick = (countryId) => {
    setSelectedCountry(countryId);
  };

  return (
    <Container className={classes.browsingContainer}>
      <Typography variant="subtitle2" color="textSecondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
      <Typography variant="h5">Browsing</Typography>

      <Grid container spacing={2}>
        {!selectedCountry && (
          <Grid item xs={12} sm={6} md={4}>
            <CountryList onCountryClick={handleCountryClick} />
          </Grid>
        )}
        {selectedCountry && (
          <Grid item xs={12} sm={6} md={4}>
            <PlaceList placeId={selectedCountry} />
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
