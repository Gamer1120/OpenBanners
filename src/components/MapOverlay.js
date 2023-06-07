import React, { useState, useEffect, useRef } from "react";

export default function MapOverlay({ missionCount }) {
  const [currentMission, setCurrentMission] = useState(1);
  const overlayRef = useRef(null);

  const handleIncrement = () => {
    setCurrentMission((prevMission) => prevMission + 1);
  };

  useEffect(() => {
    const handleOverlayMouseEvents = (event) => {
      event.stopPropagation(); // Stop the propagation of all mouse events
    };

    if (overlayRef.current) {
      overlayRef.current.addEventListener(
        "mousedown",
        handleOverlayMouseEvents
      );
      overlayRef.current.addEventListener("mouseup", handleOverlayMouseEvents);
      overlayRef.current.addEventListener("click", handleOverlayMouseEvents);
      overlayRef.current.addEventListener("dblclick", handleOverlayMouseEvents);
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
        // Remove more mouse events as needed
      }
    };
  }, []);

  return (
    <div ref={overlayRef} className="overlay">
      <div className="overlay-controls">
        <button className="overlay-button-minus">-</button>
        <p>
          {currentMission}/{missionCount}
        </p>
        <button className="overlay-button-plus" onClick={handleIncrement}>
          +
        </button>
      </div>
      <button className="start-button">START</button>
    </div>
  );
}
