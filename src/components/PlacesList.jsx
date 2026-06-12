import React, { useEffect, useState } from "react";
import { Alert, Box, Typography } from "@mui/material";
import { Link, useParams } from "react-router-dom";
import { getFlagForPlace } from "./CountryFlags";

const COUNTRY_PLACES_CACHE_KEY = "openbanners-country-places-v1";
const COUNTRY_PLACES_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const placeLinkStyle = {
  textDecoration: "none",
  color: "#fff",
  fontSize: 12,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 18,
};
const placeMarkerStyle = {
  display: "inline-block",
  width: "1.4em",
  textAlign: "center",
  lineHeight: 1,
  fontFamily:
    '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
};

function getPlaceLabel(place) {
  return (
    place?.longName ||
    place?.formattedAddress ||
    place?.shortName ||
    "All countries"
  );
}

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
  const [currentPlace, setCurrentPlace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!placeId) {
      setCurrentPlace(null);
      return undefined;
    }

    let ignore = false;
    setCurrentPlace(null);

    const fetchCurrentPlace = async () => {
      try {
        const response = await fetch(
          `https://api.bannergress.com/places/${encodeURIComponent(placeId)}`
        );
        const data = await response.json();

        if (!ignore && data && typeof data === "object" && data.id) {
          setCurrentPlace(data);
        } else if (!ignore) {
          setCurrentPlace(null);
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setCurrentPlace(null);
        }
      }
    };

    fetchCurrentPlace();

    return () => {
      ignore = true;
    };
  }, [placeId]);

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
      {placeId && (
        <Box sx={{ mb: 0.6, pb: 0.6, textAlign: "left" }}>
          <Link
            aria-label={
              currentPlace?.parentPlace
                ? `Up to ${getPlaceLabel(currentPlace.parentPlace)}`
                : "Up to all countries"
            }
            to={
              currentPlace?.parentPlace
                ? `/browse/${currentPlace.parentPlace.id}`
                : "/browse/"
            }
            style={placeLinkStyle}
          >
            <span aria-hidden="true" style={placeMarkerStyle}>
              ↑
            </span>
            <span>
              {currentPlace?.parentPlace
                ? getPlaceLabel(currentPlace.parentPlace)
                : "All countries"}
            </span>
          </Link>
        </Box>
      )}

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
              style={placeLinkStyle}
            >
              <span
                aria-hidden="true"
                style={placeMarkerStyle}
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
