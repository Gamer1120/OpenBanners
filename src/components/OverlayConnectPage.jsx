import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BANNERGRESS_AUTH_REQUEST_EVENT, useBannergressAuth, useBannergressDisplayName } from "../bannergressSync";
import { t } from "../i18n";
import { isAndroidUserAgent, isOverlayMissingSearch } from "../overlayLink";
import { buildOverlayReturnLinks, createOverlayLink, parseOverlayConnect } from "../accountData";

// /overlay/connect: the OpenBanners Overlay app (Settings → Back up to / Restore
// from OpenBanners) opens this page with a PKCE challenge. Signed in, "Allow"
// asks the server for a one-time code (5 minutes) and hands it back to the
// app in openbanners-overlay://link. Only that code travels in the link; the
// Bannergress sign-in stays in this browser (server/overlay-backup.mjs).
export default function OverlayConnectPage() {
  const location = useLocation();
  const request = useMemo(() => parseOverlayConnect(location.search), [location.search]);
  const missing = isOverlayMissingSearch(location.search);
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const agent = useBannergressDisplayName(loggedIn);
  const [state, setState] = useState({ status: "idle", links: null, error: "" });
  const android = typeof navigator !== "undefined" && isAndroidUserAgent(navigator.userAgent);
  const returnRef = useRef(null);

  useEffect(() => {
    if (state.status === "ready" && returnRef.current) {
      returnRef.current.focus();
    }
  }, [state.status]);

  const allow = () => {
    setState({ status: "busy", links: null, error: "" });
    createOverlayLink(request.challenge).then(
      ({ code }) => {
        const links = buildOverlayReturnLinks({ code, state: request.state, origin: window.location.origin, search: location.search });
        setState({ status: "ready", links, error: "" });
        // Still within the tap's user activation, so Chrome lets the app open.
        window.location.href = android ? links.intent : links.link;
      },
      (error) => setState({ status: "error", links: null, error: error?.message || t("Couldn't connect the Overlay. Try again.") })
    );
  };

  const intro =
    request?.action === "restore"
      ? t("OpenBanners Overlay wants to restore its settings from your OpenBanners account.")
      : t("OpenBanners Overlay wants to back up its settings to your OpenBanners account.");

  return (
    <div className="ob-page overlay-connect">
      <h1 className="ob-h1">{t("Connect OpenBanners Overlay")}</h1>
      {!request ? (
        <p role="alert">{t("This link is incomplete. Start again in the Overlay app: Settings → Back up to OpenBanners.")}</p>
      ) : missing ? (
        <p role="alert">{t("OpenBanners Overlay isn’t installed on this phone, or it’s too old for this link. Install or update it, then try again.")}</p>
      ) : (
        <>
          <p>{intro}</p>
          <p className="small muted">
            {t("The app only gets access to its own settings backup, for 15 minutes. Your Bannergress sign-in stays in this browser.")}
          </p>
          {!loggedIn ? (
            <p>
              <button type="button" className="btn filled sl" onClick={() => window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT))}>
                {t("Log in")}
              </button>
            </p>
          ) : state.status === "ready" ? (
            <>
              <p role="status">{t("Done. Go back to the Overlay app.")}</p>
              <p>
                <a ref={returnRef} className="btn filled sl" href={android ? state.links.intent : state.links.link}>
                  {t("Open the Overlay app")}
                </a>
              </p>
            </>
          ) : (
            <>
              {agent ? <p className="small">{t("Signed in as {agent}", { agent })}</p> : null}
              <p className="pp-actions">
                <button type="button" className="btn filled sl" disabled={state.status === "busy"} onClick={allow}>
                  {t("Allow")}
                </button>
              </p>
              {state.error ? <p className="small pp-error" role="alert">{state.error}</p> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
