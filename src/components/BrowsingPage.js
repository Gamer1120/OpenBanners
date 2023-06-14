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
  const [sortOption, setSortOption] = useState("Created");
  const [sortOrder, setSortOrder] = useState("DESC");

  const sortOptionsMap = {
    Created: "created",
    "A-Z": "title",
    Distance: "lengthMeters",
    "Nr. of Missions": "numberOfMissions",
  };

  const handleSort = (option) => {
    if (option === sortOption) {
      setSortOrder(sortOrder === "ASC" ? "DESC" : "ASC");
    } else {
      setSortOption(option);
      setSortOrder("DESC");
    }
  };

  useEffect(() => {
    const fetchBanners = async () => {
      try {
        let url =
          "https://api.bannergress.com/bnrs?online=true&limit=9&offset=0";
        if (placeId) {
          url += `&placeId=${placeId}`;
        }
        url += `&orderBy=${sortOptionsMap[sortOption]}&orderDirection=${sortOrder}`;
        console.log("Fetch URL:", url);
        const response = await fetch(url);
        const data = await response.json();
        if (data && Array.isArray(data)) {
          console.log("Fetch Response:", data);
          setBanners(data);
        } else {
          console.error("Invalid response data:", data);
        }
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
              onClick={() => handleSort("Created")}
              endIcon={
                sortOption === "Created" ? (
                  sortOrder === "ASC" ? (
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
              onClick={() => handleSort("A-Z")}
              endIcon={
                sortOption === "A-Z" ? (
                  sortOrder === "ASC" ? (
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
              onClick={() => handleSort("Distance")}
              endIcon={
                sortOption === "Distance" ? (
                  sortOrder === "ASC" ? (
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
              onClick={() => handleSort("Nr. of Missions")}
              endIcon={
                sortOption === "Nr. of Missions" ? (
                  sortOrder === "ASC" ? (
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
