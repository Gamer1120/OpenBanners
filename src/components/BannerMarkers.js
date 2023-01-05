import { useState, useEffect } from "react";
import React from "react";
import Mission from "./Mission";

export default function BannerMarkers() {
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch(
      "https://api.bannergress.com/bnrs/christmas-gnomes-2dbe"
    )
      .then((res) => res.json())
      .then(
        (result) => {
          setIsLoaded(true);
          setItems(result);
        },
        (error) => {
          setIsLoaded(true);
          setError(error);
        }
      );
  }, []);

  if (error) {
    console.log(error);
    return;
  } else if (!isLoaded) {
    console.log("not loaded");
    return;
  } else {
    console.log("loaded");
    return (
      <div>
        {Object.values(items.missions).map((mission) => {
          return <Mission key={mission.id} mission={mission} />;
        })}
      </div>
    );
  }
}
