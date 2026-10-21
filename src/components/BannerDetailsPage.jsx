import { useEffect } from "react";
import DesignA from "./bannerDetails/DesignA";
import "./bannerDetails/bannerDetails.css";

// Route helpers live with the shared banner-page code; re-exported for the map views.
export {
  FINISH_FLAG_SVG,
  getFinish,
  getStepPosition,
  getSteps,
  isOnStartMarker,
  missionColors,
} from "./bannerDetails/shared";

// Left over from the A/B/C trial (design A won).
const OLD_DESIGN_STORAGE_KEY = "openbanners.bannerDesign";

export default function BannerDetailsPage() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_DESIGN_STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
  }, []);

  return <DesignA />;
}
