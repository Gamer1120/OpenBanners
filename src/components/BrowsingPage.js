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
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "center",
    marginTop: theme.spacing(2),
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

      <div className={classes.bannerContainer}>
        <Grid container spacing={2}>
          {selectedCountry ? (
            <PlaceList placeId={selectedCountry} />
          ) : (
            <CountryList onCountryClick={handleCountryClick} />
          )}
          {banners.map((banner) => (
            <Grid item xs={12} sm={6} md={4} key={banner.id}>
              <BannerCard banner={banner} />
            </Grid>
          ))}
        </Grid>
      </div>
    </Container>
  );
}
