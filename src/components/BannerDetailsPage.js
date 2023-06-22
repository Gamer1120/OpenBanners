import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import BannerDetailsCard from "./BannerDetailsCard";
import BannerInfo from "./BannerInfo";
import L from "leaflet";

export default function BannerDetailsPage() {
  const { bannerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation(); // Access the current location

  const [currentMission, setCurrentMission] = useState(0);
  const [items, setItems] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isMapVisible, setIsMapVisible] = useState(false);
  const mapRef = useRef(null);

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
    navigate(`?currentMission=${currentMission}`);
  }, [currentMission]);

      if (missionCoordinates.length > 0) {
        const bounds = L.latLngBounds(missionCoordinates);
        mapRef.current?.fitBounds(bounds, {
          padding: [50, 50],
          animate: true,
        });
        setIsMapVisible(true); // Set the flag to true when the map should be visible
      }
    }
  }, [location]);

  useEffect(() => {
    console.log("is loading changed: " + isLoading);
  }, [isLoading]);

  useEffect(() => {
    console.log("items changed: " + items);
  }, [items]);

  useEffect(() => {
    console.log("items.missions changed: " + items.missions);
  }, [items.missions]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="banner-details-page">
      <div className="banner-details-container">
        <div className="banner-details-card">
          <BannerDetailsCard banner={items} />
          <BannerInfo banner={items} />
        </div>
      </div>
      <div className="map-container">
        {isMapVisible && ( // Render the map only if isMapVisible is true
          <MapContainer
            id="map"
            center={[52.221058, 6.893297]}
            zoom={8}
            scrollWheelZoom={true}
            style={{ height: "100vh" }}
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <BannerMarkers
              missions={items.missions ? Object.values(items.missions) : []}
            />
          </MapContainer>
        )}
      </div>
    </div>
  );
}
