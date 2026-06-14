import React, { useState } from "react";
import { getBannerGuiderLocationDebugInfo } from "../bannerGuiderLocationGeometry";

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function MapOverlay({
  missions,
  currentMission,
  setCurrentMission,
  bannerId,
  map = null,
  locationDebugSnapshot = null,
}) {
  const missionCount = missions.length;
  const [debugCopyStatus, setDebugCopyStatus] = useState("");

  const stopPropagation = (event) => {
    event.stopPropagation();
  };

  const handleDecrement = () => {
    if (currentMission > 0) {
      setCurrentMission(currentMission - 1);
    }
  };

  const handleIncrement = () => {
    if (currentMission === "-") {
      setCurrentMission(1);
    } else if (currentMission < missionCount) {
      setCurrentMission((prevMission) => prevMission + 1);
    }
  };

  const handleStart = () => {
    handleIncrement();

    if (currentMission === missionCount) {
      const missionUrl = `https://www.bannergress.com/banner/${bannerId}`;
      window.open(missionUrl, "_blank");
    } else {
      const missionUrl = `https://link.ingress.com/?link=https%3a%2f%2fintel.ingress.com%2fmission%2f${missions[currentMission].id}&apn=com.nianticproject.ingress&isi=576505181&ibi=com.google.ingress&ifl=https%3a%2f%2fapps.apple.com%2fapp%2fingress%2fid576505181&ofl=https%3a%2f%2fintel.ingress.com%2fmission%2f${missions[currentMission].id}`;
      window.open(missionUrl);
    }
  };

  const handleCopyDebugInformation = () => {
    const debugInfo = getBannerGuiderLocationDebugInfo({
      map,
      bannerId,
      currentMission,
      missionCount,
      locationSnapshot: locationDebugSnapshot,
    });
    const debugText = JSON.stringify(debugInfo, null, 2);

    copyTextToClipboard(debugText).then(
      () => {
        setDebugCopyStatus("Copied");
      },
      () => {
        setDebugCopyStatus("Copy failed");
      }
    );
  };

  return (
    <div
      className="overlay"
      data-map-overlay="mission-controls"
      role="group"
      aria-label="Mission controls"
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onTouchStart={stopPropagation}
    >
      <div className="overlay-controls">
        <button
          className={`overlay-button-minus ${
            currentMission === 0 ? "disable-click" : ""
          }`}
          onClick={handleDecrement}
          disabled={currentMission === 0}
          aria-label="Previous mission"
        >
          -
        </button>
        <p aria-live="polite" aria-atomic="true">
          {currentMission !== 0
            ? `${currentMission}/${missionCount}`
            : `-/${missionCount}`}
        </p>
        <button
          className={`overlay-button-plus ${
            currentMission === missionCount ? "disable-click" : ""
          }`}
          onClick={handleIncrement}
          disabled={currentMission === missionCount}
          aria-label="Next mission"
        >
          +
        </button>
      </div>
      <button
        className="start-button"
        onClick={handleStart}
        aria-label={
          currentMission === missionCount
            ? "Open Bannergress banner page"
            : "Open next mission in Ingress"
        }
      >
        {currentMission === missionCount ? "OPEN BG" : "NEXT"}
      </button>
      <button
        className="debug-button"
        onClick={handleCopyDebugInformation}
        aria-label="Copy BannerGuider debug information"
      >
        COPY DEBUG
      </button>
      {debugCopyStatus ? (
        <span className="debug-copy-status" aria-live="polite">
          {debugCopyStatus}
        </span>
      ) : null}
    </div>
  );
}
