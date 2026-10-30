import React, { useEffect, useRef, useState } from "react";
import ObModal from "./ObModal";
import { buildOpenInBrowserIntent } from "../inAppBrowser";
import { watchAppLaunch } from "../overlayLink";
import { t } from "../i18n";

export const OVERLAY_LINKS = {
  googleGroup: "https://groups.google.com/g/openbanners-overlay",
  playTesting: "https://play.google.com/apps/testing/org.openbanners.overlay",
  fdroid: "https://f-droid.org/packages/org.openbanners.overlay/",
  githubRelease: "https://github.com/Gamer1120/OpenBanners-overlay/releases/latest",
};

function ExternalButton({ href, variant, children }) {
  return (
    <a className={`btn ${variant} sl ob-dl-btn`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// The three ways to get the app (separate repo Gamer1120/OpenBanners-overlay).
// Google Play first: it is still a closed test there, so people join the
// Google Group first and wait a moment.
export function OverlayDownloadOptions() {
  return (
    <>
      <section className="ob-dl-option primary" aria-labelledby="overlay-dl-play">
        <div className="ob-dl-option-head">
          <h3 id="overlay-dl-play">Google Play</h3>
          <span className="ob-dl-badge">{t("Recommended")}</span>
        </div>
        <p className="small">{t("The app is still in testing on Google Play, so there’s one extra step.")}</p>
        <ol className="ob-dl-steps small">
          <li>
            {t("Join the Google Group with the Google account you use on Google Play.")}
            <ExternalButton href={OVERLAY_LINKS.googleGroup} variant="filled">
              {t("Join the Google Group")}
            </ExternalButton>
          </li>
          <li>
            <strong>{t("Wait about 2 minutes.")}</strong> {t("This matters: Google Play needs a moment to let you in.")}
          </li>
          <li>
            {t("Open the testing page, become a tester and download the app.")}
            <ExternalButton href={OVERLAY_LINKS.playTesting} variant="filled">
              {t("Become a tester on Google Play")}
            </ExternalButton>
          </li>
          <li>{t("Can’t download it yet? Wait another 2 minutes and try again.")}</li>
        </ol>
      </section>

      <section className="ob-dl-option" aria-labelledby="overlay-dl-fdroid">
        <h3 id="overlay-dl-fdroid">F-Droid</h3>
        <p className="small muted">{t("Updates can reach F-Droid a few days later.")}</p>
        <ExternalButton href={OVERLAY_LINKS.fdroid} variant="outlined">
          {t("Open in F-Droid")}
        </ExternalButton>
      </section>

      <section className="ob-dl-option" aria-labelledby="overlay-dl-github">
        <h3 id="overlay-dl-github">{t("APK from GitHub")}</h3>
        <p className="small muted">{t("The newest version as an APK file, to install yourself.")}</p>
        <ExternalButton href={OVERLAY_LINKS.githubRelease} variant="outlined">
          {t("Download the latest release")}
        </ExternalButton>
      </section>
    </>
  );
}

// More menu → "Download OpenBanners Overlay".
export default function OverlayDownloadDialog({ onClose }) {
  return (
    <ObModal title={t("Download OpenBanners Overlay")} onClose={onClose} labelId="overlay-download-title">
      <p className="small muted">
        {t("A route map that floats over Ingress while you do a banner. Banners from openbanners.org open straight in it. Android only.")}
      </p>
      <OverlayDownloadOptions />
    </ObModal>
  );
}

// "Start with Overlay" without the app. reason:
// - "missing": Chrome came back via the intent's browser_fallback_url
//   (?overlay=missing), so the app isn't installed;
// - "notAndroid": iOS / desktop, opened straight away;
// - "noResponse": the app link was fired but the page stayed in front
//   (watchAppLaunch), e.g. a browser that ignores it or no app;
// - "inApp": an in-app browser (Telegram, …; src/inAppBrowser.js), where app
//   links often do nothing. Opened before trying: appLink (the plain
//   openbanners-overlay:// link, which a WebView host is most likely to hand
//   to Android) is offered as a button, plus "Open in browser".
// onOpenInBannergress (banner page only) adds the alternative: share the
// Bannergress link, e.g. with Bannergress Overlay.
export function OverlayMissingDialog({ onClose, reason = "missing", onOpenInBannergress = null, appLink = null }) {
  const [launchFailed, setLaunchFailed] = useState(false);
  const stopWatching = useRef(null);
  useEffect(() => () => stopWatching.current?.(), []);
  const inApp = reason === "inApp";
  const browserIntent = inApp ? buildOpenInBrowserIntent(window.location.href) : null;

  const handleOpenApp = () => {
    setLaunchFailed(false);
    stopWatching.current?.();
    stopWatching.current = watchAppLaunch(() => setLaunchFailed(true));
    window.location.assign(appLink);
  };

  const intro = {
    notAndroid: t("OpenBanners Overlay is an Android app. Install it on your phone, then open this page there."),
    noResponse: t("If OpenBanners Overlay didn’t open, it may not be installed yet. Install it below, then try again."),
    inApp: t("Built-in browsers in apps like Telegram often can’t open other apps. Try the button; if nothing happens, open this page in your browser and start from there."),
  }[reason] ?? t("OpenBanners Overlay isn’t installed on this phone (or it’s too old for this link). Install it, then try again.");

  return (
    <ObModal
      title={inApp ? t("Start with OpenBanners Overlay") : t("Install OpenBanners Overlay")}
      onClose={onClose}
      labelId="overlay-missing-title"
    >
      <p className="small">{intro}</p>
      {onOpenInBannergress ? (
        // First: many players already use Bannergress Overlay.
        <section className="ob-dl-option primary" aria-labelledby="overlay-dl-bannergress">
          <h3 id="overlay-dl-bannergress">{t("Use Bannergress Overlay")}</h3>
          <p className="small muted">
            {t("Already have another overlay app, like Bannergress Overlay? Share this banner’s Bannergress link with it.")}
          </p>
          <button type="button" className="btn filled sl ob-dl-btn" onClick={onOpenInBannergress}>
            {t("Open in Bannergress Overlay")}
          </button>
        </section>
      ) : null}
      {inApp ? (
        <>
          <div className="ob-modal-actions">
            {appLink ? (
              <button type="button" className="btn filled sl" onClick={handleOpenApp}>
                {t("Start with Overlay")}
              </button>
            ) : null}
            {browserIntent ? (
              <a className="btn outlined sl" href={browserIntent}>
                {t("Open in browser")}
              </a>
            ) : null}
          </div>
          {launchFailed ? (
            <p className="small" role="status">
              {t("The app didn’t open. Open this page in your browser and try again there, or install the app below.")}
            </p>
          ) : null}
          <h3 className="ob-dl-sub">{t("Install OpenBanners Overlay")}</h3>
        </>
      ) : onOpenInBannergress ? (
        <h3 className="ob-dl-sub">{t("Install OpenBanners Overlay")}</h3>
      ) : null}
      <OverlayDownloadOptions />
    </ObModal>
  );
}
