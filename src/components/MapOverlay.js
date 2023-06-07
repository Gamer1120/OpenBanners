import React, { useState, useEffect, useRef } from "react";

export default function MapOverlay({ missions }) {
  const missionCount = missions.length;
  const [currentMission, setCurrentMission] = useState(0);
  const overlayRef = useRef(null);

  const handleDecrement = () => {
    if (currentMission === 1) {
      setCurrentMission("-");
    } else if (currentMission !== "-" && currentMission > 0) {
      setCurrentMission((prevMission) => prevMission - 1);
    }
  };

  const handleIncrement = () => {
    if (currentMission === "-") {
      setCurrentMission(1);
    } else if (currentMission < missionCount) {
      setCurrentMission((prevMission) => prevMission + 1);
    }
  };

  useEffect(() => {
    const handleOverlayMouseEvents = (event) => {
      event.stopPropagation();
    };

    if (overlayRef.current) {
      overlayRef.current.addEventListener(
        "mousedown",
        handleOverlayMouseEvents
      );
      overlayRef.current.addEventListener("mouseup", handleOverlayMouseEvents);
      overlayRef.current.addEventListener("click", handleOverlayMouseEvents);
      overlayRef.current.addEventListener("dblclick", handleOverlayMouseEvents);

      const plusButton = overlayRef.current.querySelector(
        ".overlay-button-plus"
      );
      plusButton.addEventListener("click", handleIncrement);

      const minusButton = overlayRef.current.querySelector(
        ".overlay-button-minus"
      );
      minusButton.addEventListener("click", handleDecrement);

      const startButton = overlayRef.current.querySelector(".start-button");
      startButton.addEventListener("click", handleStart);
    }

    return () => {
      if (overlayRef.current) {
        overlayRef.current.removeEventListener(
          "mousedown",
          handleOverlayMouseEvents
        );
        overlayRef.current.removeEventListener(
          "mouseup",
          handleOverlayMouseEvents
        );
        overlayRef.current.removeEventListener(
          "click",
          handleOverlayMouseEvents
        );
        overlayRef.current.removeEventListener(
          "dblclick",
          handleOverlayMouseEvents
        );

        const plusButton = overlayRef.current.querySelector(
          ".overlay-button-plus"
        );
        plusButton.removeEventListener("click", handleIncrement);

        const minusButton = overlayRef.current.querySelector(
          ".overlay-button-minus"
        );
        minusButton.removeEventListener("click", handleDecrement);

        const startButton = overlayRef.current.querySelector(".start-button");
        startButton.removeEventListener("click", handleStart);
      }
    };
  }, [currentMission]);

  const handleStart = () => {
    handleIncrement();
    const missionUrl = `https://link.ingress.com/?link=https%3a%2f%2fintel.ingress.com%2fmission%2f${missions[currentMission].id}&apn=com.nianticproject.ingress&isi=576505181&ibi=com.google.ingress&ifl=https%3a%2f%2fapps.apple.com%2fapp%2fingress%2fid576505181&ofl=https%3a%2f%2fintel.ingress.com%2fmission%2f${missions[currentMission].id}`;
    window.open(missionUrl, "_blank");
  };

  return (
    <div ref={overlayRef} className="overlay">
      <div className="overlay-controls">
        <button className="overlay-button-minus">-</button>
        <p>
          {currentMission !== 0
            ? `${currentMission}/${missionCount}`
            : `-/${missionCount}`}
        </p>
        <button className="overlay-button-plus" onClick={handleIncrement}>
          +
        </button>
      </div>
      <button className="start-button" onClick={handleStart}>
        START
      </button>
    </div>
  );
}
