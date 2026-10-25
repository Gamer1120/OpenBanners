import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LocationCity, Place } from "@mui/icons-material";
import { getFlagForPlace } from "./CountryFlags";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import { getLanguage, t, tn } from "../i18n";

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
          setError(t("Couldn't load places."));
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setPlaces([]);
          setError(t("Couldn't load places."));
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
// folded to a few rows (five for countries/provinces, three further down)
// with a filter field and "Show all N".
export default function PlaceCloud({
  places,
  loading,
  error,
  isCountryList,
  heading,
  rows = 5,
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const cloudRef = useRef(null);
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
  const folded = !normalizedFilter && !expanded;
  // Fold only when the chips really need more rows than shown.
  const foldable = !normalizedFilter && (expanded || overflows);

  useLayoutEffect(() => {
    const cloud = cloudRef.current;

    if (!cloud || !folded) {
      return undefined;
    }

    const check = () => setOverflows(cloud.scrollHeight > cloud.clientHeight + 1);
    check();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(check);
    observer.observe(cloud);
    return () => observer.disconnect();
  }, [folded, visiblePlaces.length, rows]);

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
            placeholder={isCountryList ? t("Find a country") : t("Find a place")}
            aria-label={isCountryList ? t("Find a country") : t("Find a place")}
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
          />
        ) : null}
      </div>
      {loading ? <p className="small muted">{t("Loading places...")}</p> : null}
      {error ? (
        <div className="ob-alert bad" role="alert">
          {error}
        </div>
      ) : null}
      <ul
        ref={cloudRef}
        className={`cloud${folded ? " folded" : ""}${folded && overflows ? " fade" : ""}`}
        style={{ "--cloud-rows": rows }}
      >
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
                  {Number(place.numberOfBanners || 0).toLocaleString(getLanguage())}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {normalizedFilter && visiblePlaces.length === 0 ? (
        <p className="small muted">
          {isCountryList
            ? t("No countries match “{filter}”.", { filter: filterText.trim() })
            : t("No places match “{filter}”.", { filter: filterText.trim() })}
        </p>
      ) : null}
      {foldable ? (
        <div className="cloud-more">
          <button type="button" className="btn text sl" onClick={() => setExpanded(!expanded)}>
            {expanded
              ? t("Show fewer")
              : isCountryList
                ? tn("Show all {count} country", "Show all {count} countries", sortedPlaces.length)
                : tn("Show all {count} place", "Show all {count} places", sortedPlaces.length)}
          </button>
        </div>
      ) : null}
    </section>
  );
}
