import { useEffect, useState } from "react";
import { loadCachedNearbyLocation, saveCachedNearbyLocation } from "./BannersNearMe";
import {
  getPlaceHierarchy,
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

// The city, province and country of where you are (or of your last city).
// Banner Together lists these as its places.
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
