import { useEffect, useState } from "react";

const RECENT_SEARCHES_KEY = "openbanners-recent-searches";
const RECENT_SEARCHES_EVENT = "openbanners:recent-searches";
export const MAX_RECENT_SEARCHES = 8;

export function readRecentSearches() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch {
    return [];
  }
}

function writeRecentSearches(list) {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {}

  window.dispatchEvent(new Event(RECENT_SEARCHES_EVENT));
}

// Most recent first, case-insensitive de-duplication, at most 8.
export function addRecentSearch(query) {
  const trimmed = String(query ?? "").trim();

  if (!trimmed) {
    return;
  }

  const rest = readRecentSearches().filter(
    (entry) => entry.toLowerCase() !== trimmed.toLowerCase()
  );
  writeRecentSearches([trimmed, ...rest].slice(0, MAX_RECENT_SEARCHES));
}

export function clearRecentSearches() {
  writeRecentSearches([]);
}

export function useRecentSearches() {
  const [list, setList] = useState(readRecentSearches);

  useEffect(() => {
    const update = () => setList(readRecentSearches());
    window.addEventListener(RECENT_SEARCHES_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(RECENT_SEARCHES_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  return list;
}
