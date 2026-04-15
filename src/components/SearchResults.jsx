import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BannerCard from "./BannerCard";
import { Grid } from "@mui/material";

export default function SearchResults() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bannerData, setBannerData] = useState([]);
  const navigate = useNavigate();
  const { query } = useParams();

  useEffect(() => {
    let ignore = false;

    const fetchResults = async () => {
      setLoading(true);

      try {
        const [placesResponse, bannersResponse] = await Promise.all([
          fetch(
            `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
              query
            )}&limit=100&offset=0`
          ),
          fetch(
            `https://api.bannergress.com/bnrs?orderBy=relevance&orderDirection=DESC&online=true&query=${encodeURIComponent(
              query
            )}&limit=100&offset=0`
          ),
        ]);

        const [placesData, bannersData] = await Promise.all([
          placesResponse.json(),
          bannersResponse.json(),
        ]);

        if (!ignore) {
          setResults(placesData);
          setBannerData(bannersData);
        }
      } catch (error) {
        if (!ignore) {
          console.error("Error fetching search results:", error);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchResults();

    return () => {
      ignore = true;
    };
  }, [query]);

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
          <Grid container spacing={2} sx={{ mt: 2 }}>
            {bannerData.map((banner) => (
              <Grid
                item
                xs={6}
                sm={4}
                key={banner.id}
                sx={{ display: "flex", justifyContent: "center", alignItems: "stretch" }}
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
