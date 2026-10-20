import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LocationCity, Place } from "@mui/icons-material";
import { getFlagForPlace } from "./CountryFlags";
import { getBrowseStateScope, resetBrowseState } from "../browseState";

const COUNTRY_PLACES_CACHE_KEY = "openbanners-country-places-v1";
const COUNTRY_PLACES_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readCountryPlacesCache() {
  try {
    const parsedCache = JSON.parse(
      window.localStorage.getItem(COUNTRY_PLACES_CACHE_KEY) ?? "null"
    );

    if (
      parsedCache &&
      Array.isArray(parsedCache.places) &&
      typeof parsedCache.cachedAt === "number" &&
      Date.now() - parsedCache.cachedAt <= COUNTRY_PLACES_CACHE_TTL_MS
    ) {
      return parsedCache.places;
    }
  } catch {}

  return null;
}

function writeCountryPlacesCache(places) {
  try {
    window.localStorage.setItem(
      COUNTRY_PLACES_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), places })
    );
  } catch {}
}

export function getChipName(place, isCountryList) {
  if (isCountryList) {
    return place?.formattedAddress || place?.longName || place?.shortName || "";
  }

  return place?.longName || place?.shortName || place?.formattedAddress || "";
}

export function usePlaces(parentPlaceId, enabled = true) {
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setPlaces([]);
      setLoading(false);
      return undefined;
    }

    let ignore = false;

    const fetchPlaces = async () => {
      setLoading(true);
      setError("");

      if (!parentPlaceId) {
        const cachedPlaces = readCountryPlacesCache();

        if (cachedPlaces) {
          setPlaces(cachedPlaces);
          setLoading(false);
          return;
        }
      }

      try {
        const url = parentPlaceId
          ? `https://api.bannergress.com/places?used=true&parentPlaceId=${encodeURIComponent(parentPlaceId)}`
          : "https://api.bannergress.com/places?used=true&type=country";
        const response = await fetch(url);
        const data = await response.json();

        if (ignore) {
          return;
        }

        if (Array.isArray(data)) {
          setPlaces(data);

          if (!parentPlaceId) {
            writeCountryPlacesCache(data);
          }
        } else {
          setPlaces([]);
          setError("Couldn't load places.");
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

    setPlaces([]);
    fetchPlaces();

    return () => {
      ignore = true;
    };
  }, [enabled, parentPlaceId]);

  return { places, loading, error };
}

// All places of one level as a compact chip cloud (flag · name · count),
// folded to five rows with a filter field and "Show all N".
export default function PlaceCloud({ places, loading, error, isCountryList, heading }) {
  const [expanded, setExpanded] = useState(false);
  const [filterText, setFilterText] = useState("");
  const sortedPlaces = useMemo(
    () =>
      [...places].sort(
        (a, b) => (Number(b.numberOfBanners) || 0) - (Number(a.numberOfBanners) || 0)
      ),
    [places]
  );
  const normalizedFilter = filterText.trim().toLowerCase();
  const visiblePlaces = normalizedFilter
    ? sortedPlaces.filter((place) =>
        `${place.formattedAddress ?? ""} ${place.longName ?? ""} ${place.shortName ?? ""}`
          .toLowerCase()
          .includes(normalizedFilter)
      )
    : sortedPlaces;
  const foldable = !normalizedFilter && sortedPlaces.length > 16;
  const noun = isCountryList ? "countries" : "places";

  useEffect(() => {
    setExpanded(false);
    setFilterText("");
  }, [places]);

  if (!loading && !error && places.length === 0) {
    return null;
  }

  return (
    <section aria-label={heading}>
      <div className="cloud-head">
        <h2>
          {heading} <span className="muted">{loading ? "" : places.length}</span>
        </h2>
        {places.length > 8 ? (
          <input
            className="cloud-filter"
            type="search"
            placeholder={isCountryList ? "Find a country" : "Find a place"}
            aria-label={isCountryList ? "Find a country" : "Find a place"}
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
          />
        ) : null}
      </div>
      {loading ? <p className="small muted">Loading places...</p> : null}
      {error ? (
        <div className="ob-alert bad" role="alert">
          {error}
        </div>
      ) : null}
      <ul className={`cloud${foldable && !expanded ? " folded" : ""}`}>
        {visiblePlaces.map((place) => {
          const name = getChipName(place, isCountryList);
          const flag = getFlagForPlace(place.formattedAddress);

          return (
            <li key={place.id}>
              <Link
                className="chip sl"
                to={`/browse/${encodeURIComponent(place.id)}`}
                aria-label={`${place.formattedAddress || name} (${place.numberOfBanners})`}
                onClick={() => resetBrowseState(getBrowseStateScope({ placeId: place.id }))}
              >
                {isCountryList || flag ? (
                  <span className="flag" aria-hidden="true">
                    {flag || "🏳"}
                  </span>
                ) : place.type === "locality" ? (
                  <LocationCity fontSize="small" />
                ) : (
                  <Place fontSize="small" />
                )}
                {name}
                <span className="count">
                  {Number(place.numberOfBanners || 0).toLocaleString("en-US")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {normalizedFilter && visiblePlaces.length === 0 ? (
        <p className="small muted">No {noun} match “{filterText.trim()}”.</p>
      ) : null}
      {foldable ? (
        <div className="cloud-more">
          <button type="button" className="btn text sl" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show fewer" : `Show all ${sortedPlaces.length} ${noun}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
