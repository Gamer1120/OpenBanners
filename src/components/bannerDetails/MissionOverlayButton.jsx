import React from "react";
import { useNavigate } from "react-router-dom";
import { DirectionsWalk, Layers } from "@mui/icons-material";
import { t } from "../../i18n";
import { buildOverlayMissionIntentUrl, buildOverlayMissionLink } from "../../overlayLink";
import { isWalkModeDevice, walkModePath } from "../../walkDevice";
import useOverlayLaunch from "../useOverlayLaunch";
import { OverlayMissingDialog } from "../OverlayDownloadDialog";

// "Start with Overlay from here": the Overlay app starts the banner at this
// mission (missionNumber, 1-based as listed) and opens it in Ingress. Same flow
// as the banner's "Start with Overlay" (useOverlayLaunch).
// On iPhone/iPad "Start walk mode from here" instead (2026-11-21, Michael), like
// the banner's "Start walk mode": walk mode with the big button on this
// mission. Decided while rendering (src/walkDevice.js), so no swap.
export default function MissionOverlayButton({ bannerId, missionNumber, className = "btn outlined sl" }) {
  if (!bannerId || !buildOverlayMissionLink(bannerId, missionNumber)) {
    return null;
  }
  return isWalkModeDevice() ? (
    <MissionWalkButton bannerId={bannerId} missionNumber={missionNumber} className={className} />
  ) : (
    <MissionOverlayLaunchButton bannerId={bannerId} missionNumber={missionNumber} className={className} />
  );
}

function MissionWalkButton({ bannerId, missionNumber, className }) {
  const navigate = useNavigate();
  return (
    <button type="button" className={className} onClick={() => navigate(walkModePath(bannerId, missionNumber))}>
      <DirectionsWalk fontSize="small" />
      {t("Start walk mode from here")}
    </button>
  );
}

function MissionOverlayLaunchButton({ bannerId, missionNumber, className }) {
  const { overlayMissing, setOverlayMissing, launch } = useOverlayLaunch();
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
