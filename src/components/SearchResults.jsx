import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LocationCity, Place } from "@mui/icons-material";
import BannerWall, { BannerRows } from "./BannerWall";
import SearchForm from "./SearchForm";
import ViewModeToggle, { useBannerViewMode } from "./ViewModeToggle";
import { getFlagForPlace } from "./CountryFlags";
import { fetchBannergress } from "../bannergressSync";
import { rankPlacesForQuery } from "../cityPlace";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import { useRememberEntry, useRestoredEntry } from "../scrollRestoration";

export default function SearchResults() {
  const { query } = useParams();
  // Back to the results shows them again without a new search.
  const { entryKey, restored } = useRestoredEntry("search");
  const restoredRef = useRef(restored?.query === query ? restored : null);
  const [results, setResults] = useState(restoredRef.current?.results ?? []);
  const [bannerData, setBannerData] = useState(
    restoredRef.current?.bannerData ?? []
  );
  const [placesLoading, setPlacesLoading] = useState(false);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [bannersError, setBannersError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [viewMode, setViewMode] = useBannerViewMode();
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

    const fetchBanners = async () => {
      setBannersLoading(true);
      setBannersError("");

      try {
        const response = await fetchBannergress(
          `https://api.bannergress.com/bnrs?orderBy=relevance&orderDirection=DESC&online=true&query=${encodeURIComponent(
            query
          )}&limit=100&offset=0`
        );
        const data = await response.json();

        if (!ignore) {
          if (Array.isArray(data)) {
            setBannerData(data);
          } else {
            setBannerData([]);
            setBannersError("Banner results returned an unexpected response.");
          }
        }
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching banner results:", fetchError);
          setBannerData([]);
          setBannersError("Couldn't load matching banners.");
        }
      } finally {
        if (!ignore) {
          setBannersLoading(false);
        }
      }
    };

    fetchPlaces();
    fetchBanners();

    return () => {
      ignore = true;
    };
  }, [query, reloadToken]);

  const reloadSearch = () => {
    setReloadToken((currentValue) => currentValue + 1);
  };

  const finishedLoading = !placesLoading && !bannersLoading;

  useRememberEntry(
    entryKey,
    "search",
    finishedLoading && !placesError && !bannersError
      ? { query, results, bannerData }
      : null
  );
  const noResults =
    finishedLoading &&
    !placesError &&
    !bannersError &&
    results.length === 0 &&
    bannerData.length === 0;

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

      <section aria-labelledby="search-banners" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="toolbar">
          <h2 id="search-banners" className="ob-h2">
            Banners
          </h2>
          <span className="grow" />
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
        {bannersError ? (
          <div className="ob-alert bad" role="alert">
            <div className="grow">{bannersError}</div>
            <button type="button" className="btn text sl" onClick={reloadSearch}>
              Retry
            </button>
          </div>
        ) : bannersLoading ? (
          viewMode === "compact" ? (
            <BannerRows banners={[]} loadingMore label="Loading banners" />
          ) : (
            <BannerWall banners={[]} skeletonCount={8} label="Loading banners" />
          )
        ) : bannerData.length > 0 ? (
          viewMode === "compact" ? (
            <BannerRows banners={bannerData} label="Matching banners" />
          ) : (
            <BannerWall banners={bannerData} label="Matching banners" />
          )
        ) : (
          <p className="small muted">No matching banners found.</p>
        )}
      </section>

      {noResults ? <div className="ob-alert">No results found for "{query}".</div> : null}
    </div>
  );
}
