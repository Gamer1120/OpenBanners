import React, { useEffect, useState } from "react";
import { Alert, Box, Typography } from "@mui/material";
import { Link, useParams } from "react-router-dom";
import { getFlagForPlace } from "./CountryFlags";

const COUNTRY_PLACES_CACHE_KEY = "openbanners-country-places-v1";
const COUNTRY_PLACES_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readCountryPlacesCache() {
  try {
    const cachedValue = window.localStorage.getItem(COUNTRY_PLACES_CACHE_KEY);

    if (!cachedValue) {
      return null;
    }

    const parsedCache = JSON.parse(cachedValue);

    if (
      !parsedCache ||
      !Array.isArray(parsedCache.places) ||
      typeof parsedCache.cachedAt !== "number"
    ) {
      window.localStorage.removeItem(COUNTRY_PLACES_CACHE_KEY);
      return null;
    }

    if (Date.now() - parsedCache.cachedAt > COUNTRY_PLACES_CACHE_TTL_MS) {
      window.localStorage.removeItem(COUNTRY_PLACES_CACHE_KEY);
      return null;
    }

    return parsedCache.places;
  } catch (error) {
    console.error("Error reading country places cache:", error);
    window.localStorage.removeItem(COUNTRY_PLACES_CACHE_KEY);
    return null;
  }
}

function writeCountryPlacesCache(places) {
  try {
    window.localStorage.setItem(
      COUNTRY_PLACES_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        places,
      })
    );
  } catch (error) {
    console.error("Error writing country places cache:", error);
  }
}

export default function PlacesList({ parentPlaceId }) {
  const { placeId: routePlaceId } = useParams();
  const placeId = parentPlaceId ?? routePlaceId;
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    const fetchPlaces = async () => {
      setLoading(true);
      setError("");

      try {
        if (!placeId) {
          const cachedPlaces = readCountryPlacesCache();

          if (cachedPlaces) {
            if (!ignore) {
              setPlaces(cachedPlaces);
              setLoading(false);
            }
            return;
          }
        }

        let url = "https://api.bannergress.com/places?used=true";

        if (placeId) {
          url += `&parentPlaceId=${placeId}`;
        } else {
          url += "&type=country";
        }

        const response = await fetch(url);
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setPlaces(data);

            if (!placeId) {
              writeCountryPlacesCache(data);
            }
          } else {
            setPlaces([]);
            setError("Couldn't load places.");
          }
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setPlaces([]);
          setError("Couldn't load places.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchPlaces();

    return () => {
      ignore = true;
    };
  }, [placeId]);

  return (
    <Box sx={{ mr: 2, minWidth: 150 }}>
      {loading && (
        <Typography variant="body2" color="text.secondary">
          Loading places...
        </Typography>
      )}

      {!loading && error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && places.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No places available.
        </Typography>
      )}

      {places.map((place) => {
        const flag = getFlagForPlace(place.formattedAddress);

        return (
          <Box key={place.id} sx={{ mb: 0.2, textAlign: "left" }}>
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
