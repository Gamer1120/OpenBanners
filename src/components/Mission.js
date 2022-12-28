import React from "react";
import MissionStepMarker from "./MissionStepMarker";

export default function Mission(props) {
  return Object.values(props.mission.steps).map((step) => {
    return (
      <MissionStepMarker
        key={step.poi.id}
        latitude={step.poi.latitude}
        longitude={step.poi.longitude}
      />
    );
  });
}
