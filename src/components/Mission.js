import React from "react";
import MissionStepMarker from "./MissionStepMarker";
import { Polyline } from "react-leaflet";

export default function Mission({ mission, missionNumber }) {
  console.log("current mission:");
  console.log(mission);

  const stepsToRender = Object.values(mission.steps).filter(
    (step) => step.poi.type !== "unavailable"
  );

  const polylinePositions = stepsToRender.map((step) => [
    step.poi.latitude,
    step.poi.longitude,
  ]);

  return (
    <div>
      {stepsToRender.map((step) => (
        <MissionStepMarker
          key={step.poi.id}
          latitude={step.poi.latitude}
          longitude={step.poi.longitude}
          missionNumber={missionNumber}
        />
      ))}
      <Polyline positions={polylinePositions} />
    </div>
  );
}
