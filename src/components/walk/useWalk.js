import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBannergress } from "../../bannergressSync";
import { loadWalkState, saveWalkState } from "../../walkMode";

// The banner from Bannergress, like the banner page (signed in when possible).
export function useWalkBanner(bannerId) {
  const [state, setState] = useState({ status: "loading", banner: null });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let ignore = false;
    setState({ status: "loading", banner: null });
    fetchBannergress("https://api.bannergress.com/bnrs/" + encodeURIComponent(bannerId))
      .then(async (response) => {
        const banner = response?.ok ? await response.json() : null;
        if (!ignore) {
          setState(
            banner?.id
              ? { status: "ready", banner }
              : { status: response?.status === 404 ? "notFound" : "error", banner: null }
          );
        }
      })
      .catch(() => !ignore && setState({ status: "error", banner: null }));
    return () => {
      ignore = true;
    };
  }, [bannerId, reload]);

  return { ...state, retry: () => setReload((value) => value + 1) };
}

// The walk state of a banner. Every change is written to localStorage at once
// (before the next render), and the saved state is read again whenever the
// page comes back (pageshow: back/forward cache or reload; visibilitychange:
// back from the Ingress app).
export function useWalkState(bannerId, onReturn) {
  const [state, setStateRaw] = useState(() => loadWalkState(bannerId));
  const stateRef = useRef(state);
  const onReturnRef = useRef(onReturn);
  onReturnRef.current = onReturn;

  const setState = useCallback(
    (update) => {
      const next = typeof update === "function" ? update(stateRef.current) : update;
      if (next !== stateRef.current) {
        stateRef.current = next;
        saveWalkState(bannerId, next);
        setStateRaw(next);
      }
      return next;
    },
    [bannerId]
  );

  useEffect(() => {
    const reload = () => {
      const saved = loadWalkState(bannerId);
      stateRef.current = saved;
      setStateRaw(saved);
      onReturnRef.current?.();
    };
    reload();
    const onVisible = () => document.visibilityState === "visible" && reload();
    window.addEventListener("pageshow", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bannerId]);

  return [state, setState, stateRef];
}

// Remembered after the first allowed position, for browsers without the
// Permissions API (so they aren't asked on every visit before the tap).
const LOCATION_ALLOWED_KEY = "openbanners-walk-location";

function rememberAllowed(allowed) {
  try {
    if (allowed) {
      window.localStorage.setItem(LOCATION_ALLOWED_KEY, "1");
    } else {
      window.localStorage.removeItem(LOCATION_ALLOWED_KEY);
    }
  } catch {
    // Not kept: the "Show distance" link asks again next time.
  }
}

function wasAllowed() {
  try {
    return window.localStorage.getItem(LOCATION_ALLOWED_KEY) === "1";
  } catch {
    return false;
  }
}

// Where you are, read ONCE each time the page becomes visible
// (getCurrentPosition, no watch), and only when location is already allowed.
// Otherwise status "ask": the page offers a small "Show distance" link,
// which calls ask() (the browser's prompt, once). status: idle | ask |
// locating | ok | denied | unavailable | unsupported.
export function useOncePosition(enabled) {
  const [state, setState] = useState({ position: null, status: "idle" });
  const busy = useRef(false);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation || busy.current) {
      return;
    }
    busy.current = true;
    setState((current) => (current.position ? current : { ...current, status: "locating" }));
    navigator.geolocation.getCurrentPosition(
      (result) => {
        busy.current = false;
        rememberAllowed(true);
        setState({ position: { latitude: result.coords.latitude, longitude: result.coords.longitude }, status: "ok" });
      },
      (error) => {
        busy.current = false;
        if (error?.code === 1) {
          rememberAllowed(false);
        }
        setState((current) => ({
          ...current,
          status: error?.code === 1 ? "denied" : current.position ? "ok" : "unavailable",
        }));
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 }
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (!navigator.geolocation) {
      setState({ position: null, status: "unsupported" });
      return undefined;
    }
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      let permission = null;
      try {
        permission = (await navigator.permissions?.query?.({ name: "geolocation" }))?.state ?? null;
      } catch {
        permission = null;
      }
      if (cancelled) {
        return;
      }
      if (permission === "granted" || (permission === null && wasAllowed())) {
        locate();
      } else if (permission === "denied") {
        setState((current) => ({ ...current, status: "denied" }));
      } else {
        setState((current) => (current.position ? current : { ...current, status: "ask" }));
      }
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, [enabled, locate]);

  return { ...state, ask: locate };
}

// Lets the walk page draw under the iPhone notch / home indicator (it pads
// itself with the safe-area insets); the rest of the site keeps the normal
// viewport.
export function useViewportCover() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      return undefined;
    }
    const before = meta.getAttribute("content") || "";
    if (!/viewport-fit/.test(before)) {
      meta.setAttribute("content", before + ", viewport-fit=cover");
    }
    return () => meta.setAttribute("content", before);
  }, []);
}
