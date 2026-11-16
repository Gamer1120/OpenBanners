import { useSyncExternalStore } from "react";
import { t, tk } from "./i18n";

// The map layers every map on the site offers (2026-11-16, Michael: the
// default map is difficult to see sometimes). One choice for all maps,
// remembered in localStorage on this device (not a synced setting). Without a
// choice each map keeps its own default: "dark" (OpenStreetMap darkened by the
// .ob-tiles-dark CSS filter) inside the app, "osm" on the BannerGuider pages.
// Free tiles without a key; a new tile host must also go into the CSP
// (docker/openbanners-security-headers.conf, img-src) on the VPS.
export const MAP_LAYER_STORAGE_KEY = "openbanners-map-layer";

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const osmAttribution = () =>
  t("© {osm} contributors", {
    osm: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

// A fixed tile for the previews in the menu (central Amsterdam, zoom 15).
const PREVIEW = { z: 15, x: 16829, y: 10771 };
const fillTile = (url, { z, x, y }, s = "a") =>
  url.replace("{s}", s).replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{r}", "");

export const MAP_LAYERS = [
  {
    id: "dark",
    label: tk("Dark"),
    url: OSM_URL,
    className: "ob-tiles-dark",
    attribution: osmAttribution,
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    url: OSM_URL,
    attribution: osmAttribution,
  },
  // Esri's keyless basemap tiles, credited with "Powered by Esri" and the
  // service's own copyrightText (…/MapServer?f=json). CARTO's basemaps were
  // the first idea for a clear street map, but since 2026 they answer every
  // tile without an API key with an "API KEY REQUIRED" picture.
  {
    id: "streets",
    label: tk("Streets"),
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: () =>
      'Powered by <a href="https://www.esri.com">Esri</a> | Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, © OpenStreetMap contributors, and the GIS User Community',
  },
  {
    id: "satellite",
    label: tk("Satellite"),
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: () =>
      'Powered by <a href="https://www.esri.com">Esri</a> | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  },
];

export const DEFAULT_MAP_LAYER = "dark";

export function getMapLayer(id) {
  return MAP_LAYERS.find((layer) => layer.id === id) ?? MAP_LAYERS[0];
}

export function getMapLayerPreview(layer) {
  return fillTile(layer.url, PREVIEW);
}

const isKnown = (id) => MAP_LAYERS.some((layer) => layer.id === id);
const listeners = new Set();
let memoryChoice = null;

export function readMapLayerChoice() {
  try {
    const stored = window.localStorage.getItem(MAP_LAYER_STORAGE_KEY);
    return isKnown(stored) ? stored : null;
  } catch {
    // Storage blocked: the choice lives in memory for this visit.
    return memoryChoice;
  }
}

export function setMapLayerChoice(id) {
  if (!isKnown(id)) {
    return;
  }
  memoryChoice = id;
  try {
    window.localStorage.setItem(MAP_LAYER_STORAGE_KEY, id);
  } catch {
    // Storage full or blocked: memoryChoice keeps it for this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === null || event.key === MAP_LAYER_STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// The layer a map shows: the visitor's choice, else the map's own default.
export function useMapLayer(defaultId = DEFAULT_MAP_LAYER) {
  const choice = useSyncExternalStore(subscribe, readMapLayerChoice, () => null);
  return getMapLayer(choice ?? defaultId);
}
