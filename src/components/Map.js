import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import { useState, useEffect, useRef } from "react";
import L from "leaflet";

const Map = () => {
  const [visibleArea, setVisibleArea] = useState(null);
  const [banners, setBanners] = useState([]);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    console.log("visible area");
    console.log(visibleArea);
    if (mapRef.current && visibleArea) {
      const { minLatitude, maxLatitude, minLongitude, maxLongitude } =
        visibleArea;

      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&minLatitude=${minLatitude}&maxLatitude=${maxLatitude}&minLongitude=${minLongitude}&maxLongitude=${maxLongitude}&limit=100`;

      console.log("API URL:", apiUrl);

      fetch(apiUrl)
        .then((response) => response.json())
        .then((data) => {
          console.log(data);
          setBanners(data);
        })
        .catch((error) => {
          console.error("Error fetching banners:", error);
        });
    }
  }, [visibleArea, mapLoaded]);

  const handleMapLoaded = () => {
    setMapLoaded(true);
  };

  const MapEvents = () => {
    useMapEvents({
      moveend: () => {
        if (mapRef.current) {
          const bounds = mapRef.current.getBounds();
          const { _southWest, _northEast } = bounds;
          const { lat: minLatitude, lng: minLongitude } = _southWest;
          const { lat: maxLatitude, lng: maxLongitude } = _northEast;

          setVisibleArea({
            minLatitude,
            maxLatitude,
            minLongitude,
            maxLongitude,
          });
        }
      },
    });

    return null;
  };
  return (
    <div>
      <MapContainer
        id="map"
        center={[52.221058, 6.893297]}
        zoom={15}
        scrollWheelZoom={true}
        ref={mapRef}
        whenReady={handleMapLoaded}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {banners.map((banner) => (
          <Marker
            key={banner.id}
            position={[banner.startLatitude, banner.startLongitude]}
            icon={L.icon({
              iconUrl: `https://api.bannergress.com${banner.picture}`,
              iconSize: [100, "auto"],
            })}
          />
        ))}

        <MapEvents />
      </MapContainer>
    </div>
  );
};

export default Map;
