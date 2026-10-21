import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Scroll positions and loaded lists per history entry, so Back lands on the
// same banner tile: positions survive a reload (sessionStorage), list items
// only live in memory.
const SCROLL_STORAGE_KEY = "openbanners.scrollPositions";
const MAX_ENTRIES = 40;
const RESTORE_TIMEOUT_MS = 3000;
const RESTORE_SETTLE_MS = 400;

let scrollPositions = null;
const entryCache = new Map();

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);

  while (map.size > MAX_ENTRIES) {
    map.delete(map.keys().next().value);
  }
}

function getScrollPositions() {
  if (scrollPositions) {
    return scrollPositions;
  }

  scrollPositions = new Map();

  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? "[]"
    );

    if (Array.isArray(stored)) {
      stored.forEach(([key, value]) => scrollPositions.set(key, value));
    }
  } catch {
    // A broken entry just means no restored scroll.
  }

  return scrollPositions;
}

function persistScrollPositions() {
  try {
    window.sessionStorage.setItem(
      SCROLL_STORAGE_KEY,
      JSON.stringify([...getScrollPositions()])
    );
  } catch {
    // Storage can be unavailable (private mode); memory still works.
  }
}

// Location keys repeat ("default") for entries opened by typing a URL, so the
// path is part of the key.
export function getHistoryEntryKey(location) {
  return `${location.key ?? "default"}|${location.pathname}${location.search ?? ""}`;
}

export function saveScrollPosition(entryKey, position) {
  remember(getScrollPositions(), entryKey, position);
  persistScrollPositions();
}

export function readScrollPosition(entryKey) {
  return getScrollPositions().get(entryKey) ?? null;
}

export function readHistoryEntryCache(entryKey, id) {
  return entryCache.get(`${entryKey}#${id}`) ?? null;
}

export function writeHistoryEntryCache(entryKey, id, value) {
  remember(entryCache, `${entryKey}#${id}`, value);
}

export function clearHistoryEntryState() {
  entryCache.clear();
  getScrollPositions().clear();
  persistScrollPositions();
}

// The cached state of this list for this history entry, only when coming
// back (POP); a fresh visit (PUSH/REPLACE) starts over.
export function useRestoredEntry(id) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const entryKey = getHistoryEntryKey(location);
  const [restored] = useState(() =>
    navigationType === "POP" ? readHistoryEntryCache(entryKey, id) : null
  );

  return { entryKey, navigationType, restored };
}

// Keeps writing the latest list state for the current history entry.
export function useRememberEntry(entryKey, id, value) {
  useLayoutEffect(() => {
    if (value) {
      writeHistoryEntryCache(entryKey, id, value);
    }
  });
}

function getBannerLinks(href) {
  return [...document.querySelectorAll('a[href^="/banner/"]')].filter(
    (link) => link.getAttribute("href") === href
  );
}

function findAnchor(anchor) {
  if (!anchor?.href) {
    return null;
  }

  const links = getBannerLinks(anchor.href);

  return links[anchor.index] ?? links[0] ?? null;
}

// Scrolls back to a saved position. Images and late pages can grow the page
// after the first try, so it keeps re-applying until the position holds (or
// the user scrolls).
export function restoreWindowScroll(position, { timeoutMs = RESTORE_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  let settledAt = null;
  let frame = null;
  let stopped = false;
  const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"];

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    window.cancelAnimationFrame(frame);
    userEvents.forEach((type) => window.removeEventListener(type, stop, true));
  };

  const step = () => {
    if (stopped) {
      return;
    }

    let targetY = position.y;
    const anchorElement = findAnchor(position.anchor);

    // The tile you opened is the real target: land it where it was.
    if (anchorElement && Number.isFinite(position.anchor.top)) {
      targetY =
        (window.scrollY || 0) +
        anchorElement.getBoundingClientRect().top -
        position.anchor.top;
    }

    targetY = Math.max(0, Math.round(targetY));

    if (Math.abs((window.scrollY || 0) - targetY) > 1) {
      window.scrollTo(0, targetY);
    }

    const now = Date.now();

    if (Math.abs((window.scrollY || 0) - targetY) <= 1) {
      settledAt = settledAt ?? now;
    } else {
      settledAt = null;
    }

    if (
      (settledAt !== null && now - settledAt >= RESTORE_SETTLE_MS) ||
      now - startedAt >= timeoutMs
    ) {
      stop();
      return;
    }

    frame = window.requestAnimationFrame(step);
  };

  userEvents.forEach((type) =>
    window.addEventListener(type, stop, { capture: true, passive: true })
  );
  step();

  return stop;
}

// Back/forward (POP) returns to where you were; a new page (PUSH/REPLACE to
// another path) starts at the top.
export function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const entryKey = getHistoryEntryKey(location);
  const entryKeyRef = useRef(entryKey);
  const previousPathRef = useRef(null);

  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const handleScroll = () => {
      const saved = readScrollPosition(entryKeyRef.current);
      const y = window.scrollY || 0;

      if (saved?.y !== y) {
        saveScrollPosition(entryKeyRef.current, { y });
      }
    };
    // Opening a banner remembers which tile it was, so Back can land on it.
    const handleClick = (event) => {
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href^="/banner/"]')
          : null;
      const href = link?.getAttribute("href");

      if (!href) {
        return;
      }

      const links = getBannerLinks(href);

      saveScrollPosition(entryKeyRef.current, {
        y: window.scrollY || 0,
        anchor: {
          href,
          index: Math.max(0, links.indexOf(link)),
          top: link.getBoundingClientRect().top,
        },
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("click", handleClick, true);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  useLayoutEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const pathChanged = previousPathRef.current !== path;

    entryKeyRef.current = entryKey;
    previousPathRef.current = path;

    if (navigationType === "POP") {
      const saved = readScrollPosition(entryKey);

      if (saved && (saved.y > 0 || saved.anchor)) {
        return restoreWindowScroll(saved);
      }

      if (pathChanged) {
        window.scrollTo(0, 0);
      }

      return undefined;
    }

    if (pathChanged) {
      window.scrollTo(0, 0);
    }

    return undefined;
  }, [entryKey, location.pathname, location.search, navigationType]);

  return null;
}
