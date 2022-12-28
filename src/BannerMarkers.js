import { useState, useEffect } from "react";
import { Popup, Marker, useMap } from "react-leaflet";

const BannerMarkers = () => {
  // https://api.bannergress.com/bnrs/second-sunday-eibergen-ladybugs-a2c0
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [items, setItems] = useState([]);

  // Note: the empty deps array [] means
  // this useEffect will run once
  // similar to componentDidMount()
  useEffect(() => {
    fetch(
      "https://api.bannergress.com/bnrs/second-sunday-eibergen-ladybugs-a2c0"
    )
      .then((res) => res.json())
      .then(
        (result) => {
          setIsLoaded(true);
          setItems(result);
        },
        // Note: it's important to handle errors here
        // instead of a catch() block so that we don't swallow
        // exceptions from actual bugs in components.
        (error) => {
          setIsLoaded(true);
          setError(error);
        }
      );
  }, []);

  if (error) {
    return;
  } else if (!isLoaded) {
    return;
  } else {
    for (const missionKey in items.missions) {
      const mission = items.missions[missionKey];
      for (const stepKey in mission.steps) {
        const step = mission.steps[stepKey];
        return (
          <Marker position={[step.poi.latitude, step.poi.longitude]}>
            <Popup>
              A pretty CSS3 popup. <br /> Easily customizable.
            </Popup>
          </Marker>
        );
      }
    }
    return;
  }
};

export default BannerMarkers;
