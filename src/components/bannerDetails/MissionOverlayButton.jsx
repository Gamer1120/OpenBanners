import React from "react";
import { Layers } from "@mui/icons-material";
import { t } from "../../i18n";
import { buildOverlayMissionIntentUrl, buildOverlayMissionLink } from "../../overlayLink";
import useOverlayLaunch from "../useOverlayLaunch";
import { OverlayMissingDialog } from "../OverlayDownloadDialog";

// "Start with Overlay from here": the Overlay app starts the banner at this
// mission (missionNumber, 1-based as listed) and opens it in Ingress. Same flow
// as the banner's "Start with Overlay" (useOverlayLaunch).
export default function MissionOverlayButton({ bannerId, missionNumber, className = "btn outlined sl" }) {
  const { overlayMissing, setOverlayMissing, launch } = useOverlayLaunch();
  if (!bannerId || !buildOverlayMissionLink(bannerId, missionNumber)) {
    return null;
  }
  const origin = window.location.origin;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => launch(buildOverlayMissionIntentUrl(bannerId, missionNumber, origin))}
      >
        <Layers fontSize="small" />
        {t("Start with Overlay from here")}
      </button>
      {overlayMissing ? (
        <OverlayMissingDialog
          reason={overlayMissing}
          appLink={buildOverlayMissionLink(bannerId, missionNumber, origin)}
          onClose={() => setOverlayMissing(null)}
        />
      ) : null}
    </>
  );
}
