// Which discovery-map prototype /map shows. ?map=now|a|b|c|d|e wins over the stored
// choice; the switcher writes both.
export const MAP_VARIANTS = Object.freeze([
  { id: "now", label: "Now", title: "Current map" },
  { id: "a", label: "A", title: "Pictures" },
  { id: "b", label: "B", title: "List strip" },
  { id: "c", label: "C", title: "Route preview" },
  { id: "d", label: "D", title: "Filters" },
  { id: "e", label: "E", title: "Plan a day" },
]);
export const MAP_VARIANT_STORAGE_KEY = "openbanners.mapVariant";
// The test suite exercises the classic map through /map, so it keeps "now" there.
export const DEFAULT_MAP_VARIANT = import.meta.env?.MODE === "test" ? "now" : "a";

export function normalizeMapVariant(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MAP_VARIANTS.some((variant) => variant.id === id) ? id : null;
}

export function readMapVariant(search = "", storage = globalThis.localStorage, fallback = DEFAULT_MAP_VARIANT) {
  const fromQuery = normalizeMapVariant(new URLSearchParams(search).get("map"));

  if (fromQuery) {
    return fromQuery;
  }

  try {
    return normalizeMapVariant(storage?.getItem(MAP_VARIANT_STORAGE_KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveMapVariant(id, storage = globalThis.localStorage) {
  const variant = normalizeMapVariant(id);

  if (!variant) {
    return null;
  }

  try {
    storage?.setItem(MAP_VARIANT_STORAGE_KEY, variant);
  } catch {
    // Private mode: the URL still carries the choice.
  }

  return variant;
}

// Search string with ?map= set to the variant, other parameters kept.
export function withMapVariantParam(search, id) {
  const params = new URLSearchParams(search);
  params.set("map", id);
  return `?${params.toString()}`;
}
