import React, { useState } from "react";
import { Link } from "react-router-dom";
import { History } from "@mui/icons-material";
import SearchForm from "./SearchForm";
import { clearRecentSearches, useRecentSearches } from "../recentSearches";

// Search tab: one big field (focused), suggestions while typing, recent searches
// while it is empty. Enter opens the full results at /search/<query>.
export default function SearchPage() {
  const recent = useRecentSearches();
  const [value, setValue] = useState("");

  return (
    <div className="ob-page search-page">
      <h1 className="ob-h1">Search</h1>
      <SearchForm
        big
        autoFocus
        keepOpen
        placeholder="Banners, cities or regions"
        onValueChange={setValue}
      />
      {value.trim() === "" ? (
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
                  <Link className="li sl" to={`/search/${encodeURIComponent(entry)}`}>
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
            Type a banner title, a city or a region. Suggestions show up as you type.
          </p>
        )
      ) : null}
    </div>
  );
}
