import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import DesignA from "./bannerDetails/DesignA";
import DesignB from "./bannerDetails/DesignB";
import DesignC from "./bannerDetails/DesignC";
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

// Three banner page designs on trial. Choice in localStorage, ?design=a|b|c overrides.
export const DESIGNS = { a: DesignA, b: DesignB, c: DesignC };
export const DESIGN_STORAGE_KEY = "openbanners.bannerDesign";
export const DEFAULT_DESIGN = "a";

function normalizeDesign(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.hasOwn(DESIGNS, key) ? key : null;
}

function readStoredDesign() {
  try {
    return normalizeDesign(window.localStorage.getItem(DESIGN_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function DesignSwitcher({ design, onChange }) {
  return (
    <div className="bd-switch" role="group" aria-label="Page design">
      {Object.keys(DESIGNS).map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <button
            type="button"
            className="sl"
            aria-pressed={design === key}
            aria-label={`Design ${key.toUpperCase()}`}
            onClick={() => onChange(key)}
          >
            {key.toUpperCase()}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function BannerDetailsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stored, setStored] = useState(readStoredDesign);
  const design = normalizeDesign(searchParams.get("design")) ?? stored ?? DEFAULT_DESIGN;
  const Design = DESIGNS[design];

  const choose = (key) => {
    setStored(key);

    try {
      window.localStorage.setItem(DESIGN_STORAGE_KEY, key);
    } catch {
      // Private mode: the choice just doesn't stick.
    }

    if (searchParams.has("design")) {
      const next = new URLSearchParams(searchParams);
      next.delete("design");
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <>
      <Design />
      <DesignSwitcher design={design} onChange={choose} />
    </>
  );
}
