import React, { useEffect, useRef, useState } from "react";
import {
  getBannerGuiderDebugLogText,
  logBannerGuiderDebug,
} from "../bannerGuiderDebug";

export default function MapOverlay({
  missions,
  currentMission,
  setCurrentMission,
  bannerId,
}) {
  const missionCount = missions.length;
  const overlayRef = useRef(null);
  const copyResetTimeoutRef = useRef(null);
  const [copyState, setCopyState] = useState("idle");

  const stopPropagation = (event) => {
    event.stopPropagation();
  };

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const scheduleCopyStateReset = () => {
    if (copyResetTimeoutRef.current) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimeoutRef.current = null;
    }, 2000);
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
      window.open(missionUrl, "_blank");
    }
  };

  const handleCopyLogs = async () => {
    const debugText = getBannerGuiderDebugLogText();

    logBannerGuiderDebug("copyDebugLogs requested", {
      bannerId,
      missionCount,
      currentMission,
      characters: debugText.length,
    });

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debugText);
      } else {
        throw new Error("Clipboard API unavailable");
      }

      logBannerGuiderDebug("copyDebugLogs success", {
        bannerId,
        characters: debugText.length,
      });
      setCopyState("copied");
    } catch (error) {
      console.error("Couldn't copy BannerGuider debug logs.", error);
      logBannerGuiderDebug("copyDebugLogs error", {
        bannerId,
        error: error?.message ?? String(error),
      });
      setCopyState("error");
    }

    scheduleCopyStateReset();
  };

  const copyLabel =
    copyState === "copied"
      ? "COPIED"
      : copyState === "error"
      ? "COPY FAILED"
      : "COPY LOGS";

  return (
    <div
      ref={overlayRef}
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
        className="start-button"
        onClick={handleCopyLogs}
        aria-label="Copy BannerGuider debug logs"
      >
        {copyLabel}
      </button>
    </div>
  );
}
