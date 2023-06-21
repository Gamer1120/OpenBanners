import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import BannerDetailsCard from "./BannerDetailsCard";
import BannerInfo from "./BannerInfo";

export default function BannerDetailsPage() {
  const { bannerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation(); // Access the current location

  const [currentMission, setCurrentMission] = useState(0);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`https://api.bannergress.com/bnrs/${bannerId}`)
      .then((res) => res.json())
      .then(
        (result) => {
          setItems(result);
          console.log("items");
          console.log(result);
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

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const missionParam = searchParams.get("currentMission");
    if (missionParam !== null) {
      setCurrentMission(parseInt(missionParam));
    }
  }, [location]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ display: "flex" }}>
      <div style={{ flex: "2" }}>
        <BannerDetailsCard banner={items} />
        <BannerInfo description={items.description} />
      </div>
      <div style={{ flex: "3" }}>
        <MapContainer
          id="map"
          center={[52.221058, 6.893297]}
          zoom={8}
          scrollWheelZoom={true}
          style={{ height: "100vh" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <BannerMarkers
            missions={Object.values(items.missions)}
            currentMission={currentMission}
          />
          <LocationMarker />
        </MapContainer>
      </div>
    </div>
  );
}
