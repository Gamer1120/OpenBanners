import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import { Link } from "react-router-dom";

const Map = () => {
  const [visibleArea, setVisibleArea] = useState(null);
  const [banners, setBanners] = useState([]);
  const mapRef = useRef(null);

  const fetchBanners = async (area) => {
    const { minLatitude, maxLatitude, minLongitude, maxLongitude } = area;

    const apiUrl = `https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&minLatitude=${minLatitude}&maxLatitude=${maxLatitude}&minLongitude=${minLongitude}&maxLongitude=${maxLongitude}&limit=100`;

    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      setBanners(data);
    } catch (error) {
      console.error("Error fetching banners:", error);
    }
  };

  useEffect(() => {
    if (mapRef.current && visibleArea) {
      fetchBanners(visibleArea);
    }
  }, [mapRef.current, visibleArea]);

  const MapEvents = () => {
    useMapEvents({
      moveend: () => {
        if (mapRef.current) {
          console.log("yep");
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
      load: () => {
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

  const getMarkerIcon = (imageUrl) => {
    const maxWidth = 100;
    const image = new Image();
    image.src = imageUrl;

    const ratio = image.width / image.height;
    const height = maxWidth / ratio;

    const icon = L.icon({
      iconUrl: imageUrl,
      iconSize: [maxWidth, height],
      iconAnchor: [maxWidth / 2, height],
    });

    return icon;
  };

  const handleMapReady = () => {
    console.log("map ready");
    console.log(mapRef);
    // fetchBanners(visibleArea);
  };

  useEffect(() => {
    console.log("map ref changed");
    console.log(mapRef.current);
  }, [mapRef.current]);

  return (
    <div>
      <MapContainer
        id="map"
        center={[52.221058, 6.893297]}
        zoom={15}
        scrollWheelZoom={true}
        ref={mapRef}
        whenReady={handleMapReady}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {banners.map((banner) => {
          const latitude = parseFloat(banner.startLatitude);
          const longitude = parseFloat(banner.startLongitude);

          if (isNaN(latitude) || isNaN(longitude)) {
            console.error(
              "Invalid coordinates:",
              banner.startLatitude,
              banner.startLongitude
            );
            return null;
          }

          return (
            <Link to={`/banners/${banner.id}`} key={banner.id}>
              <Marker
                position={[latitude, longitude]}
                icon={getMarkerIcon(
                  `https://api.bannergress.com${banner.picture}`
                )}
              />
            </Link>
          );
        })}

        <MapEvents />
      </MapContainer>
    </div>
  );
};

export default Map;
