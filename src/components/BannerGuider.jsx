import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import MapOverlay from "./MapOverlay";
import { useState, useEffect, useRef } from "react";
import L from "leaflet";

export default function Map() {
  const { bannerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation(); // Access the current location

  // Parse the 'currentMission' query parameter from the URL
  const searchParams = new URLSearchParams(location.search);
  const missionParam = searchParams.get("currentMission");

  // Initialize 'currentMission' from the URL query parameter or localStorage, or default to 0
  const [currentMission, setCurrentMission] = useState(
    missionParam
      ? parseInt(missionParam)
      : localStorage.getItem("currentMission")
      ? parseInt(localStorage.getItem("currentMission"))
      : 0
  );

  const [items, setItems] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const mapRef = useRef(null);
  const [mapInitialized, setMapInitialized] = useState(false);

  useEffect(() => {
    fetch(`https://api.bannergress.com/bnrs/${bannerId}`)
      .then((res) => res.json())
      .then(
        (result) => {
          setItems(result);
          setIsLoading(false);
        },
        (error) => {
          console.log(error);
        }
      );
  }, [bannerId]);

  useEffect(() => {
    // Update the URL with the new 'currentMission' value
    navigate(`?currentMission=${currentMission}`);
  }, [navigate, currentMission]);

  useEffect(() => {
    if (!isLoading && mapRef.current && items.missions && mapInitialized) {
      const missionCoordinates = Object.values(items.missions)
        .map((mission) => {
          const { poi } = mission.steps[0];
          const latitude = poi.latitude;
          const longitude = poi.longitude;
          if (latitude && longitude) {
            return [latitude, longitude];
          }
          return null;
        })
        .filter((coord) => coord !== null);

      if (missionCoordinates.length > 0) {
        const bounds = L.latLngBounds(missionCoordinates);
        mapRef.current.fitBounds(bounds, {
          padding: [50, 50],
          animate: true,
        });
      }
    }
  }, [isLoading, items.missions, mapInitialized]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

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
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BannerMarkers
          missions={items.missions ? Object.values(items.missions) : []}
          currentMission={currentMission}
        />
        <LocationMarker />
      </MapContainer>
      <MapOverlay
        missions={items.missions ? Object.values(items.missions) : []}
        currentMission={currentMission}
        setCurrentMission={setCurrentMission}
        bannerId={bannerId}
      />
    </div>
  );
}
