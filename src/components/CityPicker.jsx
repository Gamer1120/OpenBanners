import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { Close, LocationCity, Place } from "@mui/icons-material";
import { getPlaceName, searchPlaces } from "../cityPlace";
import { getFlagForPlace } from "./CountryFlags";

export default function CityPicker({ open, onClose, onPick, title = "Pick your city" }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPlaces([]);
      setStatus("idle");
    }
  }, [open]);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      setPlaces([]);
      setStatus("idle");
      return undefined;
    }

    let ignore = false;
    const timeoutId = window.setTimeout(async () => {
      setStatus("loading");

      try {
        const results = await searchPlaces(trimmedQuery);

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
  }, [query]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="city-picker-title">
      <DialogTitle id="city-picker-title" sx={{ pr: 6 }}>
        {title}
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <div className="searchbar" style={{ marginBottom: 8 }}>
          <input
            type="search"
            autoFocus
            autoComplete="off"
            placeholder="e.g. Enschede"
            aria-label="City"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {status === "idle" ? (
          <p className="small muted">Type at least 2 letters.</p>
        ) : null}
        {status === "loading" ? <p className="small muted">Searching…</p> : null}
        {status === "error" ? (
          <p className="small muted">Places are unavailable right now.</p>
        ) : null}
        {status === "done" && places.length === 0 ? (
          <p className="small muted">No places match “{query.trim()}”.</p>
        ) : null}
        <ul className="ob-list" aria-label="Cities">
          {places.map((place) => {
            const flag = place.type === "country" ? getFlagForPlace(place.formattedAddress) : "";

            return (
              <li key={place.id}>
                <button type="button" className="li sl" onClick={() => onPick(place)}>
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
                      {Number.isFinite(place.numberOfBanners)
                        ? ` · ${place.numberOfBanners} banners`
                        : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
