import { useCallback, useEffect, useRef, useState } from "react";
import { isAndroidUserAgent, watchAppLaunch } from "../overlayLink";
import { detectInAppBrowser } from "../inAppBrowser";

// "Start with Overlay" (a banner, or one mission of it): launch(intentUrl).
// Android: fire the intent (the app opens; without it, or with an app too old
// for the link, Chrome comes back with ?overlay=missing). Elsewhere the app
// can't be launched: the dialog shows straight away. In-app browsers
// (Telegram, …) often ignore app links, so they get the dialog first (with the
// link as a button). Anywhere on Android, a link that leaves the page in front
// for 3 s shows the dialog too (and it closes again if the app turns up late).
// overlayMissing: null or the OverlayMissingDialog reason.
export default function useOverlayLaunch() {
  const [overlayMissing, setOverlayMissing] = useState(null);
  const stopLaunchWatch = useRef(null);
  useEffect(() => () => stopLaunchWatch.current?.(), []);

  const launch = useCallback((intentUrl) => {
    if (!isAndroidUserAgent(navigator.userAgent)) {
      setOverlayMissing("notAndroid");
      return;
    }

    if (detectInAppBrowser()) {
      setOverlayMissing("inApp");
      return;
    }

    stopLaunchWatch.current?.();
    stopLaunchWatch.current = watchAppLaunch(() => setOverlayMissing("noResponse"), {
      // The app turned up after all: take the "didn't open" dialog away again.
      onLateLaunch: () => setOverlayMissing((reason) => (reason === "noResponse" ? null : reason)),
    });
    window.location.assign(intentUrl);
  }, []);

  return { overlayMissing, setOverlayMissing, launch };
}
