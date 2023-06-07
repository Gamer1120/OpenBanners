import { useState, useEffect } from "react";
import React from "react";
import Mission from "./Mission";
import { useParams } from "react-router-dom";
import MapOverlay from "./MapOverlay";

export default function BannerMarkers({
  bannerId,
  currentMission,
  setCurrentMission,
}) {
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    console.log(`Fetching data for bannerId: ${bannerId}`);
    fetch(`https://api.bannergress.com/bnrs/${bannerId}`)
      .then((res) => res.json())
      .then(
        (result) => {
          console.log("Result from Bannergress API:");
          console.log(result);
          setIsLoaded(true);
          setItems(result);
        },
        (error) => {
          setIsLoaded(true);
          setError(error);
        }
      );
  }, [bannerId]);

  if (error) {
    console.log(error);
    return null;
  } else if (!isLoaded) {
    console.log("not loaded");
    return null;
  } else {
    console.log("loaded");
    const missions = Object.values(items.missions);
    const missionCount = missions.length; // Get the mission count
    const rainbowColors = generateRainbowColors(missionCount);

    console.log("Number of missions:", missionCount); // Log the mission count

    return (
      <div>
        <MapOverlay
          missions={missions}
          currentMission={currentMission}
          setCurrentMission={setCurrentMission}
        />
        {missions.map((mission, index) => {
          const color = rainbowColors[index];
          return (
            <Mission
              key={mission.id}
              mission={mission}
              missionNumber={index + 1}
              color={color}
            />
          );
        })}
      </div>
    );
  }
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
