import React from "react";
import ObModal from "./ObModal";
import { t } from "../i18n";

// Instructions for browsers without an install prompt (see src/pwaInstall.js).
export default function InstallAppDialog({ mode, onClose }) {
  return (
    <ObModal title={t("Install OpenBanners")} onClose={onClose} labelId="install-app-title">
      <p>
        {mode === "ios"
          ? t("Tap the Share button (in Safari it may be under •••), then “Add to Home Screen”.")
          : mode === "webview"
            ? t("This Android app is no longer updated. Open openbanners.org in Chrome and choose “Install app” from its menu.")
            : t("Open your browser’s menu and choose “Install app” or “Add to Home screen”. Chrome, Edge and Safari can install OpenBanners.")}
      </p>
      <p className="small muted">{t("OpenBanners then opens from your home screen like an app.")}</p>
    </ObModal>
  );
}
