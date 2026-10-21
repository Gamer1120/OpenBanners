import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { History } from "@mui/icons-material";
import SearchForm, { MIN_QUERY_LENGTH, searchPath } from "./SearchForm";
import SearchResults from "./SearchResults";
import { addRecentSearch, clearRecentSearches, useRecentSearches } from "../recentSearches";

// Search tab (/search and /search/<query>): one field, and under it the full
// results, updating while you type. Recent searches while it is empty.
export default function SearchPage() {
  const { query } = useParams();
  const urlQuery = typeof query === "string" ? query.trim() : "";
  const recent = useRecentSearches();
  const [value, setValue] = useState(urlQuery);
  const typing = value.trim();

  // Opening a result counts as a finished search.
  const handleResultClick = (event) => {
    if (urlQuery && event.target instanceof Element && event.target.closest("a[href]")) {
      addRecentSearch(urlQuery);
    }
  };

  return (
    <div className={`ob-page search-page${urlQuery ? " has-results" : ""}`}>
      <h1 className="ob-h1">Search</h1>
      <SearchForm
        big
        autoFocus={!urlQuery}
        placeholder="Banners, cities or regions"
        onValueChange={setValue}
      />
      {urlQuery ? (
        <div className="search-results" onClick={handleResultClick}>
          <SearchResults query={urlQuery} />
        </div>
      ) : typing === "" ? (
        recent.length > 0 ? (
          <section aria-labelledby="recent-title">
            <div className="ob-sec-head">
              <h2 className="ob-h2" id="recent-title">
                Recent searches
              </h2>
              <button type="button" className="btn text sl" onClick={clearRecentSearches}>
                Clear
              </button>
            </div>
            <ul className="ob-list" aria-label="Recent searches">
              {recent.map((entry) => (
                <li key={entry}>
                  <Link className="li sl" to={searchPath(entry)}>
                    <span className="lead">
                      <History fontSize="small" />
                    </span>
                    <span className="txt">
                      <span className="t">{entry}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="small muted">
            Type a banner title, a city or a region. Results show up as you type.
          </p>
        )
      ) : typing.length < MIN_QUERY_LENGTH ? (
        <p className="small muted">Keep typing…</p>
      ) : (
        <p className="small muted">Searching…</p>
      )}
    </div>
  );
}
