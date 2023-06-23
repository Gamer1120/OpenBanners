import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BannerCard from "./BannerCard";
import { makeStyles } from "@mui/styles";
import {
  useMediaQuery,
  Container,
  Grid,
  Typography,
  Button,
} from "@mui/material";

const useStyles = makeStyles((theme) => ({
  section: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
  },
  loadMoreButton: {
    marginTop: theme.spacing(2),
  },
}));

export default function SearchResults() {
  const classes = useStyles();

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bannerData, setBannerData] = useState([]);
  const navigate = useNavigate();
  const { query } = useParams();

  useEffect(() => {
    fetchSearchResults();
    fetchBannerData();
  }, [query]);

  const fetchSearchResults = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
          query
        )}&limit=100&offset=0`
      );
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error("Error fetching search results:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBannerData = async () => {
    try {
      const response = await fetch(
        `https://api.bannergress.com/bnrs?orderBy=relevance&orderDirection=DESC&online=true&query=${encodeURIComponent(
          query
        )}&limit=100&offset=0`
      );
      const data = await response.json();
      setBannerData(data);
    } catch (error) {
      console.error("Error fetching banner data:", error);
    }
  };

  const handleClick = (id) => {
    navigate(`/browse/${id}`);
  };

  return (
    <div>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          {results.map((result, index) => (
            <h3
              key={index}
              style={{ color: "white", cursor: "pointer" }}
              onClick={() => handleClick(result.id)}
            >
              {`${result.shortName} (${result.type}) (${result.numberOfBanners})`}
            </h3>
          ))}
          <hr />
          <Grid container spacing={2} className={classes.bannerContainer}>
            {bannerData.map((banner) => (
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
        </div>
      )}
    </div>
  );
}
