import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LocationCity, Place } from "@mui/icons-material";
import BrowseBannerList from "./BrowseBannerList";
import { getFlagForPlace } from "./CountryFlags";
import { rankPlacesForQuery } from "../cityPlace";
import { t } from "../i18n";
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
// Filters are saved per query and Back brings back the ones you picked; while
// typing they stay as they are for the next query.
function SearchBanners({ query, onStatusChange }) {
  const scope = getBrowseStateScope({ query });
  const { entryKey, navigationType } = useRestoredEntry(scope);
  const [bannerFilters, setBannerFilters] = useState(
    () =>
      (navigationType === "POP" && readHistoryEntryCache(entryKey, scope)?.filters) ||
      readBrowseFilters(scope)
  );

  useEffect(() => {
    saveBrowseFilters(scope, bannerFilters);
  }, [scope, bannerFilters]);

  const handleFiltersChange = (nextFilters) => {
    setBannerFilters((currentFilters) =>
      typeof nextFilters === "function" ? nextFilters(currentFilters) : nextFilters
    );
  };

  return (
    <BrowseBannerList
      query={query}
      bannerFilters={bannerFilters}
      onBannerFiltersChange={handleFiltersChange}
      heading={t("Banners")}
      label={t("Matching banners")}
      onStatusChange={onStatusChange}
      liveQuery
    />
  );
}

// Places and banners for a query. The query changes while you type: the old
// results stay until the new ones are in, and late answers are dropped.
export default function SearchResults({ query: queryProp }) {
  const params = useParams();
  const query = queryProp ?? params.query;
  // Back to the results shows them again without a new search.
  const { entryKey, restored } = useRestoredEntry("search");
  const restoredRef = useRef(restored?.query === query ? restored : null);
  const [results, setResults] = useState(restoredRef.current?.results ?? []);
  const [placesLoading, setPlacesLoading] = useState(!restoredRef.current);
  // The query the shown places belong to (they stay while the next load).
  const [placesQuery, setPlacesQuery] = useState(restoredRef.current ? query : null);
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

    const controller = new AbortController();

    const fetchPlaces = async () => {
      setPlacesLoading(true);
      setPlacesError("");

      try {
        const response = await fetch(
          `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
            query
          )}&limit=100&offset=0`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (controller.signal.aborted) {
          return;
        }

        if (Array.isArray(data)) {
          setResults(rankPlacesForQuery(data, query));
          setPlacesQuery(query);
        } else {
          setResults([]);
          setPlacesError(t("Place results returned an unexpected response."));
        }
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        console.error("Error fetching place results:", fetchError);
        setResults([]);
        setPlacesError(t("Couldn't load matching places."));
      }

      setPlacesLoading(false);
    };

    fetchPlaces();

    return () => {
      controller.abort();
    };
  }, [query, reloadToken]);

  const reloadSearch = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  useRememberEntry(
    entryKey,
    "search",
    !placesLoading && !placesError && placesQuery === query ? { query, results } : null
  );
  const noResults =
    !placesLoading &&
    !placesError &&
    results.length === 0 &&
    bannersStatus.ready &&
    !bannersStatus.error &&
    bannersStatus.count === 0;

  return (
    <>

      <section aria-labelledby="search-places">
        <div className="cloud-head">
          <h2 id="search-places">{t("Places")}</h2>
        </div>
        {placesError ? (
          <div className="ob-alert bad" role="alert">
            <div className="grow">{placesError}</div>
            <button type="button" className="btn text sl" onClick={reloadSearch}>
              {t("Retry")}
            </button>
          </div>
        ) : placesLoading && results.length === 0 ? (
          <p className="small muted">{t("Loading places...")}</p>
        ) : results.length > 0 ? (
          <ul className="cloud" aria-busy={placesLoading || undefined}>
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
          <p className="small muted">{t("No matching places found.")}</p>
        )}
      </section>

      <SearchBanners query={query} onStatusChange={handleBannersStatus} />

      {noResults ? <div className="ob-alert">{t("No results found for \"{query}\".", { query })}</div> : null}
    </>
  );
}
