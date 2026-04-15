import React, { useRef } from "react";

export default function MapOverlay({
  missions,
  currentMission,
  setCurrentMission,
  bannerId,
}) {
  const missionCount = missions.length;
  const overlayRef = useRef(null);
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
      window.open(missionUrl, "_blank");
    }
  };

  return (
    <div
      ref={overlayRef}
      className="overlay"
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      <div className="overlay-controls">
        <button
          className={`overlay-button-minus ${
            currentMission === 0 ? "disable-click" : ""
          }`}
          onClick={handleDecrement}
          disabled={currentMission === 0}
        >
          -
        </button>
        <p>
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
        >
          +
        </button>
      </div>
      <button className="start-button" onClick={handleStart}>
        {currentMission === missionCount ? "OPEN BG" : "NEXT"}
      </button>
    </div>
  );
}
