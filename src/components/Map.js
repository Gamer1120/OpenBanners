import { MapContainer, TileLayer } from "react-leaflet";
import LocationMarker from "./LocationMarker";
import BannerMarkers from "./BannerMarkers";
import { useParams } from "react-router-dom";

export default function Map() {
  const { bannerId } = useParams();

  return (
    <MapContainer
      id="map"
      center={[52.221058, 6.893297]}
      zoom={14}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <BannerMarkers bannerId={bannerId} />
      <LocationMarker />
    </MapContainer>
  );
}
