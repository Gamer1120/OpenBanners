import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import BannerMarkers from "./BannerMarkers";
import { useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
} from "@mui/material";
import BannerDetailsCard from "./BannerDetailsCard";
import BannerInfo from "./BannerInfo";
import L from "leaflet";
import { fetchBannergress } from "../bannergressSync";
import userLocationIcon from "../constants";
import "leaflet-easybutton/src/easy-button.css";

function BannerDetailsLocationControl({ onLocate, disabled = false }) {
  const map = useMap();
  const locationIconMarkup = `
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="#1976d2"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
    </svg>
  `;

  useEffect(() => {
    if (typeof L.control !== "function") {
      return undefined;
    }

    const control = L.control({ position: "topleft" });

    control.onAdd = () => {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control leaflet-control-custom"
      );
      const button = L.DomUtil.create("a", "", container);

      button.href = "#";
      button.title = "Show my location";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Show my location");
      button.innerHTML = locationIconMarkup;
      button.style.width = "30px";
      button.style.height = "30px";
      button.style.display = "flex";
      button.style.alignItems = "center";
      button.style.justifyContent = "center";
      button.style.background = "#fff";
      button.style.textDecoration = "none";
      button.style.cursor = disabled ? "progress" : "pointer";
      button.style.opacity = disabled ? "0.55" : "1";
      button.style.pointerEvents = disabled ? "none" : "auto";

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, "click", (event) => {
        L.DomEvent.stop(event);
        onLocate();
      });

      return container;
    };

    control.addTo(map);

    return () => {
      control.remove();
    };
  }, [map, onLocate, disabled, locationIconMarkup]);

  return null;
}

export default function BannerDetailsPage() {
  const { bannerId } = useParams();
  const isMobile = useMediaQuery("(max-width:768px)");

  const [items, setItems] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapInitialized, setMapInitialized] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [mobileTab, setMobileTab] = useState("overview");
  const [userLocation, setUserLocation] = useState(null);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [locationError, setLocationError] = useState("");
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const missions = useMemo(
    () => Object.values(items.missions ?? {}),
    [items.missions]
  );
  const missionCoordinates = useMemo(
    () =>
      missions.flatMap((mission) =>
        Object.values(mission.steps ?? {})
          .map((step) => {
            const latitude = Number(step?.poi?.latitude);
            const longitude = Number(step?.poi?.longitude);

            if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
              return [latitude, longitude];
            }

            return null;
          })
          .filter(Boolean)
      ),
    [missions]
  );
  const mapRenderKey = `${bannerId}-${missions.length}-${isMobile ? mobileTab : "desktop"}`;

  const refreshMapLayout = () => {
    if (!mapInitialized || !mapRef.current) {
      return;
    }

    mapRef.current.invalidateSize?.(false);

    if (!isLoading && missionCoordinates.length > 0) {
      const bounds = L.latLngBounds(missionCoordinates);
      mapRef.current.fitBounds?.(bounds, {
        padding: [50, 50],
        animate: missionCoordinates.length <= 100,
      });
    }
  };

  useEffect(() => {
    let ignore = false;

    const loadBanner = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetchBannergress(
          `https://api.bannergress.com/bnrs/${bannerId}`
        );
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
    refreshMapLayout();
  }, [isLoading, mapInitialized, missionCoordinates]);

  useEffect(() => {
    mapRef.current = null;
    setMapInitialized(false);
  }, [mapRenderKey]);

  useEffect(() => {
    if (!mapInitialized) {
      return undefined;
    }

    const invalidateMapSize = () => {
      refreshMapLayout();
    };

    const animationFrameId = window.requestAnimationFrame(invalidateMapSize);
    const timeoutId = window.setTimeout(invalidateMapSize, 150);
    let resizeObserver;

    if (
      typeof ResizeObserver !== "undefined" &&
      mapContainerRef.current
    ) {
      resizeObserver = new ResizeObserver(() => {
        invalidateMapSize();
      });
      resizeObserver.observe(mapContainerRef.current);
    } else {
      window.addEventListener("resize", invalidateMapSize);
    }

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", invalidateMapSize);
    };
  }, [mapInitialized, isLoading, missionCoordinates]);

  useEffect(() => {
    if (!isMobile && mobileTab !== "overview") {
      setMobileTab("overview");
    }
  }, [isMobile, mobileTab]);

  const showOverview = !isMobile || mobileTab === "overview";
  const showMap = !isMobile || mobileTab === "map";

  useEffect(() => {
    if (!showMap || !mapInitialized) {
      return undefined;
    }

    const animationFrameId = window.requestAnimationFrame(refreshMapLayout);
    const timeoutId = window.setTimeout(refreshMapLayout, 120);
    const secondTimeoutId = window.setTimeout(refreshMapLayout, 320);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      window.clearTimeout(secondTimeoutId);
    };
  }, [showMap, mapInitialized, isLoading, missionCoordinates]);

  const overviewContent = (
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
                  onClick={() => setReloadToken((currentValue) => currentValue + 1)}
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
  );

  const mapContent = (
    <div className="map-container" ref={mapContainerRef}>
      {locationError ? (
        <Box
          sx={{
            position: "absolute",
            zIndex: 1001,
            right: 16,
            top: 72,
            maxWidth: 260,
            bgcolor: "rgba(18, 18, 18, 0.92)",
            color: "#fff",
            px: 1.25,
            py: 0.9,
            borderRadius: 1,
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <Typography variant="caption">{locationError}</Typography>
        </Box>
      ) : null}
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
        key={mapRenderKey}
        id="map"
        center={[52.221058, 6.893297]}
        zoom={8}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
        ref={mapRef}
        preferCanvas={missionCoordinates.length > 200}
        dragging={!L.Browser.mobile}
        touchZoom={true}
        whenReady={({ target }) => {
          mapRef.current = target;
          setMapInitialized(true);
          window.requestAnimationFrame(() => {
            target.invalidateSize?.(false);

            if (!isLoading && missionCoordinates.length > 0) {
              const bounds = L.latLngBounds(missionCoordinates);
              target.fitBounds?.(bounds, {
                padding: [50, 50],
                animate: missionCoordinates.length <= 100,
              });
            }
          });
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BannerDetailsLocationControl
          disabled={isLocatingUser}
          onLocate={() => {
            if (!navigator.geolocation || isLocatingUser) {
              return;
            }

            setLocationError("");
            setIsLocatingUser(true);

            navigator.geolocation.getCurrentPosition(
              ({ coords }) => {
                const latitude = Number(coords?.latitude);
                const longitude = Number(coords?.longitude);

                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                  setLocationError("Couldn't determine your location.");
                  setIsLocatingUser(false);
                  return;
                }

                const nextLocation = { latitude, longitude };
                setUserLocation(nextLocation);
                setIsLocatingUser(false);
                mapRef.current?.panTo?.([latitude, longitude], {
                  animate: true,
                  duration: 0.35,
                });
              },
              () => {
                setLocationError(
                  "Couldn't determine your location. Please check browser location access."
                );
                setIsLocatingUser(false);
              },
              {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 10000,
              }
            );
          }}
        />
        <BannerMarkers missions={missions} showStepMarkers={true} />
        {userLocation ? (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={userLocationIcon}
            zIndexOffset={2000}
          />
        ) : null}
      </MapContainer>
    </div>
  );

  return (
    <div className="banner-details-page">
      {isMobile ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            height: "100%",
            minHeight: 0,
            width: "100%",
            overflow: "hidden",
          }}
        >
          <Tabs
            value={mobileTab}
            onChange={(_, nextTab) => setMobileTab(nextTab)}
            aria-label="Banner detail sections"
            variant="fullWidth"
            sx={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              px: 1,
              pt: 1,
              bgcolor: "rgba(11, 16, 20, 0.96)",
              backdropFilter: "blur(10px)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <Tab label="Overview" value="overview" />
            <Tab label="Map" value="map" disabled={Boolean(error)} />
          </Tabs>
          <Box
            sx={{
              flex: showOverview ? 1 : 0,
              minHeight: 0,
              display: showOverview ? "block" : "none",
              overflowY: showOverview ? "auto" : "hidden",
            }}
          >
            {showOverview ? overviewContent : null}
          </Box>
          <Box
            sx={{
              flex: showMap ? 1 : 0,
              minHeight: 0,
              display: showMap ? "block" : "none",
              overflow: "hidden",
            }}
          >
            {showMap ? mapContent : null}
          </Box>
        </Box>
      ) : (
        <>
          {overviewContent}
          {mapContent}
        </>
      )}
    </div>
  );
}
