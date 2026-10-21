import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MyLocation, NearMe } from "@mui/icons-material";
import BannerWall from "./BannerWall";
import { loadCachedNearbyLocation, saveCachedNearbyLocation } from "./BannersNearMe";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import {
  getPlaceHierarchy,
  getPlaceLongName,
  readCachedCity,
  resolveCityAt,
} from "../cityPlace";

const LOCATION_OPTIONS = { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 8000 };
const SCOPE_CACHE_KEY = "openbanners-scope-places";

export function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        saveCachedNearbyLocation(location);
        resolve(location);
      },
      reject,
      LOCATION_OPTIONS
    );
  });
}

export async function getLocationPermission() {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return "unsupported";
  }

  try {
    return (await navigator.permissions?.query?.({ name: "geolocation" }))?.state ?? "prompt";
  } catch {
    return "prompt";
  }
}

function readScopeCache() {
  try {
    return JSON.parse(window.sessionStorage.getItem(SCOPE_CACHE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeScopeCache(value) {
  try {
    window.sessionStorage.setItem(SCOPE_CACHE_KEY, JSON.stringify(value));
  } catch {}
}

// Where the Banners tab can look: near you (if location works) and the city,
// province and country of where you are (or of your last city).
export function useScopePlaces() {
  const [state, setState] = useState(
    () =>
      readScopeCache() ?? {
        permission: "checking",
        places: null,
      }
  );

  const refresh = async ({ askLocation = false } = {}) => {
    let permission = await getLocationPermission();
    let location = loadCachedNearbyLocation();

    if (!location && (permission === "granted" || askLocation)) {
      location = await getPosition().catch(() => null);
      permission = location ? "granted" : await getLocationPermission();
    }

    let city = null;

    if (location) {
      city = await resolveCityAt(location, null, { ignorePicked: true }).catch(() => null);
    }

    city = city ?? readCachedCity()?.place ?? null;
    const places = city?.id
      ? await getPlaceHierarchy(city.id).catch(() => ({ country: null, region: null, city }))
      : { country: null, region: null, city: null };
    const next = { permission: location ? "granted" : permission, places };
    writeScopeCache(next);
    setState(next);
    return next;
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, refresh };
}

// "/" picks the first scope: near you, else your last city, else all countries.
export function BannersStart() {
  const navigate = useNavigate();

  useEffect(() => {
    let ignore = false;
    const city = readCachedCity()?.place;

    getLocationPermission().then((permission) => {
      if (ignore) {
        return;
      }

      if (loadCachedNearbyLocation() || permission === "granted") {
        navigate("/near", { replace: true });
      } else {
        navigate(city?.id ? `/browse/${encodeURIComponent(city.id)}` : "/browse/", {
          replace: true,
        });
      }
    });

    return () => {
      ignore = true;
    };
  }, [navigate]);

  return (
    <div className="ob-page">
      <BannerWall banners={[]} skeletonCount={8} label="Loading banners" />
    </div>
  );
}

// Segmented chips pinned above the bottom nav: Near · City · Province · Country · All.
export default function BannersScopeBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { permission, places, refresh } = useScopePlaces();
  const [locating, setLocating] = useState(false);
  const decodedPath = decodeURIComponent(pathname);
  const chips = [
    places?.city && { key: "city", label: getPlaceLongName(places.city), place: places.city },
    places?.region && { key: "region", label: getPlaceLongName(places.region), place: places.region },
    places?.country && { key: "country", label: getPlaceLongName(places.country), place: places.country },
  ].filter(Boolean);
  const canNear = permission === "granted";
  const canAsk = !canNear && permission !== "denied" && permission !== "unsupported";

  const useMyLocation = async () => {
    setLocating(true);
    const next = await refresh({ askLocation: true });
    setLocating(false);

    if (next.permission === "granted") {
      navigate("/near");
    }
  };

  return (
    <nav className="scope-bar" aria-label="Banner scope">
      <div className="scope-chips">
        {canNear ? (
          <Link
            className="chip sl"
            to="/near"
            aria-current={pathname === "/near" ? "page" : undefined}
          >
            <NearMe fontSize="small" />
            Near
          </Link>
        ) : canAsk ? (
          <button
            type="button"
            className="chip sl"
            onClick={useMyLocation}
            disabled={locating}
            aria-label="Use my location"
            title="Use my location"
          >
            <MyLocation fontSize="small" />
            {locating ? "…" : "Near"}
          </button>
        ) : null}
        {chips.map((chip) => {
          const to = `/browse/${encodeURIComponent(chip.place.id)}`;

          return (
            <Link
              key={chip.key}
              className="chip sl"
              to={to}
              aria-current={decodedPath === `/browse/${chip.place.id}` ? "page" : undefined}
              onClick={() => resetBrowseState(getBrowseStateScope({ placeId: chip.place.id }))}
            >
              {chip.label}
            </Link>
          );
        })}
        <Link
          className="chip sl"
          to="/browse/"
          aria-current={pathname === "/browse/" || pathname === "/browse" ? "page" : undefined}
          onClick={() => resetBrowseState(getBrowseStateScope())}
        >
          All
        </Link>
      </div>
    </nav>
  );
}
