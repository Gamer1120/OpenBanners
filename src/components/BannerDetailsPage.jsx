import { MapContainer, TileLayer } from "react-leaflet";
import BannerMarkers from "./BannerMarkers";
import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import BannerDetailsCard from "./BannerDetailsCard";
import BannerInfo from "./BannerInfo";
import L from "leaflet";

export default function BannerDetailsPage() {
  const { bannerId } = useParams();

  const [items, setItems] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapInitialized, setMapInitialized] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const mapRef = useRef(null);

  useEffect(() => {
    let ignore = false;

    const loadBanner = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`https://api.bannergress.com/bnrs/${bannerId}`);
        const result = await response.json();

        if (!ignore) {
          if (result && typeof result === "object" && result.id) {
            setItems(result);
          } else {
            setItems({});
            setError("Couldn't load this banner.");
          }
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setItems({});
          setError("Couldn't load this banner. Please try again.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    loadBanner();

    return () => {
      ignore = true;
    };
  }, [bannerId, reloadToken]);

  useEffect(() => {
    if (!isLoading && items.missions && mapInitialized) {
      const missionCoordinates = Object.values(items.missions)
        .flatMap((mission) =>
          Object.values(mission.steps ?? {})
            .map((step) => {
              const latitude = step?.poi?.latitude;
              const longitude = step?.poi?.longitude;

              if (latitude && longitude) {
                return [latitude, longitude];
              }

              return null;
            })
            .filter(Boolean)
        )
        .filter((coord) => coord !== null);

      if (missionCoordinates.length > 0) {
        const bounds = L.latLngBounds(missionCoordinates);
        mapRef.current?.fitBounds(bounds, {
          padding: [50, 50],
          animate: true,
        });
      }
    }
  }, [isLoading, items.missions, mapInitialized]);

  return (
    <div className="banner-details-page">
      <div className="banner-details-container">
        <div className="banner-details-card">
          {error ? (
            <Box sx={{ p: 2 }}>
              <Alert
                severity="error"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() =>
                      setReloadToken((currentValue) => currentValue + 1)
                    }
                  >
                    Retry
                  </Button>
                }
              >
                {error}
              </Alert>
            </Box>
          ) : (
            <>
              <BannerDetailsCard banner={items} loading={isLoading} />
              <BannerInfo banner={items} loading={isLoading} />
            </>
          )}
        </div>
      </div>
      <div className="map-container">
        {isLoading && (
          <Box
            sx={{
              position: "absolute",
              zIndex: 1000,
              left: 16,
              top: 16,
              bgcolor: "rgba(18, 18, 18, 0.9)",
              color: "#fff",
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
            }}
          >
            <Typography variant="body2">Loading map details...</Typography>
          </Box>
        )}
        <MapContainer
          id="map"
          center={[52.221058, 6.893297]}
          zoom={8}
          scrollWheelZoom={true}
          style={{ height: "100vh" }}
          ref={mapRef}
          dragging={!L.Browser.mobile}
          touchZoom={true}
          whenReady={() => setMapInitialized(true)}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <BannerMarkers
            missions={items.missions ? Object.values(items.missions) : []}
          />
        </MapContainer>
      </div>
    </div>
  );
}
