import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams } from "react-router-dom";
import MapOverlay from "./MapOverlay";
import { useState, useEffect, useRef } from "react";
import YellowArrow from "./YellowArrow";

export default function Map() {
  const { bannerId } = useParams();

  const [currentMission, setCurrentMission] = useState(0);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const mapRef = useRef(null);

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

  const missions = Object.values(items.missions);
  const missionsVisible = missions.filter(
    (_, index) =>
      currentMission === 0 ||
      index === currentMission ||
      index + 1 === currentMission ||
      currentMission === missions.length
  );

  const firstMissionStepMarker =
    missionsVisible.length > 0 ? missionsVisible[0].steps[0].poi : null;

  return (
    <div>
      <MapContainer
        ref={mapRef}
        id="map"
        center={[52.221058, 6.893297]}
        zoom={8}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BannerMarkers
          missions={missionsVisible}
          currentMission={currentMission}
        />
        <LocationMarker />
        {firstMissionStepMarker && (
          <YellowArrow
            direction={calculateArrowDirection(firstMissionStepMarker)}
            map={mapRef.current?.leafletElement}
          />
        )}
      </MapContainer>
      <MapOverlay
        missions={Object.values(items.missions)}
        currentMission={currentMission}
        setCurrentMission={setCurrentMission}
      />
    </div>
  );
}

function calculateArrowDirection(marker) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return 0;

  const mapRect = mapElement.getBoundingClientRect();
  const markerPosition = mapElement.latLngToLayerPoint([
    marker.latitude,
    marker.longitude,
  ]);
  const mapCenter = [mapRect.width / 2, mapRect.height / 2];

  const dx = markerPosition.x - mapCenter[0];
  const dy = markerPosition.y - mapCenter[1];

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return angle;
}
