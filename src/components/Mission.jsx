import React, { useMemo } from "react";
import MissionStepMarker from "./MissionStepMarker";
import { Polyline } from "react-leaflet";

function compressPolylinePositions(positions, maxPoints) {
  if (positions.length <= maxPoints) {
    return positions;
  }

  const lastIndex = positions.length - 1;
  const compressedPositions = [positions[0]];

  for (let index = 1; index < maxPoints - 1; index += 1) {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    compressedPositions.push(positions[sourceIndex]);
  }

  compressedPositions.push(positions[lastIndex]);

  return compressedPositions;
}

function Mission({
  mission,
  missionNumber,
  color,
  showStepMarkers = true,
}) {
  const stepsToRender = useMemo(
    () =>
      Object.values(mission.steps ?? {}).filter(
        (step) => step.poi.type !== "unavailable"
      ),
    [mission.steps]
  );

  const polylinePositions = useMemo(
    () =>
      stepsToRender.map((step) => [step.poi.latitude, step.poi.longitude]),
    [stepsToRender]
  );
  const overviewPolylinePositions = useMemo(
    () => compressPolylinePositions(polylinePositions, 24),
    [polylinePositions]
  );
  const markerSteps = showStepMarkers ? stepsToRender : stepsToRender.slice(0, 1);
  const positionsToRender = showStepMarkers
    ? polylinePositions
    : overviewPolylinePositions;

  return (
    <div>
      {markerSteps.map((step, index) => (
        <MissionStepMarker
          key={step.poi.title}
          portalName={step.poi.title}
          latitude={step.poi.latitude}
          longitude={step.poi.longitude}
          missionNumber={missionNumber}
          color={color}
          isFirst={index === 0}
          interactive={showStepMarkers}
        />
      ))}
      <Polyline positions={positionsToRender} color={color} smoothFactor={4} />
    </div>
  );
}

export default React.memo(Mission);
