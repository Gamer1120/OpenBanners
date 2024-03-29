import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";
import {
  useMediaQuery,
  Container,
  Grid,
  Typography,
  Button,
} from "@mui/material";
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
  const [bannersFetchedForEfficiency, setBannersFetchedForEfficiency] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [isPlacesListExpanded, setIsPlacesListExpanded] = useState(false);

  const isSmallScreen = useMediaQuery((theme) => theme.breakpoints.down("sm"));

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
        setSortOption("Created");
      } else {
        setBannersFetchedForEfficiency(false);
        setSortOption(option);
      }
      setSortOrder("DESC");
    }
  };

  const toggleShowOffline = () => {
    setShowOffline(!showOffline);
  };

  const handlePlacesListToggle = () => {
    setIsPlacesListExpanded(!isPlacesListExpanded);
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
      let url = "https://api.bannergress.com/bnrs?limit=100&offset=0";
      if (placeId) {
        url += `&placeId=${placeId}`;
      }
      url += `&orderBy=${sortOptionsMap[sortOption]}&orderDirection=${sortOrder}`;
      if (!showOffline) {
        url += "&online=true";
      }
      const response = await fetch(url);
      const data = await response.json();
      if (data && Array.isArray(data)) {
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

      if (!placeId || bannersFetchedForEfficiency) {
        return allBanners;
      }

      setLoading(true);

      while (true) {
        let url = `https://api.bannergress.com/bnrs?limit=100&offset=${offset}`;

        if (placeId) {
          url += `&placeId=${placeId}`;
        }

        if (!showOffline) {
          url += "&online=true";
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data && Array.isArray(data)) {
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

      setLoading(false);

      return allBanners;
    } catch (error) {
      console.error(error);
      return [];
    }
  };

  useEffect(() => {
    setSortOption("Created");
    setSortOrder("DESC");
    setBanners([]);
    setBannersFetchedForEfficiency(false);
    fetchBanners();
  }, [placeId]);

  useEffect(() => {
    if (sortOption === "Efficiency") {
      if (bannersFetchedForEfficiency) {
        const sortedBanners = sortJsonByMissionsPerLength(banners, sortOrder);
        setBanners(sortedBanners);
      } else {
        fetchAllBanners().then((allBanners) => {
          const sortedBanners = sortJsonByMissionsPerLength(
            allBanners,
            sortOrder
          );
          setBanners(sortedBanners);
          setBannersFetchedForEfficiency(true);
        });
      }
    } else {
      fetchBanners();
    }
  }, [sortOption, sortOrder, showOffline]);

  return (
    <Container className={classes.browsingContainer}>
      <BrowsingHeader />
      <Grid container spacing={2}>
        <Grid item xs={12} sm={3} md={2}>
          {isSmallScreen && (
            <div>
              <Button variant="outlined" onClick={handlePlacesListToggle}>
                {isPlacesListExpanded ? "Collapse Places" : "Expand Places"}
              </Button>
            </div>
          )}
          <div>
            {isPlacesListExpanded || !isSmallScreen ? (
              <PlacesList parentPlaceId={placeId} />
            ) : null}
          </div>
        </Grid>

        <Grid
          item
          xs={12}
          sm={isSmallScreen ? 12 : 9}
          md={isSmallScreen ? 12 : 10}
        >
          <div className={classes.sortingContainer}>
            <SortingButtons
              handleSort={handleSort}
              sortOption={sortOption}
              sortOrder={sortOrder}
              placeId={placeId}
              showOffline={showOffline}
              toggleShowOffline={toggleShowOffline}
            />
          </div>
          {loading ? (
            <Typography
              variant="body2"
              color="text.secondary"
              className={classes.loadingText}
            >
              Loading...
            </Typography>
          ) : (
            <Grid container spacing={2} className={classes.bannerContainer}>
              {banners.map((banner) => (
                <Grid
                  item
                  xs={6}
                  sm={4}
                  key={banner.id}
                  className={classes.bannerGridItem}
                >
                  <BannerCard banner={banner} />
                </Grid>
              ))}
            </Grid>
          )}
        </Grid>
      </Grid>
    </Container>
  );
}
