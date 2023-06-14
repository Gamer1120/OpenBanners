import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";
import { Container, Typography, Grid, Button } from "@mui/material";
import { ArrowDropDown, ArrowDropUp } from "@mui/icons-material";
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
  sortingContainer: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: theme.spacing(2),
  },
  sortingButton: {
    marginLeft: theme.spacing(2),
  },
}));

export default function BrowsingPage({ placeId }) {
  const classes = useStyles();
  const [banners, setBanners] = useState([]);
  const [sortOption, setSortOption] = useState("created");
  const [sortOrder, setSortOrder] = useState("desc");

  const handleSort = (option) => {
    if (option === sortOption) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortOption(option);
      setSortOrder("desc");
    }
  };

  useEffect(() => {
    const fetchBanners = async () => {
      try {
        let url =
          "https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&limit=9&offset=0";
        if (placeId) {
          url += `&placeId=${placeId}`;
        }
        url += `&orderBy=${sortOption}&orderDirection=${sortOrder}`;
        console.log("Fetch URL:", url);
        const response = await fetch(url);
        const data = await response.json();
        setBanners(data);
      } catch (error) {
        console.error(error);
      }
    };

    fetchBanners();
  }, [placeId, sortOption, sortOrder]);

  return (
    <Container className={classes.browsingContainer}>
      <Typography variant="subtitle2" color="textSecondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
      <Typography variant="h5">Browsing</Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2}>
          {!placeId && <PlacesList />}
          {placeId && <PlacesList parentPlaceId={placeId} />}
        </Grid>
        <Grid item xs={12} sm={12} md={10}>
          <div className={classes.sortingContainer}>
            <Button
              variant="outlined"
              onClick={() => handleSort("created")}
              endIcon={
                sortOption === "created" ? (
                  sortOrder === "asc" ? (
                    <ArrowDropUp />
                  ) : (
                    <ArrowDropDown />
                  )
                ) : null
              }
              className={classes.sortingButton}
            >
              Created
            </Button>
            <Button
              variant="outlined"
              onClick={() => handleSort("title")}
              endIcon={
                sortOption === "title" ? (
                  sortOrder === "asc" ? (
                    <ArrowDropUp />
                  ) : (
                    <ArrowDropDown />
                  )
                ) : null
              }
              className={classes.sortingButton}
            >
              A-Z
            </Button>
            <Button
              variant="outlined"
              onClick={() => handleSort("distance")}
              endIcon={
                sortOption === "distance" ? (
                  sortOrder === "asc" ? (
                    <ArrowDropUp />
                  ) : (
                    <ArrowDropDown />
                  )
                ) : null
              }
              className={classes.sortingButton}
            >
              Distance
            </Button>
            <Button
              variant="outlined"
              onClick={() => handleSort("missions")}
              endIcon={
                sortOption === "missions" ? (
                  sortOrder === "asc" ? (
                    <ArrowDropUp />
                  ) : (
                    <ArrowDropDown />
                  )
                ) : null
              }
              className={classes.sortingButton}
            >
              Nr. of Missions
            </Button>
          </div>
          <Grid container spacing={2} className={classes.bannerContainer}>
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
