import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBannergress } from "../../bannergressSync";
import { headingFromOrientation } from "../../walkMode";
import { isIos } from "../../pwaInstall";

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

// Real GPS: watchPosition with high accuracy (a 40 m range needs GPS, not Wi-Fi).
export function useGpsPosition(enabled) {
  const [state, setState] = useState({ position: null, accuracy: null, error: "" });

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (!navigator.geolocation) {
      setState({ position: null, accuracy: null, error: "unsupported" });
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (result) =>
        setState({
          position: { latitude: result.coords.latitude, longitude: result.coords.longitude },
          accuracy: result.coords.accuracy,
          error: "",
        }),
      (error) => setState((current) => ({ ...current, error: error.code === 1 ? "denied" : "unavailable" })),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return state;
}

// The phone's compass. iOS 13+ needs a tap to ask permission
// (DeviceOrientationEvent.requestPermission); Chrome on Android sends
// deviceorientationabsolute without asking. No heading after a few seconds:
// "unavailable" (desktop, or no magnetometer), and the arrow points north-up.
export function useCompass() {
  // Only Safari asks; Chrome (which also has requestPermission now) sends
  // the events without it.
  const needsPermission =
    typeof window !== "undefined" &&
    isIos() &&
    typeof window.DeviceOrientationEvent !== "undefined" &&
    typeof window.DeviceOrientationEvent.requestPermission === "function";
  const [status, setStatus] = useState(needsPermission ? "needsPermission" : "starting");
  const [heading, setHeading] = useState(null);
  const listening = useRef(false);

  const listen = useCallback(() => {
    if (listening.current || typeof window === "undefined") {
      return () => {};
    }
    listening.current = true;
    const eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    let got = false;
    const onOrientation = (event) => {
      const angle = window.screen?.orientation?.angle ?? Number(window.orientation) ?? 0;
      const value = headingFromOrientation(event, Number.isFinite(angle) ? angle : 0);
      if (value !== null) {
        got = true;
        setHeading(value);
        setStatus("active");
      }
    };
    window.addEventListener(eventName, onOrientation);
    const timer = window.setTimeout(() => {
      if (!got) {
        setStatus("unavailable");
      }
    }, 3000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(eventName, onOrientation);
      listening.current = false;
    };
  }, []);

  useEffect(() => {
    if (needsPermission) {
      return undefined;
    }
    return listen();
  }, [needsPermission, listen]);

  const stopRef = useRef(null);
  useEffect(() => () => stopRef.current?.(), []);

  // From a tap (iOS only allows the prompt from a user gesture).
  const requestPermission = useCallback(async () => {
    try {
      const answer = await window.DeviceOrientationEvent.requestPermission();
      if (answer === "granted") {
        setStatus("starting");
        stopRef.current = listen();
      } else {
        setStatus("denied");
      }
    } catch {
      setStatus("unavailable");
    }
  }, [listen]);

  return { heading: status === "active" ? heading : null, status, requestPermission };
}

// Keeps the screen on while walking (Screen Wake Lock API: Chrome 84+,
// Safari 16.4+). The lock is dropped whenever the page is hidden, so it's
// asked again when the page comes back.
export function useWakeLock(enabled = true) {
  const [status, setStatus] = useState(
    typeof navigator !== "undefined" && navigator.wakeLock ? "off" : "unsupported"
  );
  const lock = useRef(null);

  const request = useCallback(async () => {
    if (!navigator.wakeLock || document.visibilityState !== "visible") {
      return;
    }
    try {
      lock.current = await navigator.wakeLock.request("screen");
      setStatus("on");
      lock.current.addEventListener?.("release", () => setStatus((current) => (current === "on" ? "off" : current)));
    } catch {
      setStatus("off");
    }
  }, []);

  useEffect(() => {
    if (!enabled || !navigator.wakeLock) {
      return undefined;
    }
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    // Safari may want a user gesture: try again on the first tap.
    const onTap = () => lock.current?.released !== false && request();
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerup", onTap);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerup", onTap);
      lock.current?.release?.().catch?.(() => {});
      lock.current = null;
    };
  }, [enabled, request]);

  return status;
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

// An angle that turns the short way: 350° → 10° goes +20°, not -340°.
export function useContinuousAngle(angle) {
  const last = useRef(null);
  if (!Number.isFinite(angle)) {
    return last.current ?? 0;
  }
  if (last.current === null) {
    last.current = angle;
  } else {
    const delta = ((angle - last.current + 540) % 360) - 180;
    last.current += delta;
  }
  return last.current;
}
