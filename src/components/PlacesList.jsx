import React, { useState, useEffect } from "react";
import { Box } from "@mui/material";
import { Link, useParams } from "react-router-dom";
import { getFlagForPlace } from "./CountryFlags";

export default function PlacesList() {
  const { placeId } = useParams();
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        let url = "https://api.bannergress.com/places?used=true";
        if (placeId) {
          url += `&parentPlaceId=${placeId}`;
        } else {
          url += "&type=country";
        }

        const response = await fetch(url);
        const data = await response.json();
        setPlaces(data);
      } catch (error) {
        console.error(error);
      }
    };

    fetchPlaces();
  }, [placeId]);

  const handleClick = (placeId) => {
    // Handle the click event here
  };

  return (
    <Box sx={{ mr: 2, minWidth: 150 }}>
      {places.map((place) => {
        const flag = getFlagForPlace(place.formattedAddress);

        return (
          <Box
            key={place.id}
            sx={{ mb: 0.2, cursor: "pointer", textAlign: "left" }}
            onClick={() => handleClick(place.id)}
          >
          <Link
            to={`/browse/${place.id}`}
            style={{
              textDecoration: "none",
              color: "#fff",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 18,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "1.4em",
                textAlign: "center",
                lineHeight: 1,
                fontFamily:
                  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
              }}
            >
              {flag || " "}
            </span>
            <span>
              {place.formattedAddress} ({place.numberOfBanners})
            </span>
          </Link>
          </Box>
        );
      })}
    </Box>
  );
}
