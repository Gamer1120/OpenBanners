import React, { useState } from "react";

export default function MapOverlay({ missionCount }) {
  const [currentMission, setCurrentMission] = useState(1);

  const handleIncrement = () => {
    setCurrentMission((prevMission) => prevMission + 1);
  };

  return (
    <div className="overlay">
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
