import React, { useState } from "react";
import { Link } from "react-router-dom";
import ObModal from "./ObModal";
import { buildOpenInBrowserIntent, copyText } from "../inAppBrowser";
import { t } from "../i18n";

// Shown instead of the Bannergress sign-in inside an in-app browser
// (src/inAppBrowser.js): Google blocks its sign-in there.
export default function InAppBrowserDialog({ info, onClose, onContinue }) {
  const [copied, setCopied] = useState(null);
  const href = window.location.href;
  const intent = info?.platform === "android" ? buildOpenInBrowserIntent(href) : null;

  const handleCopy = async () => {
    setCopied(await copyText(href));
  };

  return (
    <ObModal title={t("Open OpenBanners in your browser to sign in")} onClose={onClose} labelId="in-app-browser-title">
      <p>
        {info?.app
          ? t("Google doesn’t allow signing in inside {app}’s built-in browser, and Bannergress signs you in with Google.", { app: info.app })
          : t("Google doesn’t allow signing in inside an app’s built-in browser, and Bannergress signs you in with Google.")}
      </p>
      <p className="small muted">
        {info?.platform === "ios"
          ? t("Tap the ⋯ menu (or the compass icon) and choose “Open in Safari”. Or copy the link and paste it into Safari.")
          : info?.platform === "android"
            ? t("If nothing happens, open the ⋮ menu at the top and choose “Open in browser”, or copy the link and paste it into Chrome.")
            : t("Open the app’s menu and choose to open the page in your browser, or copy the link and paste it there.")}
      </p>
      <p className="ob-inapp-link small" translate="no">{href}</p>
      <div className="ob-modal-actions">
        {intent ? (
          <a className="btn filled sl" href={intent}>
            {t("Open in browser")}
          </a>
        ) : null}
        <button type="button" className={`btn ${intent ? "outlined" : "filled"} sl`} onClick={handleCopy}>
          {t("Copy link")}
        </button>
      </div>
      {copied === null ? null : (
        <p className="small" role="status">
          {copied ? t("Link copied.") : t("Couldn’t copy the link. Press and hold it above to copy it.")}
        </p>
      )}
      <div className="ob-modal-foot">
        <button type="button" className="btn text sl" onClick={onContinue}>
          {t("Try signing in here anyway")}
        </button>
        <Link className="btn text sl" to="/privacy" onClick={onClose}>
          {t("What happens when you sign in")}
        </Link>
      </div>
    </ObModal>
  );
}
