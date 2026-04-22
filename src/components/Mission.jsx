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
    () => {
      return Object.values(mission.steps ?? {}).flatMap((step, index) => {
        const poi = step?.poi;
        const latitude = Number(poi?.latitude);
        const longitude = Number(poi?.longitude);

        if (
          !poi ||
          poi.type === "unavailable" ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          return [];
        }

        return [
          {
            key:
              typeof poi.id === "string" && poi.id.length > 0
                ? poi.id
                : `${mission.id ?? missionNumber}-${index}-${latitude}-${longitude}`,
            title:
              typeof poi.title === "string" && poi.title.length > 0
                ? poi.title
                : `Mission ${missionNumber} step ${index + 1}`,
            latitude,
            longitude,
          },
        ];
      });
    },
    [mission.steps]
  );

  const polylinePositions = useMemo(
    () => stepsToRender.map((step) => [step.latitude, step.longitude]),
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
          key={step.key}
          portalName={step.title}
          latitude={step.latitude}
          longitude={step.longitude}
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
