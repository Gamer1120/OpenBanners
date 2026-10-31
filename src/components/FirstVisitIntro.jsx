import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Close } from "@mui/icons-material";
import OverlayDownloadDialog from "./OverlayDownloadDialog";
import { BANNERGRESS_AUTH_STORAGE_KEY } from "../bannergressSync";
import { t } from "../i18n";
import { noteSettingChanged, onSyncedSettingsApplied } from "../settingsSyncState";

export const INTRO_DISMISSED_STORAGE_KEY = "openbanners:intro-dismissed";
// Signs of an earlier visit: signed in, used the map, or a city was picked.
const USED_BEFORE_KEYS = [
  BANNERGRESS_AUTH_STORAGE_KEY,
  "openbanners.discoveryMap.state",
  "openbanners-home-city",
];

export function shouldShowIntro(storage = typeof window === "undefined" ? null : window.localStorage) {
  try {
    if (!storage || storage.getItem(INTRO_DISMISSED_STORAGE_KEY)) {
      return false;
    }
    return !USED_BEFORE_KEYS.some((key) => storage.getItem(key));
  } catch {
    return false;
  }
}

// Home ("/"): a two-line pitch for first-time visitors (e.g. from a link in
// a Telegram channel). Dismissible; gone for good once closed or once the
// visitor has used the site (see USED_BEFORE_KEYS).
export default function FirstVisitIntro() {
  const [visible, setVisible] = useState(shouldShowIntro);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Closed on another device (settings sync).
  useEffect(() => onSyncedSettingsApplied(["introDismissed"], () => setVisible(shouldShowIntro())), []);

  if (!visible) {
    return null;
  }

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(INTRO_DISMISSED_STORAGE_KEY, "1");
    } catch {
      // Private mode: it just comes back next time.
    }
    noteSettingChanged("introDismissed");
  };

  return (
    <section className="start-intro" aria-labelledby="start-intro-title">
      <div className="start-intro-text">
        <h2 id="start-intro-title">{t("New to OpenBanners?")}</h2>
        <p className="small">
          {t("Find, plan and walk Ingress mission banners, using the banner data from Bannergress. Sign in with your Bannergress account to keep your To do and Done lists.")}
        </p>
        <div className="start-intro-links small">
          <Link to="/map">{t("Banner map")}</Link>
          <Link to="/planner">{t("Mission Day planner")}</Link>
          <button type="button" onClick={() => setOverlayOpen(true)}>
            {t("Overlay app for Android")}
          </button>
        </div>
      </div>
      <button type="button" className="icon-btn sl start-intro-close" aria-label={t("Close")} onClick={dismiss}>
        <Close />
      </button>
      {overlayOpen ? <OverlayDownloadDialog onClose={() => setOverlayOpen(false)} /> : null}
    </section>
  );
}
