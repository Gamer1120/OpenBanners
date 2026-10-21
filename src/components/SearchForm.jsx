import React, { useEffect, useId, useRef, useState } from "react";
import { LocationCity, Place, Search } from "@mui/icons-material";
import { useNavigate, useParams } from "react-router-dom";
import { getPlaceName, savePickedCity, searchPlaces } from "../cityPlace";
import BannerImage from "./BannerImage";
import { fetchBannergress, useBannergressSync } from "../bannergressSync";
import { isBannerHidden } from "../bannerFilters";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import { getFlagForPlace } from "./CountryFlags";
import { addRecentSearch } from "../recentSearches";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const PLACE_LIMIT = 5;
const BANNER_LIMIT = 6;
const BANNER_FETCH_LIMIT = 12; // room for banners on the Hidden list

async function searchBanners(query, signal) {
  const response = await fetchBannergress(
    `https://api.bannergress.com/bnrs?orderBy=relevance&orderDirection=DESC&online=true&query=${encodeURIComponent(
      query
    )}&limit=${BANNER_FETCH_LIMIT}&offset=0`,
    { signal }
  );

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

// Search-as-you-type: places (cities first) and banners, debounced. Enter on a
// highlighted suggestion opens it; otherwise Enter goes to the full results.
export default function SearchForm({
  big = false,
  className = "",
  placeholder = "Search banners or places",
  onSearch,
  autoFocus = false,
  onValueChange,
  // The Search tab is all about the suggestions: a tap elsewhere (or closing the
  // phone keyboard) keeps them; only Esc or picking one closes them.
  keepOpen = false,
}) {
  const { query } = useParams();
  const navigate = useNavigate();
  const listId = useId();
  const wrapRef = useRef(null);
  const [value, setValue] = useState(typeof query === "string" ? query : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("idle");
  const [places, setPlaces] = useState([]);
  const [banners, setBanners] = useState([]);

  useEffect(() => {
    setValue(typeof query === "string" ? query : "");
    setOpen(false);
  }, [query]);

  const trimmed = value.trim();

  useEffect(() => {
    setActive(-1);

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setPlaces([]);
      setBanners([]);
      setStatus("idle");
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setStatus("loading");

      const [placeResult, bannerResult] = await Promise.allSettled([
        searchPlaces(trimmed, PLACE_LIMIT),
        searchBanners(trimmed, controller.signal),
      ]);

      if (controller.signal.aborted) {
        return;
      }

      setPlaces(placeResult.status === "fulfilled" ? placeResult.value.slice(0, PLACE_LIMIT) : []);
      setBanners(bannerResult.status === "fulfilled" ? bannerResult.value : []);
      setStatus(
        placeResult.status === "rejected" && bannerResult.status === "rejected" ? "error" : "done"
      );
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [trimmed]);

  useEffect(() => {
    if (!open || keepOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, keepOpen]);

  const syncState = useBannergressSync();
  const items = [
    ...places.map((place) => ({ kind: "place", key: `p-${place.id}`, place })),
    ...banners
      .filter((banner) => !isBannerHidden(banner, syncState))
      .slice(0, BANNER_LIMIT)
      .map((banner) => ({ kind: "banner", key: `b-${banner.id}`, banner })),
  ];
  const showList = open && trimmed.length >= MIN_QUERY_LENGTH && status !== "idle";

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const pick = (item) => {
    close();
    addRecentSearch(trimmed);

    if (item.kind === "place") {
      savePickedCity(item.place);
      resetBrowseState(getBrowseStateScope({ placeId: item.place.id }));
      navigate(`/browse/${encodeURIComponent(item.place.id)}`);
      return;
    }

    navigate(`/banner/${encodeURIComponent(item.banner.id)}`);
  };

  const searchAll = () => {
    if (trimmed === "") {
      return;
    }

    close();
    addRecentSearch(trimmed);

    if (typeof onSearch === "function") {
      onSearch(trimmed);
      return;
    }

    navigate(`/search/${encodeURIComponent(trimmed)}`);
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (showList && active >= 0 && items[active]) {
      pick(items[active]);
      return;
    }

    searchAll();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      if (showList) {
        event.preventDefault();
        close();
      }
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();

    if (!showList) {
      setOpen(true);
      return;
    }

    if (items.length === 0) {
      return;
    }

    setActive((current) => {
      if (event.key === "ArrowDown") {
        return current >= items.length - 1 ? -1 : current + 1;
      }

      return current <= -1 ? items.length - 1 : current - 1;
    });
  };

  const optionId = (index) => `${listId}-opt-${index}`;
  const renderItem = (item, index) => {
    const selected = index === active;
    const common = {
      id: optionId(index),
      role: "option",
      "aria-selected": selected,
      className: `li sl${selected ? " on" : ""}`,
      onMouseDown: (event) => event.preventDefault(),
      onMouseEnter: () => setActive(index),
      onClick: () => pick(item),
    };

    if (item.kind === "place") {
      const { place } = item;
      const flag = place.type === "country" ? getFlagForPlace(place.formattedAddress) : "";

      return (
        <li key={item.key} {...common}>
          <span className="lead">
            {flag ? (
              <span className="flag">{flag}</span>
            ) : place.type === "locality" ? (
              <LocationCity fontSize="small" />
            ) : (
              <Place fontSize="small" />
            )}
          </span>
          <span className="txt">
            <span className="t">{getPlaceName(place)}</span>
            <span className="s">
              {place.formattedAddress}
              {Number.isFinite(place.numberOfBanners) ? ` · ${place.numberOfBanners} banners` : ""}
            </span>
          </span>
        </li>
      );
    }

    const { banner } = item;
    return (
      <li key={item.key} {...common}>
        <BannerImage banner={banner} mode="contain" className="sg-pic" />
        <span className="txt">
          <span className="t">{(banner.title || "Untitled").trim()}</span>
          <span className="s">
            {banner.numberOfMissions ?? "?"} missions
            {banner.formattedAddress ? ` · ${banner.formattedAddress}` : ""}
          </span>
        </span>
      </li>
    );
  };

  return (
    <div className={`search-wrap ${className}`.trim()} ref={wrapRef}>
      <form
        className={`searchbar${big ? " big" : ""}`}
        role="search"
        aria-label="Search banners and places"
        onSubmit={handleSubmit}
      >
        <input
          type="search"
          placeholder={placeholder}
          aria-label="Search query"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={value}
          enterKeyHint="search"
          autoFocus={autoFocus}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            onValueChange?.(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" className="icon-btn sl" aria-label="Submit search">
          <Search />
        </button>
      </form>
      {showList ? (
        <div className="sg-pop">
          {status === "loading" && items.length === 0 ? (
            <p className="sg-note small muted">Searching…</p>
          ) : null}
          {status === "error" ? (
            <p className="sg-note small muted">Search is unavailable right now.</p>
          ) : null}
          {status === "done" && items.length === 0 ? (
            <p className="sg-note small muted">Nothing matches “{trimmed}”.</p>
          ) : null}
          <ul className="sg-list" id={listId} role="listbox" aria-label="Suggestions">
            {items.map((item, index) => (
              <React.Fragment key={item.key}>
                {index === 0 && item.kind === "place" ? (
                  <li className="sg-head" role="presentation">
                    Places
                  </li>
                ) : null}
                {item.kind === "banner" && index === places.length ? (
                  <li className="sg-head" role="presentation">
                    Banners
                  </li>
                ) : null}
                {renderItem(item, index)}
              </React.Fragment>
            ))}
          </ul>
          {items.length > 0 ? (
            <button
              type="button"
              className="sg-all sl"
              onMouseDown={(event) => event.preventDefault()}
              onClick={searchAll}
            >
              <Search fontSize="small" />
              All results for “{trimmed}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
