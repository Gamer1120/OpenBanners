import { getDistanceMeters } from "./bannerDisplay";

const CITY_STORAGE_KEY = "openbanners-home-city";
const CITY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const API = "https://api.bannergress.com";

function slimPlace(place) {
  return place
    ? {
        id: place.id,
        longName: place.longName,
        shortName: place.shortName,
        formattedAddress: place.formattedAddress,
        numberOfBanners: place.numberOfBanners,
        type: place.type,
      }
    : null;
}

export function getPlaceName(place) {
  return place?.shortName || place?.longName || place?.formattedAddress || "";
}

export function readCachedCity() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CITY_STORAGE_KEY) ?? "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeCachedCity(value) {
  try {
    window.localStorage.setItem(
      CITY_STORAGE_KEY,
      JSON.stringify({ ...value, savedAt: Date.now() })
    );
  } catch {}
}

export function savePickedCity(place) {
  writeCachedCity({ picked: true, place: slimPlace(place) });
}

export function clearCachedCity() {
  try {
    window.localStorage.removeItem(CITY_STORAGE_KEY);
  } catch {}
}

function isInsidePlace(place, latitude, longitude, margin = 0.02) {
  return (
    place &&
    Number.isFinite(place.boundaryMinLatitude) &&
    latitude >= place.boundaryMinLatitude - margin &&
    latitude <= place.boundaryMaxLatitude + margin &&
    longitude >= place.boundaryMinLongitude - margin &&
    longitude <= place.boundaryMaxLongitude + margin
  );
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

async function fetchPlace(placeId) {
  return fetchJson(`${API}/places/${encodeURIComponent(placeId)}`);
}

// City of the user = locality of the nearest banners' start place (Bannergress
// already knows it, no reverse geocoder needed). Cached per ~2 km and day.
export async function resolveCityAt(location, nearbyBanners = null) {
  const { latitude, longitude } = location;
  const cached = readCachedCity();

  if (cached?.picked && cached.place) {
    return cached.place;
  }

  if (
    cached &&
    Date.now() - cached.savedAt < CITY_MAX_AGE_MS &&
    getDistanceMeters(cached, location) !== null &&
    getDistanceMeters(cached, location) < 2000
  ) {
    return cached.place;
  }

  const banners = Array.isArray(nearbyBanners)
    ? nearbyBanners
    : await fetchJson(
        `${API}/bnrs?orderBy=proximityStartPoint&orderDirection=ASC&proximityLatitude=${latitude}&proximityLongitude=${longitude}&limit=5&offset=0`
      );
  const placeIds = [
    ...new Set(banners.slice(0, 5).map((banner) => banner?.startPlaceId).filter(Boolean)),
  ];
  let city = null;

  for (const placeId of placeIds) {
    const place = await fetchPlace(placeId).catch(() => null);
    let candidate = place;

    while (candidate && candidate.type !== "locality" && candidate.parentPlace) {
      candidate = candidate.parentPlace;
    }

    if (
      candidate &&
      candidate.type === "locality" &&
      isInsidePlace(candidate, latitude, longitude)
    ) {
      city =
        candidate.numberOfBanners !== undefined
          ? candidate
          : await fetchPlace(candidate.id).catch(() => candidate);
      break;
    }
  }

  writeCachedCity({ latitude, longitude, place: slimPlace(city) });
  return slimPlace(city);
}

export async function searchPlaces(query, limit = 12) {
  const places = await fetchJson(
    `${API}/places?used=true&collapsePlaces=true&query=${encodeURIComponent(query)}&limit=${limit}`
  );

  return Array.isArray(places)
    ? [...places].sort(
        (a, b) => Number(b.type === "locality") - Number(a.type === "locality")
      )
    : [];
}
