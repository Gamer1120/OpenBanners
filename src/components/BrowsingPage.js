import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";
import { Container, Grid } from "@mui/material";
import BrowsingHeader from "./BrowsingHeader";
import SortingButtons from "./SortingButtons";
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
      if (sortOption === "Efficiency") {
        setSortOption("Created")
      } else {
        setSortOption(option);
      }
      setSortOrder("DESC");
    }
  };
  
  function sortJsonByMissionsPerLength(data, sortOrder) {
    return data.sort((a, b) => {
      const missionsPerLengthA = a.numberOfMissions / a.lengthMeters;
      const missionsPerLengthB = b.numberOfMissions / b.lengthMeters;
  
      if (sortOrder === "ASC") {
        return missionsPerLengthA - missionsPerLengthB;
      } else if (sortOrder === "DESC") {
        return missionsPerLengthB - missionsPerLengthA;
      } else {
        return missionsPerLengthA - missionsPerLengthB;
      }
    });
  }

  const fetchBanners = async () => {
    try {
      let url =
        "https://api.bannergress.com/bnrs?online=true&limit=100&offset=0";
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

  const fetchAllBanners = async () => {
    try {
      let offset = 0;
      let allBanners = [];

      if (!placeId) {
        return;
      }
  
      while (true) {
        let url =
          `https://api.bannergress.com/bnrs?online=true&limit=100&offset=${offset}`;
  
        if (placeId) {
          url += `&placeId=${placeId}`;
        }

        console.log("Fetch URL:", url);
  
        const response = await fetch(url);
        const data = await response.json();
  
        if (data && Array.isArray(data)) {
          console.log("Fetch Response:", data);
          allBanners = [...allBanners, ...data];
          if (data.length === 0) {
            break;
          }
          offset += 100;
        } else {
          console.error("Invalid response data:", data);
          break;
        }
      }
  
      setBanners(allBanners);
    } catch (error) {
      console.error(error);
    }
  };  

  useEffect(() => {
    setSortOption("Created");
    setSortOrder("DESC");
    setBanners([]);
    fetchBanners();
  }, [placeId]);

  useEffect(() => {
    switch (sortOption) {
      case "Efficiency":
        fetchAllBanners()
        setBanners((banners) =>
          sortJsonByMissionsPerLength([...banners], sortOrder)
        );
        break;
      default:
        fetchBanners();
    }
  }, [sortOption, sortOrder]);

  return (
    <Container className={classes.browsingContainer}>
      <BrowsingHeader />
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2}>
          {!placeId && <PlacesList />}
          {placeId && <PlacesList parentPlaceId={placeId} />}
        </Grid>
        <Grid item xs={12} sm={12} md={10}>
          <div className={classes.sortingContainer}>
            <SortingButtons
              handleSort={handleSort}
              sortOption={sortOption}
              sortOrder={sortOrder}
            />
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
