import { useState, useEffect } from "react";
import React from "react";
import Mission from "./Mission";
import { useParams } from "react-router-dom";
import { schemeCategory10 } from "d3-scale-chromatic";

export default function BannerMarkers({ bannerId }) {
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
    const numMissions = Object.values(items.missions).length;

    return (
      <div>
        {Object.values(items.missions).map((mission, index) => {
          const color =
            schemeCategory10[
              Math.floor((index / numMissions) * schemeCategory10.length)
            ];
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
