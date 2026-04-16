import {
  MapContainer,
  Marker,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchBannergress, useBannergressSync } from "../bannergressSync";
import BannerFilterButton from "./BannerFilterButton";
import {
  applyBannerFilters,
  DEFAULT_BANNER_FILTERS,
  getMissionCountBounds,
} from "../bannerFilters";

const DEFAULT_CENTER = [52.221058, 6.893297];
const DEFAULT_ZOOM = 15;
const DISCOVERY_MAP_CACHE_TTL_MS = 2 * 60 * 1000;
const DISCOVERY_MAP_QUERY_PRECISION = 3;
const IMAGE_SIZE_STORAGE_KEY = "openbanners.discoveryMap.imageSize";
const IMAGE_SIZE_PRESETS = {
  small: { label: "Small", scale: 1.4 },
  medium: { label: "Medium", scale: 2 },
  large: { label: "Large", scale: 2.6 },
};
const CUSTOM_IMAGE_SCALE_MIN = 0.7;
const CUSTOM_IMAGE_SCALE_MAX = 5;
const CUSTOM_IMAGE_SCALE_STEP = 0.05;
const DISAMBIGUATION_TOUCH_PADDING = 12;
const discoveryMapCache = new globalThis.Map();
const discoveryMapInflightRequests = new globalThis.Map();
const bannerMarkerIconCache = new globalThis.Map();

function roundCoordinate(value, precision = DISCOVERY_MAP_QUERY_PRECISION) {
  return Number.parseFloat(value.toFixed(precision));
}

function normalizeVisibleArea(visibleArea) {
  if (!visibleArea) {
    return null;
  }

  return {
    minLatitude: roundCoordinate(visibleArea.minLatitude),
    maxLatitude: roundCoordinate(visibleArea.maxLatitude),
    minLongitude: roundCoordinate(visibleArea.minLongitude),
    maxLongitude: roundCoordinate(visibleArea.maxLongitude),
    centerLatitude: roundCoordinate(visibleArea.centerLatitude),
    centerLongitude: roundCoordinate(visibleArea.centerLongitude),
  };
}

function normalizeOriginLocation(location, fallbackArea) {
  const latitude = location?.latitude ?? fallbackArea?.centerLatitude;
  const longitude = location?.longitude ?? fallbackArea?.centerLongitude;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  };
}

function createDiscoveryMapQueryKey(visibleArea, originLocation) {
  if (!visibleArea || !originLocation) {
    return "";
  }

  return [
    visibleArea.minLatitude,
    visibleArea.maxLatitude,
    visibleArea.minLongitude,
    visibleArea.maxLongitude,
    originLocation.latitude,
    originLocation.longitude,
  ].join(":");
}

function normalizeFetchedBanners(data, originLatitude, originLongitude) {
  if (!Array.isArray(data)) {
    return null;
  }

  return data
    .map((banner) => {
      const latitude = Number.parseFloat(banner.startLatitude);
      const longitude = Number.parseFloat(banner.startLongitude);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        ...banner,
        _latitude: latitude,
        _longitude: longitude,
        _distanceMeters: calculateDistanceMeters(
          originLatitude,
          originLongitude,
          latitude,
          longitude
        ),
      };
    })
    .filter(Boolean)
    .sort((bannerA, bannerB) => bannerA._distanceMeters - bannerB._distanceMeters);
}

export function __resetDiscoveryMapCacheForTests() {
  discoveryMapCache.clear();
  discoveryMapInflightRequests.clear();
  bannerMarkerIconCache.clear();
}

function readInitialImageSizePreference() {
  if (typeof window === "undefined") {
    return { mode: "medium", customScale: IMAGE_SIZE_PRESETS.medium.scale };
  }

  try {
    const storedPreference = JSON.parse(
      window.localStorage.getItem(IMAGE_SIZE_STORAGE_KEY) ?? "null"
    );
    const mode = storedPreference?.mode;
    const customScale = Number(storedPreference?.customScale);

    return {
      mode:
        mode === "small" || mode === "medium" || mode === "large" || mode === "custom"
          ? mode
          : "medium",
      customScale:
        Number.isFinite(customScale) &&
        customScale >= CUSTOM_IMAGE_SCALE_MIN &&
        customScale <= CUSTOM_IMAGE_SCALE_MAX
          ? customScale
          : IMAGE_SIZE_PRESETS.medium.scale,
    };
  } catch {
    return { mode: "medium", customScale: IMAGE_SIZE_PRESETS.medium.scale };
  }
}

function getVisibleAreaFromBounds(bounds) {
  const { _southWest, _northEast } = bounds;
  const { lat: minLatitude, lng: minLongitude } = _southWest;
  const { lat: maxLatitude, lng: maxLongitude } = _northEast;

  return {
    minLatitude,
    maxLatitude,
    minLongitude,
    maxLongitude,
    centerLatitude: (minLatitude + maxLatitude) / 2,
    centerLongitude: (minLongitude + maxLongitude) / 2,
  };
}

function calculateDistanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLatitude = toRadians(latitudeB - latitudeA);
  const dLongitude = toRadians(longitudeB - longitudeA);
  const lat1 = toRadians(latitudeA);
  const lat2 = toRadians(latitudeB);

  const a =
    Math.sin(dLatitude / 2) * Math.sin(dLatitude / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLongitude / 2) *
      Math.sin(dLongitude / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return "Distance unavailable";
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m away`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km away`;
}

function getMarkerDisplay(zoom, imageScale) {
  let baseDisplay;

  if (zoom <= 11) {
    baseDisplay = { maxWidth: 36, maxHeight: 36, maxMarkers: 12 };
  } else if (zoom <= 13) {
    baseDisplay = { maxWidth: 48, maxHeight: 48, maxMarkers: 18 };
  } else if (zoom <= 15) {
    baseDisplay = { maxWidth: 66, maxHeight: 66, maxMarkers: 30 };
  } else {
    baseDisplay = { maxWidth: 82, maxHeight: 82, maxMarkers: 42 };
  }

  const safeScale = Number.isFinite(imageScale) ? imageScale : 1;

  return {
    maxWidth: Math.round(baseDisplay.maxWidth * safeScale),
    maxHeight: Math.round(baseDisplay.maxHeight * safeScale),
    maxMarkers: Math.max(
      8,
      Math.min(48, Math.round(baseDisplay.maxMarkers / Math.pow(safeScale, 0.7)))
    ),
  };
}

function normalizeContainerPoint(point) {
  if (!point) {
    return null;
  }

  if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return { x: point.x, y: point.y };
  }

  return null;
}

function getMarkerHitbox(anchorPoint, markerDisplay) {
  const width = markerDisplay.maxWidth + DISAMBIGUATION_TOUCH_PADDING * 2;
  const height = markerDisplay.maxHeight * 3 + DISAMBIGUATION_TOUCH_PADDING * 2;

  return {
    left: anchorPoint.x - width / 2,
    right: anchorPoint.x + width / 2,
    top: anchorPoint.y - height,
    bottom: anchorPoint.y + DISAMBIGUATION_TOUCH_PADDING,
  };
}

function isPointInsideHitbox(point, hitbox) {
  return (
    point.x >= hitbox.left &&
    point.x <= hitbox.right &&
    point.y >= hitbox.top &&
    point.y <= hitbox.bottom
  );
}

function getInteractionPoint(event, mapInstance) {
  const containerPoint = normalizeContainerPoint(event?.containerPoint);

  if (containerPoint) {
    return containerPoint;
  }

  if (event?.latlng && mapInstance?.latLngToContainerPoint) {
    return normalizeContainerPoint(
      mapInstance.latLngToContainerPoint(event.latlng)
    );
  }

  return null;
}

function resolveDisambiguationCandidates({
  displayedBanners,
  interactionPoint,
  mapInstance,
  markerDisplay,
}) {
  if (!interactionPoint || !mapInstance?.latLngToContainerPoint) {
    return [];
  }

  return displayedBanners
    .map((banner) => {
      const anchorPoint = normalizeContainerPoint(
        mapInstance.latLngToContainerPoint({
          lat: banner._latitude,
          lng: banner._longitude,
        })
      );

      if (!anchorPoint) {
        return null;
      }

      const hitbox = getMarkerHitbox(anchorPoint, markerDisplay);

      if (!isPointInsideHitbox(interactionPoint, hitbox)) {
        return null;
      }

      const distanceFromAnchor = Math.hypot(
        interactionPoint.x - anchorPoint.x,
        interactionPoint.y - anchorPoint.y
      );

      return {
        banner,
        distanceFromAnchor,
      };
    })
    .filter(Boolean)
    .sort((candidateA, candidateB) => {
      if (candidateA.distanceFromAnchor !== candidateB.distanceFromAnchor) {
        return candidateA.distanceFromAnchor - candidateB.distanceFromAnchor;
      }

      return candidateA.banner._distanceMeters - candidateB.banner._distanceMeters;
    })
    .map((candidate) => candidate.banner);
}

function createBannerMarkerIcon({ banner, width, maxHeight, isSelected }) {
  const imageUrl = banner.picture
    ? `https://api.bannergress.com${banner.picture}`
    : "";

  return L.divIcon({
    html: imageUrl
      ? `<div
          style="
            width:${width}px;
            display:block;
            transform:translate(-50%, -100%) ${isSelected ? "translateY(-6px)" : ""};
            transform-origin:bottom center;
          "
        ><img
            src="${imageUrl}"
            alt=""
            decoding="async"
            loading="lazy"
            style="
              width:100%;
              height:auto;
              max-height:${Math.round(maxHeight * 3)}px;
              display:block;
              border:${isSelected ? "2px solid rgba(237,241,243,0.96)" : "1px solid rgba(255,255,255,0.16)"};
              box-shadow:${isSelected ? "0 18px 30px rgba(0,0,0,0.38)" : "0 10px 20px rgba(0,0,0,0.28)"};
              background:transparent;
            "
          /></div>`
      : `<div style="
          width:${width}px;
          height:${maxHeight}px;
          display:flex;
          align-items:center;
          justify-content:center;
          color:#97a5ae;
          font:600 12px/1.2 'IBM Plex Sans', sans-serif;
          text-align:center;
          padding:8px;
          border:1px solid rgba(255,255,255,0.16);
          background:rgba(18,25,31,0.96);
          box-shadow:0 10px 20px rgba(0,0,0,0.28);
          transform:translate(-50%, -100%) ${isSelected ? "translateY(-6px)" : ""};
          transform-origin:bottom center;
        ">No image</div>`,
    className: "banner-map-icon",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function createUserLocationIcon() {
  return L.divIcon({
    html: `
      <div style="
        width:18px;
        height:18px;
        border-radius:50%;
        background:#7ec8ff;
        border:3px solid rgba(255,255,255,0.95);
        box-shadow:0 0 0 8px rgba(126,200,255,0.18), 0 4px 10px rgba(0,0,0,0.24);
      "></div>
    `,
    className: "user-location-map-icon",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function MapEvents({ onMapClick, onViewportChange }) {
  useMapEvents({
    load: (event) => onViewportChange(event.target),
    moveend: (event) => onViewportChange(event.target),
    zoomend: (event) => onViewportChange(event.target),
    click: (event) => onMapClick?.(event),
  });

  return null;
}

function BannerPreviewCard({ banner }) {
  const missions = Number(banner.numberOfMissions);
  const lengthMeters = Number(banner.lengthMeters);

  return (
    <Paper
      elevation={0}
      sx={{
        width: { xs: "min(100%, 440px)", sm: 400 },
        overflow: "hidden",
        borderRadius: 3,
        bgcolor: "rgba(18,25,31,0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 22px 48px rgba(0,0,0,0.28)",
        backdropFilter: "blur(16px)",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "124px minmax(0, 1fr)", sm: "148px minmax(0, 1fr)" },
          gap: 1.1,
          p: 1.1,
        }}
      >
        <Box
          sx={{
            borderRadius: 2,
            overflow: "hidden",
            bgcolor: "rgba(255,255,255,0.04)",
            minHeight: { xs: 176, sm: 208 },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 1,
          }}
        >
          {banner.picture ? (
            <Box
              component="img"
              src={`https://api.bannergress.com${banner.picture}`}
              alt={banner.title}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          ) : (
            <Box
              sx={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "text.secondary",
                textAlign: "center",
                px: 1,
              }}
            >
              <Typography variant="caption">No image</Typography>
            </Box>
          )}
        </Box>

        <Stack spacing={0.9} sx={{ minWidth: 0 }}>
          <Typography
            variant="h6"
            sx={{
              fontSize: "1rem",
              lineHeight: 1.15,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {banner.title}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {banner.formattedAddress || "Address unavailable"}
          </Typography>

          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
            <Chip
              size="small"
              label={`${Number.isFinite(missions) ? missions : "?"} missions`}
              sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
            />
            <Chip
              size="small"
              label={formatDistance(banner._distanceMeters)}
              sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
            />
            {Number(banner.numberOfDisabledMissions) > 0 ? (
              <Chip
                size="small"
                label="Offline"
                sx={{
                  bgcolor: "rgba(120, 60, 28, 0.55)",
                  color: "#ffd8b2",
                  borderRadius: 999,
                }}
              />
            ) : null}
            {Number.isFinite(lengthMeters) ? (
              <Chip
                size="small"
                label={`${(lengthMeters / 1000).toFixed(1)} km`}
                sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
              />
            ) : null}
          </Stack>

          <Button
            component={Link}
            to={`/banner/${banner.id}`}
            variant="contained"
            color="primary"
            sx={{ mt: "auto", alignSelf: "flex-start" }}
          >
            Open banner
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
}

function BannerDisambiguationMenu({ banners, point, onClose, onSelect }) {
  if (!point || banners.length < 2) {
    return null;
  }

  const topOffset = Math.max(12, Math.round(point.y));
  const availableHeight = `calc(100% - ${topOffset}px - 12px)`;
  const stopMapInteraction = (event) => {
    event.stopPropagation();
  };

  return (
    <Paper
      elevation={0}
      onClick={stopMapInteraction}
      onMouseDown={stopMapInteraction}
      onPointerDown={stopMapInteraction}
      onTouchStart={stopMapInteraction}
      onTouchMove={stopMapInteraction}
      onWheel={stopMapInteraction}
      sx={{
        position: "absolute",
        left: `clamp(12px, ${Math.round(point.x)}px, calc(100% - 332px))`,
        top: `${topOffset}px`,
        zIndex: 1100,
        width: "min(320px, calc(100% - 24px))",
        p: 1,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        height: `min(420px, ${availableHeight})`,
        maxHeight: availableHeight,
        minHeight: 0,
        overflow: "hidden",
        borderRadius: 2.5,
        bgcolor: "rgba(18,25,31,0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 18px 42px rgba(0,0,0,0.28)",
        backdropFilter: "blur(16px)",
        pointerEvents: "auto",
      }}
    >
      <Stack spacing={1} sx={{ minHeight: 0 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack spacing={0.2}>
            <Typography
              variant="overline"
              sx={{ color: "text.secondary", letterSpacing: "0.12em" }}
            >
              Multiple Banners
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pick the banner you meant.
            </Typography>
          </Stack>

          <Button size="small" color="inherit" onClick={onClose}>
            Close
          </Button>
        </Stack>

        <Stack
          spacing={1}
          sx={{
            minHeight: 0,
            height: "100%",
            overflowY: "auto",
            pr: 0.25,
            overscrollBehavior: "contain",
            touchAction: "pan-y",
            scrollbarGutter: "stable",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {banners.map((banner) => (
            <Box
              key={banner.id}
              component="button"
              type="button"
              onClick={() => onSelect(banner)}
              sx={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "56px minmax(0, 1fr)",
                gap: 1,
                p: 0.8,
                borderRadius: 2,
                border: "1px solid rgba(255,255,255,0.08)",
                bgcolor: "rgba(255,255,255,0.03)",
                color: "inherit",
                textAlign: "left",
                cursor: "pointer",
                transition: "background-color 120ms ease, border-color 120ms ease",
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.18)",
                },
              }}
            >
              <Box
                sx={{
                  width: 56,
                  minHeight: 74,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(255,255,255,0.04)",
                  overflow: "hidden",
                  borderRadius: 1.5,
                }}
              >
                {banner.picture ? (
                  <Box
                    component="img"
                    src={`https://api.bannergress.com${banner.picture}`}
                    alt={banner.title}
                    sx={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                    }}
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    No image
                  </Typography>
                )}
              </Box>

              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    lineHeight: 1.2,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {banner.title}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {banner.formattedAddress || "Address unavailable"}
                </Typography>
                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`${Number(banner.numberOfMissions) || "?"} missions`}
                    sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
                  />
                  <Chip
                    size="small"
                    label={formatDistance(banner._distanceMeters)}
                    sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
                  />
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function setMapInteractionsEnabled(mapInstance, enabled) {
  if (!mapInstance) {
    return;
  }

  const method = enabled ? "enable" : "disable";

  mapInstance.dragging?.[method]?.();
  mapInstance.scrollWheelZoom?.[method]?.();
  mapInstance.touchZoom?.[method]?.();
  mapInstance.doubleClickZoom?.[method]?.();
  mapInstance.boxZoom?.[method]?.();
  mapInstance.keyboard?.[method]?.();
  mapInstance.tap?.[method]?.();
}

export default function Map({
  bannerFilters = DEFAULT_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  const initialImageSizePreference = readInitialImageSizePreference();
  const [visibleArea, setVisibleArea] = useState(null);
  const [banners, setBanners] = useState([]);
  const [selectedBannerId, setSelectedBannerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [locationStatus, setLocationStatus] = useState("checking");
  const [locationError, setLocationError] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const syncState = useBannergressSync();
  const [imageSizeMode, setImageSizeMode] = useState(initialImageSizePreference.mode);
  const [customImageScale, setCustomImageScale] = useState(
    initialImageSizePreference.customScale
  );
  const [imageSizeMenuAnchor, setImageSizeMenuAnchor] = useState(null);
  const [disambiguationState, setDisambiguationState] = useState(null);
  const mapRef = useRef(null);
  const hasCenteredOnUserRef = useRef(false);
  const iconCacheRef = useRef(bannerMarkerIconCache);

  const locationIcon = useMemo(() => createUserLocationIcon(), []);
  const imageSizeMenuOpen = Boolean(imageSizeMenuAnchor);
  const isDisambiguating = Boolean(disambiguationState?.bannerIds?.length);
  const activeImageScale =
    imageSizeMode === "custom"
      ? customImageScale
      : IMAGE_SIZE_PRESETS[imageSizeMode]?.scale ?? IMAGE_SIZE_PRESETS.medium.scale;
  const activeImageSizeLabel =
    imageSizeMode === "custom"
      ? `Custom (${Math.round(activeImageScale * 100)}%)`
      : IMAGE_SIZE_PRESETS[imageSizeMode]?.label ?? IMAGE_SIZE_PRESETS.medium.label;

  const requestCurrentPosition = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      setLocationError("This browser does not support location.");
      return;
    }

    setLocationError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        setUserLocation(nextLocation);
        setLocationStatus("granted");
      },
      () => {
        setLocationStatus("denied");
        setLocationError(
          "Location access is blocked. Enable it to sort banners around you."
        );
      },
      { enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    let ignore = false;

    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      setLocationError("This browser does not support location.");
      return undefined;
    }

    const setPermissionState = (nextState) => {
      if (ignore) {
        return;
      }

      setLocationStatus(nextState);

      if (nextState === "granted") {
        requestCurrentPosition();
      } else if (nextState === "prompt") {
        setLocationError("");
      } else if (nextState === "denied") {
        setLocationError(
          "Location access is blocked. Enable it to sort banners around you."
        );
      }
    };

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          setPermissionState(result.state);
          result.onchange = () => {
            setPermissionState(result.state);
          };
        })
        .catch(() => {
          setLocationStatus("prompt");
        });
    } else {
      setLocationStatus("prompt");
    }

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      IMAGE_SIZE_STORAGE_KEY,
      JSON.stringify({
        mode: imageSizeMode,
        customScale: customImageScale,
      })
    );
  }, [customImageScale, imageSizeMode]);

  useEffect(() => {
    if (!userLocation || !mapRef.current || hasCenteredOnUserRef.current) {
      return;
    }

    mapRef.current.setView([userLocation.latitude, userLocation.longitude], 14);
    hasCenteredOnUserRef.current = true;
  }, [userLocation]);

  useEffect(() => {
    const mapInstance = mapRef.current;

    if (!mapInstance) {
      return undefined;
    }

    setMapInteractionsEnabled(mapInstance, !isDisambiguating);

    return () => {
      setMapInteractionsEnabled(mapInstance, true);
    };
  }, [isDisambiguating]);

  const normalizedVisibleArea = useMemo(
    () => normalizeVisibleArea(visibleArea),
    [visibleArea]
  );
  const normalizedOriginLocation = useMemo(
    () => normalizeOriginLocation(userLocation, normalizedVisibleArea),
    [normalizedVisibleArea, userLocation]
  );
  const discoveryMapQueryKey = useMemo(
    () =>
      createDiscoveryMapQueryKey(normalizedVisibleArea, normalizedOriginLocation),
    [normalizedOriginLocation, normalizedVisibleArea]
  );
  const markerDisplay = useMemo(
    () => getMarkerDisplay(currentZoom, activeImageScale),
    [activeImageScale, currentZoom]
  );
  const fetchLimit = markerDisplay.maxMarkers;
  const discoveryMapRequestKey = useMemo(
    () =>
      discoveryMapQueryKey
        ? [
            discoveryMapQueryKey,
            fetchLimit,
            bannerFilters.showOfflineBanners ? "offline" : "online-only",
            bannerFilters.showHiddenBanners ? "show-hidden" : "hide-hidden",
          ].join(":")
        : "",
    [
      bannerFilters.showHiddenBanners,
      bannerFilters.showOfflineBanners,
      discoveryMapQueryKey,
      fetchLimit,
    ]
  );

  useEffect(() => {
    if (!normalizedVisibleArea || !normalizedOriginLocation || !discoveryMapRequestKey) {
      return undefined;
    }

    let ignore = false;
    const timeoutId = window.setTimeout(async () => {
      setError("");
      const cachedEntry = discoveryMapCache.get(discoveryMapRequestKey);

      if (
        cachedEntry &&
        Date.now() - cachedEntry.timestamp < DISCOVERY_MAP_CACHE_TTL_MS
      ) {
        setBanners(cachedEntry.banners);
        setLoading(false);
        return;
      }

      setLoading(true);

      const originLatitude = normalizedOriginLocation.latitude;
      const originLongitude = normalizedOriginLocation.longitude;

      const apiUrl =
        `https://api.bannergress.com/bnrs?orderBy=proximityStartPoint` +
        `&orderDirection=ASC` +
        `${bannerFilters.showOfflineBanners ? "" : "&online=true"}` +
        `&minLatitude=${normalizedVisibleArea.minLatitude}` +
        `&maxLatitude=${normalizedVisibleArea.maxLatitude}` +
        `&minLongitude=${normalizedVisibleArea.minLongitude}` +
        `&maxLongitude=${normalizedVisibleArea.maxLongitude}` +
        `&proximityLatitude=${originLatitude}` +
        `&proximityLongitude=${originLongitude}` +
        `&limit=${fetchLimit}`;

      try {
        let responsePromise = discoveryMapInflightRequests.get(
          discoveryMapRequestKey
        );

        if (!responsePromise) {
          responsePromise = fetchBannergress(apiUrl, {
            authenticate: !bannerFilters.showHiddenBanners,
          });
          discoveryMapInflightRequests.set(
            discoveryMapRequestKey,
            responsePromise
          );
        }

        const response = await responsePromise;
        const data = await response.json();

        if (ignore) {
          return;
        }

        const normalizedBanners = normalizeFetchedBanners(
          data,
          originLatitude,
          originLongitude
        );

        if (!normalizedBanners) {
          setBanners([]);
          setError("Map results returned an unexpected response.");
          return;
        }

        discoveryMapCache.set(discoveryMapRequestKey, {
          banners: normalizedBanners,
          timestamp: Date.now(),
        });
        setBanners(normalizedBanners);
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching banners:", fetchError);
          setBanners([]);
          setError("Couldn't load banners in this area. Please try again.");
        }
      } finally {
        discoveryMapInflightRequests.delete(discoveryMapRequestKey);

        if (!ignore) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    discoveryMapRequestKey,
    fetchLimit,
    bannerFilters.showHiddenBanners,
    bannerFilters.showOfflineBanners,
    normalizedOriginLocation,
    normalizedVisibleArea,
  ]);

  const updateVisibleArea = (mapInstance) => {
    if (!mapInstance) {
      return;
    }

    mapRef.current = mapInstance;
    const nextVisibleArea = getVisibleAreaFromBounds(mapInstance.getBounds());

    setCurrentZoom(mapInstance.getZoom());
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

  const { minimumMissions, maximumMissions } = getMissionCountBounds(
    bannerFilters
  );
  const filteredBanners = useMemo(
    () =>
      applyBannerFilters(banners, syncState, bannerFilters).filter((banner) => {
        const missionCount = Number(banner?.numberOfMissions);

        if (!Number.isFinite(missionCount)) {
          return minimumMissions === null && maximumMissions === null;
        }

        if (minimumMissions !== null && missionCount < minimumMissions) {
          return false;
        }

        if (maximumMissions !== null && missionCount > maximumMissions) {
          return false;
        }

        return true;
      }),
    [bannerFilters, banners, maximumMissions, minimumMissions, syncState]
  );

  const displayedBanners = filteredBanners;

  useEffect(() => {
    if (displayedBanners.length === 0) {
      setSelectedBannerId(null);
      setDisambiguationState(null);
      return;
    }

    const hasSelectedBanner = displayedBanners.some(
      (banner) => banner.id === selectedBannerId
    );

    if (!hasSelectedBanner) {
      setSelectedBannerId(displayedBanners[0].id);
    }
  }, [displayedBanners, selectedBannerId]);

  useEffect(() => {
    if (!disambiguationState) {
      return;
    }

    const remainingBannerIds = new Set(displayedBanners.map((banner) => banner.id));
    const nextBannerIds = disambiguationState.bannerIds.filter((bannerId) =>
      remainingBannerIds.has(bannerId)
    );

    if (nextBannerIds.length < 2) {
      setDisambiguationState(null);
      return;
    }

    if (nextBannerIds.length !== disambiguationState.bannerIds.length) {
      setDisambiguationState((currentState) =>
        currentState
          ? {
              ...currentState,
              bannerIds: nextBannerIds,
            }
          : null
      );
    }
  }, [disambiguationState, displayedBanners]);

  const selectedBanner =
    displayedBanners.find((banner) => banner.id === selectedBannerId) ?? null;
  const disambiguationBanners = disambiguationState
    ? disambiguationState.bannerIds
        .map((bannerId) =>
          displayedBanners.find((banner) => banner.id === bannerId)
        )
        .filter(Boolean)
    : [];

  const handleBannerSelection = (banner) => {
    setSelectedBannerId(banner.id);
    setDisambiguationState(null);
  };

  const handleBannerInteraction = (banner, event) => {
    const mapInstance = mapRef.current;

    if (!mapInstance) {
      handleBannerSelection(banner);
      return;
    }

    const interactionPoint = getInteractionPoint(event, mapInstance);

    if (!interactionPoint) {
      handleBannerSelection(banner);
      return;
    }

    const candidates = resolveDisambiguationCandidates({
      displayedBanners,
      interactionPoint,
      mapInstance,
      markerDisplay,
    });

    if (candidates.length > 1) {
      setSelectedBannerId(candidates[0].id);
      setDisambiguationState({
        point: interactionPoint,
        bannerIds: candidates.map((candidate) => candidate.id),
      });
      return;
    }

    handleBannerSelection(banner);
  };

  const handleMapClick = (event) => {
    const mapInstance = mapRef.current;

    if (!mapInstance) {
      setDisambiguationState(null);
      return;
    }

    const interactionPoint = getInteractionPoint(event, mapInstance);

    if (!interactionPoint) {
      setDisambiguationState(null);
      return;
    }

    const candidates = resolveDisambiguationCandidates({
      displayedBanners,
      interactionPoint,
      mapInstance,
      markerDisplay,
    });

    if (candidates.length > 1) {
      setSelectedBannerId(candidates[0].id);
      setDisambiguationState({
        point: interactionPoint,
        bannerIds: candidates.map((candidate) => candidate.id),
      });
      return;
    }

    setDisambiguationState(null);
  };

  const markerDescriptors = useMemo(
    () =>
      displayedBanners.flatMap((banner) => {
        const isSelected = banner.id === selectedBannerId;

        const cacheKey = [
          banner.id,
          banner.picture ?? "none",
          markerDisplay.maxWidth,
          markerDisplay.maxHeight,
          isSelected ? "selected" : "default",
        ].join(":");
        let icon = iconCacheRef.current.get(cacheKey);

        if (!icon) {
          icon = createBannerMarkerIcon({
            banner,
            width: markerDisplay.maxWidth,
            maxHeight: markerDisplay.maxHeight,
            isSelected,
          });
          iconCacheRef.current.set(cacheKey, icon);
        }

        return [
          {
            banner,
            icon,
          },
        ];
      }),
    [
      displayedBanners,
      markerDisplay.maxHeight,
      markerDisplay.maxWidth,
      selectedBannerId,
    ]
  );

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
      <MapContainer
        id="map"
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={!L.Browser.mobile}
        scrollWheelZoom
        ref={mapRef}
        style={{ height: "100%", width: "100%" }}
        whenReady={(event) => updateVisibleArea(event.target)}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {userLocation ? (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={locationIcon}
          />
        ) : null}

        {markerDescriptors.map(({ banner, icon }) => (
          <Marker
            key={banner.id}
            position={[banner._latitude, banner._longitude]}
            icon={icon}
            eventHandlers={{
              click: (event) => {
                handleBannerInteraction(banner, event);
              },
            }}
          />
        ))}

        <MapEvents
          onMapClick={handleMapClick}
          onViewportChange={updateVisibleArea}
        />
      </MapContainer>

      <BannerDisambiguationMenu
        banners={disambiguationBanners}
        point={disambiguationState?.point}
        onClose={() => setDisambiguationState(null)}
        onSelect={handleBannerSelection}
      />

      <Stack
        spacing={1}
        sx={{
          position: "absolute",
          top: 16,
          left: 16,
          right: { xs: 16, sm: "auto" },
          zIndex: 1000,
          width: { xs: "auto", sm: "min(420px, calc(100vw - 32px))" },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 1,
            borderRadius: 2.5,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 14px 30px rgba(0,0,0,0.2)",
            backdropFilter: "blur(16px)",
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack spacing={0.2}>
              <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: "0.12em" }}>
                Discovery Map
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {loading
                  ? "Updating nearby posters..."
                  : `${displayedBanners.length} banners in view`}
              </Typography>
            </Stack>

            <Button
              variant="contained"
              size="small"
              startIcon={<MyLocationRoundedIcon />}
              onClick={requestCurrentPosition}
            >
              {userLocation ? "Recenter" : "Locate me"}
            </Button>
          </Stack>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
            sx={{ mt: 1 }}
          >
            <Button
              variant="outlined"
              size="small"
              color="inherit"
              onClick={(event) => setImageSizeMenuAnchor(event.currentTarget)}
              sx={{
                justifyContent: "space-between",
                borderColor: "rgba(255,255,255,0.16)",
                color: "inherit",
              }}
            >
              Image size: {activeImageSizeLabel}
            </Button>

            <BannerFilterButton
              filters={bannerFilters}
              onChange={onBannerFiltersChange}
              color="inherit"
              showMinimumMissionsFilter
              sx={{
                justifyContent: "space-between",
                borderColor: "rgba(255,255,255,0.16)",
                color: "inherit",
              }}
            />
          </Stack>

          <Menu
            anchorEl={imageSizeMenuAnchor}
            open={imageSizeMenuOpen}
            onClose={() => setImageSizeMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
          >
            <Box sx={{ width: 280, py: 0.5 }}>
              <Typography
                variant="overline"
                sx={{ px: 2, color: "text.secondary", letterSpacing: "0.12em" }}
              >
                Poster Size
              </Typography>

              {["small", "medium", "large", "custom"].map((mode) => (
                <MenuItem
                  key={mode}
                  selected={imageSizeMode === mode}
                  onClick={() => {
                    setImageSizeMode(mode);

                    if (mode !== "custom") {
                      setImageSizeMenuAnchor(null);
                    }
                  }}
                >
                  {mode === "custom"
                    ? `Custom (${Math.round(customImageScale * 100)}%)`
                    : IMAGE_SIZE_PRESETS[mode].label}
                </MenuItem>
              ))}

              {imageSizeMode === "custom" ? (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{ mb: 1 }}
                    >
                      <Typography variant="body2">Live size</Typography>
                      <Chip
                        size="small"
                        label={`${Math.round(customImageScale * 100)}%`}
                        sx={{ borderRadius: 999 }}
                      />
                    </Stack>
                    <Slider
                      aria-label="Custom image size"
                      min={CUSTOM_IMAGE_SCALE_MIN}
                      max={CUSTOM_IMAGE_SCALE_MAX}
                      step={CUSTOM_IMAGE_SCALE_STEP}
                      value={customImageScale}
                      onChange={(_, value) => {
                        setCustomImageScale(Array.isArray(value) ? value[0] : value);
                      }}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
                    />
                  </Box>
                </>
              ) : null}
            </Box>
          </Menu>
        </Paper>

        {locationStatus === "prompt" ? (
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={requestCurrentPosition}>
                Enable
              </Button>
            }
            sx={{ borderRadius: 2.5 }}
          >
            Turn on location to sort banners around you instead of only around the
            map view.
          </Alert>
        ) : null}

        {locationError ? (
          <Alert severity="warning" sx={{ borderRadius: 2.5 }}>
            {locationError}
          </Alert>
        ) : null}

        {error ? (
          <Alert severity="error" sx={{ borderRadius: 2.5 }}>
            {error}
          </Alert>
        ) : null}
      </Stack>

      {selectedBanner ? (
        <Box
          sx={{
            position: "absolute",
            left: { xs: 12, sm: 16 },
            right: { xs: 12, sm: "auto" },
            bottom: 16,
            zIndex: 1000,
          }}
        >
          <BannerPreviewCard banner={selectedBanner} />
        </Box>
      ) : !loading ? (
        <Box
          sx={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 1000,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 1.25,
              borderRadius: 2.5,
              bgcolor: "rgba(18,25,31,0.92)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(16px)",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              No banners match this view. Move the map or relax the mission filter.
            </Typography>
          </Paper>
        </Box>
      ) : null}
    </Box>
  );
}
