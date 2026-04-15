import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import { Link } from "react-router-dom";

function getVisibleAreaFromBounds(bounds) {
  const { _southWest, _northEast } = bounds;
  const { lat: minLatitude, lng: minLongitude } = _southWest;
  const { lat: maxLatitude, lng: maxLongitude } = _northEast;

  return {
    minLatitude,
    maxLatitude,
    minLongitude,
    maxLongitude,
  };
}

const Map = () => {
  const [visibleArea, setVisibleArea] = useState(null);
  const [banners, setBanners] = useState([]);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!visibleArea) {
      return;
    }

    let ignore = false;

    const fetchBanners = async () => {
      const { minLatitude, maxLatitude, minLongitude, maxLongitude } =
        visibleArea;
      const apiUrl = `https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&minLatitude=${minLatitude}&maxLatitude=${maxLatitude}&minLongitude=${minLongitude}&maxLongitude=${maxLongitude}&limit=100`;

      try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!ignore) {
          setBanners(data);
        }
      } catch (error) {
        if (!ignore) {
          console.error("Error fetching banners:", error);
        }
      }
    };

    fetchBanners();

    return () => {
      ignore = true;
    };
  }, [visibleArea]);

  const updateVisibleArea = (mapInstance) => {
    if (!mapInstance) {
      return;
    }

    mapRef.current = mapInstance;
    const nextVisibleArea = getVisibleAreaFromBounds(mapInstance.getBounds());

    setVisibleArea((currentVisibleArea) => {
      if (
        currentVisibleArea &&
        currentVisibleArea.minLatitude === nextVisibleArea.minLatitude &&
        currentVisibleArea.maxLatitude === nextVisibleArea.maxLatitude &&
        currentVisibleArea.minLongitude === nextVisibleArea.minLongitude &&
        currentVisibleArea.maxLongitude === nextVisibleArea.maxLongitude
      ) {
        return currentVisibleArea;
      }

      return nextVisibleArea;
    });
  };

  const MapEvents = () => {
    useMapEvents({
      moveend: (event) => {
        updateVisibleArea(event.target);
      },
      load: (event) => {
        updateVisibleArea(event.target);
      },
    });

    return null;
  };

  const getMarkerIcon = (imageUrl) => {
    const width = 100;
    const height = 150;

    const icon = L.divIcon({
      html: `
        <div style="width:${width}px;height:${height}px;display:flex;align-items:flex-end;justify-content:center;">
          <img
            src="${imageUrl}"
            alt=""
            style="width:${width}px;height:${height}px;object-fit:contain;display:block;"
          />
        </div>
      `,
      className: "banner-map-icon",
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
    });

    return icon;
  };

  return (
    <div>
      <MapContainer
        id="map"
        center={[52.221058, 6.893297]}
        zoom={15}
        scrollWheelZoom={true}
        ref={mapRef}
        whenReady={(event) => updateVisibleArea(event.target)}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
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
            <Link to={`/banner/${banner.id}`} key={banner.id}>
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
