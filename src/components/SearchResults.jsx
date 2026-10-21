import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LocationCity, Place } from "@mui/icons-material";
import BrowseBannerList from "./BrowseBannerList";
import SearchForm from "./SearchForm";
import { getFlagForPlace } from "./CountryFlags";
import { rankPlacesForQuery } from "../cityPlace";
import {
  getBrowseStateScope,
  readBrowseFilters,
  resetBrowseState,
  saveBrowseFilters,
} from "../browseState";
import {
  readHistoryEntryCache,
  useRememberEntry,
  useRestoredEntry,
} from "../scrollRestoration";

// The banners of a search, with Browse's sort, filters, Wall/List and paging.
// Filters belong to this query; Back brings back the ones you picked.
function SearchBanners({ query, onStatusChange }) {
  const scope = getBrowseStateScope({ query });
  const { entryKey, navigationType } = useRestoredEntry(scope);
  const [bannerFilters, setBannerFilters] = useState(
    () =>
      (navigationType === "POP" && readHistoryEntryCache(entryKey, scope)?.filters) ||
      readBrowseFilters(scope)
  );

  const handleFiltersChange = (nextFilters) => {
    setBannerFilters((currentFilters) => {
      const resolvedFilters =
        typeof nextFilters === "function" ? nextFilters(currentFilters) : nextFilters;

      saveBrowseFilters(scope, resolvedFilters);
      return resolvedFilters;
    });
  };

  return (
    <BrowseBannerList
      query={query}
      bannerFilters={bannerFilters}
      onBannerFiltersChange={handleFiltersChange}
      heading="Banners"
      label="Matching banners"
      onStatusChange={onStatusChange}
    />
  );
}

export default function SearchResults() {
  const { query } = useParams();
  // Back to the results shows them again without a new search.
  const { entryKey, restored } = useRestoredEntry("search");
  const restoredRef = useRef(restored?.query === query ? restored : null);
  const [results, setResults] = useState(restoredRef.current?.results ?? []);
  const [placesLoading, setPlacesLoading] = useState(!restoredRef.current);
  const [placesError, setPlacesError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [bannersStatus, setBannersStatus] = useState({ ready: false, error: false, count: 0 });
  const handleBannersStatus = useCallback((status) => {
    setBannersStatus((current) =>
      current.ready === status.ready &&
      current.error === status.error &&
      current.count === status.count
        ? current
        : status
    );
  }, []);
  useEffect(() => {
    if (restoredRef.current) {
      restoredRef.current = null;
      return undefined;
    }

    let ignore = false;

    const fetchPlaces = async () => {
      setPlacesLoading(true);
      setPlacesError("");

      try {
        const response = await fetch(
          `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
            query
          )}&limit=100&offset=0`
        );
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setResults(rankPlacesForQuery(data, query));
          } else {
            setResults([]);
            setPlacesError("Place results returned an unexpected response.");
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching place results:", fetchError);
          setResults([]);
          setPlacesError("Couldn't load matching places.");
        }
      } finally {
        if (!ignore) {
          setPlacesLoading(false);
        }
      }
    };

    fetchPlaces();

    return () => {
      ignore = true;
    };
  }, [query, reloadToken]);

  const reloadSearch = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  useRememberEntry(
    entryKey,
    "search",
    !placesLoading && !placesError ? { query, results } : null
  );
  const noResults =
    !placesLoading &&
    !placesError &&
    results.length === 0 &&
    bannersStatus.ready &&
    !bannersStatus.error &&
    bannersStatus.count === 0;

  return (
    <div className="ob-page">
      <header className="search-head">
        <SearchForm placeholder="Banners, cities or regions" />
        <h1 className="ob-h1">Search: {query}</h1>
      </header>

      <section aria-labelledby="search-places">
        <div className="cloud-head">
          <h2 id="search-places">Places</h2>
        </div>
        {placesError ? (
          <div className="ob-alert bad" role="alert">
            <div className="grow">{placesError}</div>
            <button type="button" className="btn text sl" onClick={reloadSearch}>
              Retry
            </button>
          </div>
        ) : placesLoading ? (
          <p className="small muted">Loading places...</p>
        ) : results.length > 0 ? (
          <ul className="cloud">
            {results.map((result) => {
              const flag = result.type === "country" ? getFlagForPlace(result.formattedAddress) : "";

              return (
                <li key={result.id}>
                  <Link
                    className="chip sl"
                    to={`/browse/${result.id}`}
                    aria-label={`${result.shortName} (${result.type}) (${result.numberOfBanners})`}
                    title={result.formattedAddress}
                    onClick={() => resetBrowseState(getBrowseStateScope({ placeId: result.id }))}
                  >
                    {flag ? (
                      <span className="flag" aria-hidden="true">
                        {flag}
                      </span>
                    ) : result.type === "locality" ? (
                      <LocationCity fontSize="small" />
                    ) : (
                      <Place fontSize="small" />
                    )}
                    {result.shortName}
                    <span className="count">{result.numberOfBanners}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small muted">No matching places found.</p>
        )}
      </section>

      <SearchBanners key={query} query={query} onStatusChange={handleBannersStatus} />

      {noResults ? <div className="ob-alert">No results found for "{query}".</div> : null}
    </div>
  );
}
