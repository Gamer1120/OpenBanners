import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import MapOverlay from "./MapOverlay";
import { useState, useEffect, useRef } from "react";
import L from "leaflet";

export default function Map() {
  const mapRef = useRef(null);
  const [mapInitialized, setMapInitialized] = useState(false);

  const handleMapContainerReady = () => {
    setMapInitialized(true);
  };

  return (
    <div>
      <MapContainer
        ref={mapRef}
        id="map"
        center={[52.221058, 6.893297]}
        zoom={15}
        scrollWheelZoom={true}
        whenReady={handleMapContainerReady}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </MapContainer>
    </div>
  );
}
