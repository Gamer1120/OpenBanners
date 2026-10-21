import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "@mui/icons-material";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { addRecentSearch } from "../recentSearches";

export const MIN_QUERY_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 300;
// A typed search counts for Recent searches once typing stops this long.
export const RECENT_SEARCH_IDLE_MS = 1500;

export function searchPath(query) {
  return query ? `/search/${encodeURIComponent(query)}` : "/search";
}

function isSearchPath(pathname) {
  return pathname === "/search" || pathname.startsWith("/search/");
}

// Live search field, no suggestions: the results page follows what you type.
// On /search the URL is replaced, so Back skips the keystrokes; typing
// anywhere else opens /search/<query>, where focus and caret stay put.
export default function SearchForm({
  big = false,
  className = "",
  placeholder = "Search banners or places",
  autoFocus = false,
  onValueChange,
}) {
  const { query } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef(null);
  const urlQuery = typeof query === "string" ? query.trim() : "";
  const [value, setValue] = useState(urlQuery);
  // The query this field last put in the URL: that URL change must not
  // overwrite what is being typed (e.g. a 1-letter prefix).
  const navigatedRef = useRef(urlQuery);
  const typedRef = useRef(Boolean(location.state?.focusSearch));
  const onSearchRoute = isSearchPath(location.pathname);
  const trimmed = value.trim();
  const isEmpty = trimmed === "";
  const target = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : "";

  // Back/forward or a Recent search link: show that query. Done in render so
  // the debounce below never sees the old text against the new URL.
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);

  if (urlQuery !== syncedUrlQuery) {
    setSyncedUrlQuery(urlQuery);

    if (urlQuery !== navigatedRef.current) {
      navigatedRef.current = urlQuery;
      typedRef.current = false;
      setValue(urlQuery);
    }
  }

  useEffect(() => {
    onValueChange?.(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const go = (nextQuery) => {
    navigatedRef.current = nextQuery;

    if (onSearchRoute) {
      navigate(searchPath(nextQuery), { replace: true });
    } else {
      navigate(searchPath(nextQuery), { state: { focusSearch: true } });
    }
  };

  useEffect(() => {
    if (target === urlQuery || (!target && !onSearchRoute)) {
      return undefined;
    }

    // Clearing the field shows Recent searches right away.
    if (isEmpty) {
      go("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => go(target), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, isEmpty, urlQuery, onSearchRoute]);

  useEffect(() => {
    if (!target || !typedRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => addRecentSearch(target), RECENT_SEARCH_IDLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [target]);

  // Focus without scrolling: Back restores the page's own scroll position.
  useLayoutEffect(() => {
    const input = inputRef.current;

    if (!input || !(autoFocus || location.state?.focusSearch)) {
      return;
    }

    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange?.(end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!target) {
      return;
    }

    addRecentSearch(target);

    if (target !== urlQuery || !onSearchRoute) {
      go(target);
    }

    // Phones: close the keyboard so the results are visible.
    if (window.matchMedia?.("(pointer: coarse)").matches) {
      inputRef.current?.blur();
    }
  };

  return (
    <div className={`search-wrap ${className}`.trim()}>
      <form
        className={`searchbar${big ? " big" : ""}`}
        role="search"
        aria-label="Search banners and places"
        onSubmit={handleSubmit}
      >
        <input
          ref={inputRef}
          type="search"
          placeholder={placeholder}
          aria-label="Search query"
          autoComplete="off"
          value={value}
          enterKeyHint="search"
          onChange={(event) => {
            typedRef.current = true;
            setValue(event.target.value);
          }}
        />
        <button type="submit" className="icon-btn sl" aria-label="Submit search">
          <Search />
        </button>
      </form>
    </div>
  );
}
