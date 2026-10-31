import React, { useEffect, useState } from "react";
import { GridView, ViewList } from "@mui/icons-material";
import { t } from "../i18n";
import { noteSettingChanged, onSyncedSettingsApplied } from "../settingsSyncState";

export const VIEW_MODE_STORAGE_KEY = "openbanners-banner-view-mode";

function readViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "compact"
      ? "compact"
      : "visual";
  } catch {
    return "visual";
  }
}

export function useBannerViewMode() {
  const [viewMode, setViewModeState] = useState(readViewMode);

  // Wall/List chosen on another device (settings sync).
  useEffect(() => onSyncedSettingsApplied(["viewMode"], () => setViewModeState(readViewMode())), []);

  const setViewMode = (nextViewMode) => {
    setViewModeState(nextViewMode);

    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, nextViewMode);
    } catch {}
    noteSettingChanged("viewMode");
  };

  return [viewMode, setViewMode];
}

// Only Wall and List: Browse has no map view (the Map page is one tap away).
export default function ViewModeToggle({ viewMode, onChange }) {
  return (
    <div className="seg" role="group" aria-label={t("Banner view mode")}>
      <button
        type="button"
        className="sl"
        aria-pressed={viewMode !== "compact"}
        aria-label={t("Visual banner view")}
        onClick={() => onChange("visual")}
      >
        <GridView fontSize="small" />
        <span>{t("Wall")}</span>
      </button>
      <button
        type="button"
        className="sl"
        aria-pressed={viewMode === "compact"}
        aria-label={t("Compact banner view")}
        onClick={() => onChange("compact")}
      >
        <ViewList fontSize="small" />
        <span>{t("List")}</span>
      </button>
    </div>
  );
}
