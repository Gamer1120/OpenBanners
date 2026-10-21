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
export async function resolveCityAt(location, nearbyBanners = null, { ignorePicked = false } = {}) {
  const { latitude, longitude } = location;
  const cached = readCachedCity();

  if (cached?.picked && cached.place && !ignorePicked) {
    return cached.place;
  }

  if (
    cached &&
    !cached.picked &&
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

  // Never overwrite a city the user picked or browsed to.
  if (!cached?.picked) {
    writeCachedCity({ latitude, longitude, place: slimPlace(city) });
  }

  return slimPlace(city);
}

// Country / province (or region) / city above a place, for the start page buttons.
export async function getPlaceHierarchy(placeId) {
  const place = await fetchPlace(placeId);
  const chain = [];
  let current = place;

  while (current && chain.length < 10) {
    chain.push(current);
    current = current.parentPlace;
  }

  const city = chain.find((entry) => entry.type === "locality") ?? null;
  const country = chain.find((entry) => entry.type === "country") ?? chain[chain.length - 1] ?? null;
  const region =
    chain.find((entry) => entry.type === "administrative_area_level_1") ??
    chain.find((entry) => entry !== city && entry !== country) ??
    null;

  return {
    country: slimPlace(country),
    region: region && region !== country ? slimPlace(region) : null,
    city: city ? slimPlace(city) : null,
  };
}

export function getPlaceLongName(place) {
  return place?.longName || place?.shortName || place?.formattedAddress || "";
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getCountry(place) {
  const parts = String(place?.formattedAddress ?? "").split(",");
  return normalizeName(parts[parts.length - 1]).trim();
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

// How well a place matches what the user typed, judged only on the names we show:
// 0 = a name starts with it, 1 = a word in a name starts with it, 2 = somewhere
// inside a name, null = only matched a name we never display (the API also
// searches other languages and sub-places, which is how "Ens" finds Moscow).
export function getPlaceMatchRank(place, query) {
  const needle = normalizeName(query).trim();

  if (!needle) {
    return 0;
  }

  const names = [place?.shortName, place?.longName, place?.formattedAddress]
    .filter(Boolean)
    .map(normalizeName);

  if (names.some((name) => name.startsWith(needle))) {
    return 0;
  }

  if (names.some((name) => name.split(WORD_SPLIT).some((word) => word.startsWith(needle)))) {
    return 1;
  }

  return names.some((name) => name.includes(needle)) ? 2 : null;
}

// Sort API places for a typed query: best name match first, then the user's own
// country (from the remembered city), cities before regions, then banner count.
export function rankPlacesForQuery(places, query, { homeCountry = null } = {}) {
  if (!Array.isArray(places)) {
    return [];
  }

  const country =
    homeCountry ?? (typeof window !== "undefined" ? getCountry(readCachedCity()?.place) : "");

  const entries = places.map((place, index) => ({
    place,
    index,
    rank: getPlaceMatchRank(place, query),
  }));
  const shown = entries.filter((entry) => entry.rank !== null);

  // Nothing matches a shown name (e.g. "Moskau" for Moscow): keep the API's
  // own matches rather than showing nothing.
  return (shown.length > 0 ? shown : entries.map((entry) => ({ ...entry, rank: 3 })))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(Boolean(country) && getCountry(b.place) === country) -
          Number(Boolean(country) && getCountry(a.place) === country) ||
        Number(b.place.type === "locality") - Number(a.place.type === "locality") ||
        (Number(b.place.numberOfBanners) || 0) - (Number(a.place.numberOfBanners) || 0) ||
        a.index - b.index
    )
    .map((entry) => entry.place);
}

export async function searchPlaces(query, limit = 12) {
  // The API orders by banner count, so ask for extra candidates and re-rank.
  const places = await fetchJson(
    `${API}/places?used=true&collapsePlaces=true&query=${encodeURIComponent(query)}&limit=${Math.max(
      limit * 4,
      40
    )}`
  );

  return rankPlacesForQuery(places, query).slice(0, limit);
}
