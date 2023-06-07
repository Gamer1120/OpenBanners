import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams } from "react-router-dom";
import MapOverlay from "./MapOverlay";
import { useState } from "react";

export default function Map() {
  const { bannerId } = useParams();

  const [currentMission, setCurrentMission] = useState(0);

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
          currentMission={currentMission}
          setCurrentMission={setCurrentMission}
        />
        <LocationMarker />
      </MapContainer>
    </div>
  );
}
