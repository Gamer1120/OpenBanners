import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams } from "react-router-dom";
import MapOverlay from "./MapOverlay";
import { useState, useEffect } from "react";

export default function Map() {
  const { bannerId } = useParams();

  const [currentMission, setCurrentMission] = useState(0);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    console.log(`Fetching data for bannerId: ${bannerId}`);
    fetch(`https://api.bannergress.com/bnrs/${bannerId}`)
      .then((res) => res.json())
      .then(
        (result) => {
          console.log("Result from Bannergress API:");
          console.log(result);
          setItems(result);
          setIsLoading(false);
        },
        (error) => {
          console.log(error);
        }
      );
  }, [bannerId]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <MapContainer
        id="map"
        center={[52.221058, 6.893297]}
        zoom={15}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BannerMarkers
          bannerId={bannerId}
          missions={Object.values(items.missions)}
          currentMission={currentMission}
          setCurrentMission={setCurrentMission}
        />
        <LocationMarker />
      </MapContainer>
    </div>
  );
}
