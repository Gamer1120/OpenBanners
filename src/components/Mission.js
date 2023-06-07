import React from "react";
import MissionStepMarker from "./MissionStepMarker";

export default function Mission({ mission }) {
  const stepsToRender = Object.values(mission.steps).filter(
    (step) => step.poi.type !== "unavailable"
  );

  return (
    <div>
      {stepsToRender.map((step) => (
        <MissionStepMarker
          key={step.poi.id}
          latitude={step.poi.latitude}
          longitude={step.poi.longitude}
        />
      ))}
    </div>
  );
}
