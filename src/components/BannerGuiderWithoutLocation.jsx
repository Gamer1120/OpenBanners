import { MapContainer, TileLayer } from "react-leaflet";
import BannerMarkers from "./BannerMarkers";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import MapOverlay from "./MapOverlay";
import { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { fetchBannergress } from "../bannergressSync";

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
  const missions = useMemo(
    () => Object.values(items.missions ?? {}),
    [items.missions]
  );
  const missionCoordinates = useMemo(
    () =>
      missions
        .map((mission) => {
          const poi = mission.steps?.[0]?.poi;
          if (!poi) {
            return null;
          }
          const latitude = Number(poi.latitude);
          const longitude = Number(poi.longitude);

          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            return [latitude, longitude];
          }

          return null;
        })
        .filter(Boolean),
    [missions]
  );
  useEffect(() => {
    fetchBannergress(`https://api.bannergress.com/bnrs/${bannerId}`)
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
    if (!isLoading && mapRef.current && mapInitialized && missionCoordinates.length > 0) {
        const bounds = L.latLngBounds(missionCoordinates);
        mapRef.current.fitBounds(bounds, {
          padding: [50, 50],
          animate: missionCoordinates.length <= 100,
        });
    }
  }, [isLoading, mapInitialized, missionCoordinates]);

  if (isLoading) {
    return <div className="banner-guider-shell">Loading...</div>;
  }

  const handleMapContainerReady = () => {
    setMapInitialized(true);
  };

  return (
    <div className="banner-guider-shell">
      <MapContainer
        ref={mapRef}
        id="map"
        center={[52.221058, 6.893297]}
        zoom={15}
        zoomControl={!L.Browser.mobile}
        scrollWheelZoom={true}
        whenReady={handleMapContainerReady}
        preferCanvas={missionCoordinates.length > 200}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BannerMarkers
          missions={missions}
          currentMission={currentMission}
          showStepMarkers={true}
        />
      </MapContainer>
      <MapOverlay
        missions={missions}
        currentMission={currentMission}
        setCurrentMission={setCurrentMission}
        bannerId={bannerId}
      />
    </div>
  );
}
