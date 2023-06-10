import { useState, useEffect } from "react";
import React from "react";
import Mission from "./Mission";
import { useParams } from "react-router-dom";
import MapOverlay from "./MapOverlay";

export default function BannerMarkers({ missions, currentMission }) {
  const missionCount = missions.length; // Get the mission count
  const rainbowColors = generateRainbowColors(missionCount);

  return (
    <div>
      {missions.map((mission, index) => {
        if (
          currentMission === 0 ||
          index === currentMission ||
          index + 1 === currentMission ||
          currentMission === missionCount
        ) {
          const color = rainbowColors[index];
          return (
            <Mission
              key={mission.id}
              mission={mission}
              missionNumber={index + 1}
              color={color}
            />
          );
        }
      })}
    </div>
  );
}

function generateRainbowColors(count) {
  const colors = [];
  const increment = 360 / count;

  for (let i = 0; i < count; i++) {
    const hue = (i * increment) % 360;
    const color = `hsl(${hue}, 100%, 50%)`;
    colors.push(color);
  }

  return colors;
}
