import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Groups, LocationCity, Place } from "@mui/icons-material";
import { getPlaceLongName, readCachedCity, searchPlaces } from "../cityPlace";
import { getFlagForPlace } from "./CountryFlags";
import { useScopePlaces } from "./useScopePlaces";

function togetherPath(place) {
  return `/lists/together/${encodeURIComponent(place.id)}`;
}

function PlaceRow({ place }) {
  const flag = place.type === "country" ? getFlagForPlace(place.formattedAddress) : "";

  return (
    <li>
      <Link className="li sl" to={togetherPath(place)}>
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
          <span className="t">{getPlaceLongName(place)}</span>
          <span className="s">
            {place.formattedAddress}
            {Number.isFinite(place.numberOfBanners) ? ` · ${place.numberOfBanners} banners` : ""}
          </span>
        </span>
        <ChevronRight className="muted" />
      </Link>
    </li>
  );
}

// Lists → Banner Together: pick the place to compare To do / Done / Hidden in.
export default function BannerTogetherLauncher() {
  const [cachedCity] = useState(() => readCachedCity()?.place ?? null);
  const { places: scopePlaces } = useScopePlaces();
  // Same places as the Banners start page: country, province, city.
  const yourPlaces = (
    scopePlaces?.city || scopePlaces?.country
      ? [scopePlaces.country, scopePlaces.region, scopePlaces.city]
      : [cachedCity]
  ).filter((place, index, all) => place?.id && all.findIndex((other) => other?.id === place.id) === index);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState([]);
  const [status, setStatus] = useState("idle");
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setPlaces([]);
      setStatus("idle");
      return undefined;
    }

    let ignore = false;
    const timeoutId = window.setTimeout(async () => {
      setStatus("loading");

      try {
        const results = await searchPlaces(trimmed);

        if (!ignore) {
          setPlaces(results);
          setStatus("done");
        }
      } catch {
        if (!ignore) {
          setPlaces([]);
          setStatus("error");
        }
      }
    }, 300);

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
    };
  }, [trimmed]);

  return (
    <section className="bt-launch" aria-labelledby="bt-launch-title">
      <div className="card bt-intro">
        <span className="bt-ic" aria-hidden="true">
          <Groups />
        </span>
        <div className="grow">
          <h2 id="bt-launch-title">Banner Together</h2>
          <p className="small muted">
            Plan a banner day with friends. Start a live room for a place, share the
            invite link and compare everyone’s To do, Done and Hidden lists. Your lists
            stay private until you join.
          </p>
        </div>
      </div>

      {yourPlaces.length > 0 ? (
        <ul className="ob-list bt-places" aria-label="Your places">
          {yourPlaces.map((place) => (
            <PlaceRow key={place.id} place={place} />
          ))}
        </ul>
      ) : null}

      <div className="searchbar">
        <input
          type="search"
          autoComplete="off"
          placeholder="Search a city or region"
          aria-label="Place for Banner Together"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {status === "loading" ? <p className="small muted">Searching…</p> : null}
      {status === "error" ? (
        <p className="small muted">Places are unavailable right now.</p>
      ) : null}
      {status === "done" && places.length === 0 ? (
        <p className="small muted">No places match “{trimmed}”.</p>
      ) : null}
      {places.length > 0 ? (
        <ul className="ob-list bt-places" aria-label="Places">
          {places.map((place) => (
            <PlaceRow key={place.id} place={place} />
          ))}
        </ul>
      ) : null}
      <p className="small muted">Got an invite link? Just open it, it brings you to the room.</p>
    </section>
  );
}
