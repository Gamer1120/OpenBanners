import React from "react";

export default function MapOverlay() {
  return (
    <div className="overlay">
      <div className="overlay-controls">
        <button className="overlay-button-minus">-</button>
        <p>text</p>
        <button className="overlay-button-plus">+</button>
      </div>
      <button className="start-button">START</button>
    </div>
  );
}
