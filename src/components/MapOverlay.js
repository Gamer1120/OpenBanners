import React, { useState, useEffect, useRef } from "react";

export default function MapOverlay({ missionCount }) {
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
      }
    };
  }, [currentMission]);

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
      <button className="start-button">START</button>
    </div>
  );
}
