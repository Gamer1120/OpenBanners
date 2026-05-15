import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PhotoSizeSelectLargeRoundedIcon from "@mui/icons-material/PhotoSizeSelectLargeRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchBannergress, useBannergressSync } from "../bannergressSync";
import BannerFilterButton from "./BannerFilterButton";
import {
  applyBannerFilters,
  DEFAULT_MAP_BANNER_FILTERS,
  getMissionCountBounds,
} from "../bannerFilters";

const DEFAULT_CENTER = [52.221058, 6.893297];
const DEFAULT_ZOOM = 15;
const DISCOVERY_MAP_CACHE_TTL_MS = 2 * 60 * 1000;
const DISCOVERY_MAP_QUERY_PRECISION = 3;
const DISCOVERY_MAP_PAGE_SIZE = 100;
const DISCOVERY_MAP_MAX_FETCHED_BANNERS = 500;
const IMAGE_SIZE_STORAGE_KEY = "openbanners.discoveryMap.imageSize";
const MARKER_IMAGE_GAP_PX = 4;
const CONNECTOR_LINE_COLORS = [
  "#ff6b6b",
  "#ffd166",
  "#06d6a0",
  "#4cc9f0",
  "#a78bfa",
  "#f472b6",
  "#f97316",
  "#22c55e",
];
const IMAGE_SIZE_PRESETS = {
  small: { label: "Small", scale: 1.4 },
  medium: { label: "Medium", scale: 2 },
  large: { label: "Large", scale: 2.6 },
};
const CUSTOM_IMAGE_SCALE_MIN = 0.7;
const CUSTOM_IMAGE_SCALE_MAX = 5;
const CUSTOM_IMAGE_SCALE_STEP = 0.05;
const DISAMBIGUATION_TOUCH_PADDING = 12;
const DISAMBIGUATION_PICKER_MARGIN = 12;
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

function buildDiscoveryMapUrl({
  visibleArea,
  originLatitude,
  originLongitude,
  showOfflineBanners,
  limit,
  offset,
}) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("orderBy", "proximityStartPoint");
  url.searchParams.set("orderDirection", "ASC");
  url.searchParams.set("minLatitude", String(visibleArea.minLatitude));
  url.searchParams.set("maxLatitude", String(visibleArea.maxLatitude));
  url.searchParams.set("minLongitude", String(visibleArea.minLongitude));
  url.searchParams.set("maxLongitude", String(visibleArea.maxLongitude));
  url.searchParams.set("proximityLatitude", String(originLatitude));
  url.searchParams.set("proximityLongitude", String(originLongitude));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (!showOfflineBanners) {
    url.searchParams.set("online", "true");
  }

  return url.toString();
}

async function fetchDiscoveryMapBanners({
  visibleArea,
  originLatitude,
  originLongitude,
  showOfflineBanners,
  showHiddenBanners,
}) {
  let offset = 0;
  let allBanners = [];

  while (allBanners.length < DISCOVERY_MAP_MAX_FETCHED_BANNERS) {
    const pageLimit = Math.min(
      DISCOVERY_MAP_PAGE_SIZE,
      DISCOVERY_MAP_MAX_FETCHED_BANNERS - allBanners.length
    );
    const response = await fetchBannergress(
      buildDiscoveryMapUrl({
        visibleArea,
        originLatitude,
        originLongitude,
        showOfflineBanners,
        limit: pageLimit,
        offset,
      }),
      {
        authenticate: !showHiddenBanners,
      }
    );
    const pageData = await response.json();

    if (!Array.isArray(pageData)) {
      return null;
    }

    allBanners = [...allBanners, ...pageData];

    if (pageData.length < pageLimit) {
      return {
        banners: allBanners,
        hasMore: false,
      };
    }

    offset += pageData.length;
  }

  return {
    banners: allBanners,
    hasMore: true,
  };
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
    baseDisplay = { maxWidth: 36, maxHeight: 36 };
  } else if (zoom <= 13) {
    baseDisplay = { maxWidth: 48, maxHeight: 48 };
  } else if (zoom <= 15) {
    baseDisplay = { maxWidth: 66, maxHeight: 66 };
  } else {
    baseDisplay = { maxWidth: 82, maxHeight: 82 };
  }

  const safeScale = Number.isFinite(imageScale) ? imageScale : 1;

  return {
    maxWidth: Math.round(baseDisplay.maxWidth * safeScale),
    maxHeight: Math.round(baseDisplay.maxHeight * safeScale),
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
  const visualWidth = Math.max(12, markerDisplay.maxWidth - MARKER_IMAGE_GAP_PX);
  const visualHeight = Math.max(12, markerDisplay.maxHeight * 3 - MARKER_IMAGE_GAP_PX);
  const width = visualWidth + DISAMBIGUATION_TOUCH_PADDING * 2;
  const height = visualHeight + DISAMBIGUATION_TOUCH_PADDING * 2;

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

function separateMarkerAnchorPoints(rawMarkers, markerDisplay) {
  const minimumHorizontalDistance = markerDisplay.maxWidth + MARKER_IMAGE_GAP_PX;
  const minimumVerticalDistance = markerDisplay.maxHeight * 0.6 + MARKER_IMAGE_GAP_PX;
  const horizontalStep = Math.max(4, Math.round(minimumHorizontalDistance / 3));
  const verticalStep = Math.max(4, Math.round(minimumVerticalDistance / 3));
  const placedMarkers = [];

  const isColliding = (candidatePoint) =>
    placedMarkers.some((placedMarker) => {
      const deltaX = candidatePoint.x - placedMarker.anchorPoint.x;
      const deltaY = candidatePoint.y - placedMarker.anchorPoint.y;

      return (
        Math.abs(deltaX) < minimumHorizontalDistance &&
        Math.abs(deltaY) < minimumVerticalDistance
      );
    });

  rawMarkers.forEach((marker) => {
    const originPoint = marker.anchorPoint;
    const candidatePoints = [{ x: originPoint.x, y: originPoint.y }];

    for (let radius = 1; radius <= 6; radius += 1) {
      const xOffset = radius * horizontalStep;
      const yOffset = radius * verticalStep;

      candidatePoints.push(
        { x: originPoint.x - xOffset, y: originPoint.y },
        { x: originPoint.x + xOffset, y: originPoint.y },
        { x: originPoint.x, y: originPoint.y - yOffset },
        { x: originPoint.x - xOffset, y: originPoint.y - yOffset },
        { x: originPoint.x + xOffset, y: originPoint.y - yOffset },
        { x: originPoint.x - xOffset, y: originPoint.y + yOffset },
        { x: originPoint.x + xOffset, y: originPoint.y + yOffset }
      );
    }

    const adjustedPoint =
      candidatePoints.find((candidatePoint) => !isColliding(candidatePoint)) ??
      candidatePoints[candidatePoints.length - 1];

    placedMarkers.push({
      ...marker,
      anchorPoint: adjustedPoint,
    });
  });

  return placedMarkers;
}

function resolveDisambiguationCandidates({
  markerDescriptors,
  interactionPoint,
  markerDisplay,
}) {
  if (!interactionPoint) {
    return [];
  }

  return markerDescriptors
    .map(({ banner, anchorPoint }) => {
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
  const visualWidth = Math.max(12, width - MARKER_IMAGE_GAP_PX);
  const visualMaxHeight = Math.max(12, Math.round(maxHeight * 3) - MARKER_IMAGE_GAP_PX);
  const imageUrl = banner.picture
    ? `https://api.bannergress.com${banner.picture}`
    : "";

  return L.divIcon({
    html: imageUrl
      ? `<div
          style="
            width:${visualWidth}px;
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
              max-height:${visualMaxHeight}px;
              display:block;
              border:${isSelected ? "2px solid rgba(237,241,243,0.96)" : "1px solid rgba(255,255,255,0.16)"};
              box-shadow:${isSelected ? "0 18px 30px rgba(0,0,0,0.38)" : "0 10px 20px rgba(0,0,0,0.28)"};
              background:transparent;
            "
          /></div>`
      : `<div style="
          width:${visualWidth}px;
          height:${Math.max(12, maxHeight - MARKER_IMAGE_GAP_PX)}px;
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
  const missionLabel = `${Number.isFinite(missions) ? missions : "?"} missions`;
  const distanceLabel = formatDistance(banner._distanceMeters);
  const mobileDistanceLabel = distanceLabel.replace(/ away$/, "");
  const lengthLabel = Number.isFinite(lengthMeters)
    ? `${(lengthMeters / 1000).toFixed(1)} km`
    : null;
  const mobileMeta = [missionLabel, mobileDistanceLabel, lengthLabel]
    .filter(Boolean)
    .join(" / ");

  return (
    <Paper
      elevation={0}
      sx={{
        width: {
          xs: "calc(100vw - 24px)",
          sm: "min(420px, calc(100vw - 32px))",
          lg: 400,
        },
        overflow: "hidden",
        borderRadius: { xs: 2, lg: 3 },
        bgcolor: "rgba(18,25,31,0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: {
          xs: "0 12px 26px rgba(0,0,0,0.24)",
          lg: "0 22px 48px rgba(0,0,0,0.28)",
        },
        backdropFilter: "blur(16px)",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "74px minmax(0, 1fr)",
            lg: "148px minmax(0, 1fr)",
          },
          alignItems: { xs: "center", lg: "stretch" },
          gap: { xs: 0.8, lg: 1.1 },
          p: { xs: 0.75, lg: 1.1 },
        }}
      >
        <Box
          sx={{
            borderRadius: { xs: 1.5, lg: 2 },
            overflow: "hidden",
            bgcolor: "rgba(255,255,255,0.04)",
            minHeight: { xs: 54, lg: 208 },
            height: { xs: 54, lg: "auto" },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: { xs: 0.25, lg: 1 },
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
              <Typography
                variant="caption"
                sx={{ fontSize: { xs: "0.58rem", lg: "0.75rem" } }}
              >
                No image
              </Typography>
            </Box>
          )}
        </Box>

        <Stack
          direction={{ xs: "row", lg: "column" }}
          spacing={{ xs: 0.75, lg: 0.9 }}
          alignItems={{ xs: "center", lg: "stretch" }}
          sx={{ minWidth: 0 }}
        >
          <Stack spacing={{ xs: 0.2, lg: 0.9 }} sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: "0.92rem", lg: "1rem" },
                lineHeight: { xs: 1.12, lg: 1.15 },
                display: "-webkit-box",
                WebkitLineClamp: { xs: 1, lg: 2 },
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
                display: { xs: "none", lg: "-webkit-box" },
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {banner.formattedAddress || "Address unavailable"}
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: { xs: "block", lg: "none" },
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {mobileMeta}
            </Typography>

            <Stack
              direction="row"
              spacing={0.6}
              useFlexGap
              flexWrap="wrap"
              sx={{ display: { xs: "none", lg: "flex" } }}
            >
              <Chip
                size="small"
                label={missionLabel}
                sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
              />
              <Chip
                size="small"
                label={distanceLabel}
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
                  label={lengthLabel}
                  sx={{ bgcolor: "rgba(255,255,255,0.05)", borderRadius: 999 }}
                />
              ) : null}
            </Stack>
          </Stack>

          <Button
            component={Link}
            to={`/banner/${banner.id}`}
            variant="contained"
            color="primary"
            aria-label={`Open banner: ${banner.title}`}
            sx={{
              minWidth: { xs: 36, lg: 64 },
              width: { xs: 36, lg: "auto" },
              height: { xs: 36, lg: "auto" },
              p: { xs: 0, lg: "6px 16px" },
              mt: { xs: 0, lg: "auto" },
              alignSelf: { xs: "center", lg: "flex-start" },
              borderRadius: { xs: 1.5, lg: 1 },
            }}
          >
            <OpenInNewRoundedIcon
              fontSize="small"
              sx={{ display: { xs: "block", lg: "none" } }}
            />
            <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
              Open banner
            </Box>
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

  const thumbnailWidth =
    banners.length > 12 ? 52 : banners.length > 8 ? 58 : 68;
  const thumbnailHeight = Math.round(thumbnailWidth * 1.35);
  const radius = Math.max(
    88,
    Math.ceil((banners.length * thumbnailWidth) / (2 * Math.PI)) + 24
  );
  const centerX = Math.round(point.x);
  const centerY = Math.round(point.y);
  const stopMapInteraction = (event) => {
    event.stopPropagation();
  };

  return (
    <Box
      onClick={onClose}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 1100,
        pointerEvents: "auto",
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label="Close banner picker"
        onClick={onClose}
        onMouseDown={stopMapInteraction}
        onPointerDown={stopMapInteraction}
        onTouchStart={stopMapInteraction}
        onTouchMove={stopMapInteraction}
        onWheel={stopMapInteraction}
        sx={{
          position: "absolute",
          left: `clamp(28px, ${centerX}px, calc(100% - 28px))`,
          top: `clamp(28px, ${centerY}px, calc(100% - 28px))`,
          transform: "translate(-50%, -50%)",
          width: 56,
          height: 56,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.22)",
          bgcolor: "rgba(18,25,31,0.92)",
          color: "common.white",
          boxShadow: "0 14px 32px rgba(0,0,0,0.3)",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          p: 0,
        }}
      >
        <Typography variant="subtitle2" aria-hidden="true">
          {banners.length}
        </Typography>
      </Box>

      {banners.map((banner, index) => {
        const angle =
          banners.length === 2
            ? index === 0
              ? Math.PI
              : 0
            : -Math.PI / 2 + (index * 2 * Math.PI) / banners.length;
        const xOffset = Math.round(Math.cos(angle) * radius);
        const yOffset = Math.round(Math.sin(angle) * radius);

        return (
          <Paper
            key={banner.id}
            component="button"
            type="button"
            elevation={0}
            aria-label={`Select ${banner.title}`}
            onClick={(event) => {
              stopMapInteraction(event);
              onSelect(banner);
            }}
            onMouseDown={stopMapInteraction}
            onPointerDown={stopMapInteraction}
            onTouchStart={stopMapInteraction}
            onTouchMove={stopMapInteraction}
            onWheel={stopMapInteraction}
            sx={{
              position: "absolute",
              left: `clamp(${
                DISAMBIGUATION_PICKER_MARGIN + thumbnailWidth / 2
              }px, calc(${centerX}px + ${xOffset}px), calc(100% - ${
                DISAMBIGUATION_PICKER_MARGIN + thumbnailWidth / 2
              }px))`,
              top: `clamp(${
                DISAMBIGUATION_PICKER_MARGIN + thumbnailHeight / 2
              }px, calc(${centerY}px + ${yOffset}px), calc(100% - ${
                DISAMBIGUATION_PICKER_MARGIN + thumbnailHeight / 2
              }px))`,
              transform: "translate(-50%, -50%)",
              width: thumbnailWidth,
              minHeight: thumbnailHeight,
              p: 0.5,
              borderRadius: 1.5,
              border: "1px solid rgba(255,255,255,0.18)",
              bgcolor: "rgba(18,25,31,0.94)",
              color: "inherit",
              boxShadow: "0 16px 34px rgba(0,0,0,0.32)",
              backdropFilter: "blur(12px)",
              cursor: "pointer",
              overflow: "hidden",
              transition:
                "border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease",
              "&:hover": {
                borderColor: "rgba(126,200,255,0.65)",
                boxShadow: "0 18px 38px rgba(0,0,0,0.38)",
                transform: "translate(-50%, -50%) scale(1.04)",
              },
              "&:focus-visible": {
                outline: "2px solid #7ec8ff",
                outlineOffset: 2,
              },
            }}
          >
            <Box
              sx={{
                width: "100%",
                minHeight: thumbnailHeight - 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "rgba(255,255,255,0.04)",
                overflow: "hidden",
                borderRadius: 1,
              }}
            >
              {banner.picture ? (
                <Box
                  component="img"
                  src={`https://api.bannergress.com${banner.picture}`}
                  alt=""
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
          </Paper>
        );
      })}
    </Box>
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
  bannerFilters = DEFAULT_MAP_BANNER_FILTERS,
  onBannerFiltersChange,
}) {
  const initialImageSizePreference = readInitialImageSizePreference();
  const [visibleArea, setVisibleArea] = useState(null);
  const [banners, setBanners] = useState([]);
  const [hasMoreBannersInView, setHasMoreBannersInView] = useState(false);
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
  const [isCompactControlsOpen, setIsCompactControlsOpen] = useState(false);
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
  const discoveryMapRequestKey = useMemo(
    () =>
      discoveryMapQueryKey
        ? [
            discoveryMapQueryKey,
            DISCOVERY_MAP_MAX_FETCHED_BANNERS,
            bannerFilters.showOfflineBanners ? "offline" : "online-only",
            bannerFilters.showHiddenBanners ? "show-hidden" : "hide-hidden",
          ].join(":")
        : "",
    [
      bannerFilters.showHiddenBanners,
      bannerFilters.showOfflineBanners,
      discoveryMapQueryKey,
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
        setHasMoreBannersInView(Boolean(cachedEntry.hasMore));
        setLoading(false);
        return;
      }

      setLoading(true);

      const originLatitude = normalizedOriginLocation.latitude;
      const originLongitude = normalizedOriginLocation.longitude;

      try {
        let responsePromise = discoveryMapInflightRequests.get(
          discoveryMapRequestKey
        );

        if (!responsePromise) {
          responsePromise = fetchDiscoveryMapBanners({
            visibleArea: normalizedVisibleArea,
            originLatitude,
            originLongitude,
            showOfflineBanners: bannerFilters.showOfflineBanners,
            showHiddenBanners: bannerFilters.showHiddenBanners,
          });
          discoveryMapInflightRequests.set(
            discoveryMapRequestKey,
            responsePromise
          );
        }

        const data = await responsePromise;

        if (ignore) {
          return;
        }

        const normalizedBanners = normalizeFetchedBanners(
          data?.banners,
          originLatitude,
          originLongitude
        );

        if (!normalizedBanners) {
          setBanners([]);
          setHasMoreBannersInView(false);
          setError("Map results returned an unexpected response.");
          return;
        }

        discoveryMapCache.set(discoveryMapRequestKey, {
          banners: normalizedBanners,
          hasMore: data.hasMore,
          timestamp: Date.now(),
        });
        setBanners(normalizedBanners);
        setHasMoreBannersInView(data.hasMore);
      } catch (fetchError) {
        if (!ignore) {
          console.error("Error fetching banners:", fetchError);
          setBanners([]);
          setHasMoreBannersInView(false);
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
      markerDescriptors,
      interactionPoint,
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
      markerDescriptors,
      interactionPoint,
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

  const markerDescriptors = useMemo(() => {
    const mapInstance = mapRef.current;

    const createDescriptor = (banner, anchorPoint = null, position = null) => {
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

      const resolvedPosition = position ?? [banner._latitude, banner._longitude];
      const isDisplaced =
        anchorPoint &&
        (Math.abs(resolvedPosition[0] - banner._latitude) > 0.0000001 ||
          Math.abs(resolvedPosition[1] - banner._longitude) > 0.0000001);

      return {
        banner,
        icon,
        anchorPoint,
        position: resolvedPosition,
        originalPosition: [banner._latitude, banner._longitude],
        isDisplaced,
        connectorColor:
          CONNECTOR_LINE_COLORS[
            Math.abs(
              String(banner.id)
                .split("")
                .reduce((sum, character) => sum + character.charCodeAt(0), 0)
            ) % CONNECTOR_LINE_COLORS.length
          ],
      };
    };

    if (!mapInstance?.latLngToContainerPoint || !mapInstance?.containerPointToLatLng) {
      return displayedBanners.map((banner) => createDescriptor(banner));
    }

    const rawMarkers = displayedBanners
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

        return {
          banner,
          anchorPoint,
        };
      })
      .filter(Boolean)
      .sort((markerA, markerB) => markerA.anchorPoint.y - markerB.anchorPoint.y);

    return separateMarkerAnchorPoints(rawMarkers, markerDisplay).map(
      ({ banner, anchorPoint }) => {
        const adjustedLatLng = mapInstance.containerPointToLatLng(anchorPoint);
        return createDescriptor(banner, anchorPoint, [adjustedLatLng.lat, adjustedLatLng.lng]);
      }
    );
  }, [
    displayedBanners,
    markerDisplay.maxHeight,
    markerDisplay.maxWidth,
    selectedBannerId,
  ]);

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

        {markerDescriptors.map(
          ({ banner, icon, position, originalPosition, isDisplaced, connectorColor }) => (
            <Fragment key={banner.id}>
              {isDisplaced ? (
                <Polyline
                  positions={[originalPosition, position]}
                  pathOptions={{
                    color: connectorColor,
                    weight: 3,
                    opacity: 0.9,
                  }}
                />
              ) : null}
              <Marker
                position={position}
                icon={icon}
                eventHandlers={{
                  click: (event) => {
                    handleBannerInteraction(banner, event);
                  },
                }}
              />
            </Fragment>
          )
        )}

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
          top: { xs: 10, lg: 16 },
          left: { xs: 10, lg: 16 },
          zIndex: 1000,
          width: { xs: "fit-content", lg: "min(420px, calc(100vw - 32px))" },
          maxWidth: { xs: "calc(100vw - 20px)", lg: "min(420px, calc(100vw - 32px))" },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: { xs: 0.75, lg: 1 },
            borderRadius: 2.5,
            bgcolor: "rgba(18,25,31,0.92)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 14px 30px rgba(0,0,0,0.2)",
            backdropFilter: "blur(16px)",
          }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between">
            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
              <Typography
                variant="overline"
                sx={{
                  display: { xs: "none", lg: "block" },
                  color: "text.secondary",
                  letterSpacing: "0.12em",
                }}
              >
                Discovery Map
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: { xs: "calc(100vw - 116px)", lg: "none" },
                }}
              >
                {loading
                  ? "Updating..."
                  : hasMoreBannersInView
                    ? `Showing nearest ${displayedBanners.length} banners`
                    : `${displayedBanners.length} banners in view`}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={0.5} alignItems="center">
              <Button
                variant="contained"
                size="small"
                aria-label={userLocation ? "Recenter map" : "Locate me"}
                startIcon={<MyLocationRoundedIcon />}
                onClick={requestCurrentPosition}
                sx={{
                  minWidth: { xs: 36, lg: 64 },
                  width: { xs: 36, lg: "auto" },
                  px: { xs: 0, lg: 1.25 },
                  "& .MuiButton-startIcon": {
                    m: { xs: 0, lg: "0 8px 0 -4px" },
                  },
                }}
              >
                <Box
                  component="span"
                  sx={{ display: { xs: "none", lg: "inline" } }}
                >
                  {userLocation ? "Recenter" : "Locate me"}
                </Box>
              </Button>
              <IconButton
                color="inherit"
                aria-label={
                  isCompactControlsOpen
                    ? "Hide map controls"
                    : "Show map controls"
                }
                onClick={() =>
                  setIsCompactControlsOpen((currentValue) => !currentValue)
                }
                sx={{
                  display: { xs: "inline-flex", lg: "none" },
                  width: 36,
                  height: 36,
                  bgcolor: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 1,
                }}
              >
                <TuneRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>

          <Stack
            direction={{ xs: "row", lg: "row" }}
            spacing={1}
            alignItems="center"
            sx={{
              display: {
                xs: isCompactControlsOpen ? "flex" : "none",
                lg: "flex",
              },
              mt: 1,
            }}
          >
            <Button
              variant="outlined"
              size="small"
              color="inherit"
              startIcon={<PhotoSizeSelectLargeRoundedIcon />}
              aria-label={`Image size: ${activeImageSizeLabel}`}
              onClick={(event) => setImageSizeMenuAnchor(event.currentTarget)}
              sx={{
                justifyContent: "space-between",
                borderColor: "rgba(255,255,255,0.16)",
                color: "inherit",
                minWidth: { xs: 36, lg: 64 },
                width: { xs: 36, lg: "auto" },
                px: { xs: 0, lg: 1.25 },
                "& .MuiButton-startIcon": {
                  m: { xs: 0, lg: "0 8px 0 -4px" },
                },
              }}
            >
              <Box
                component="span"
                sx={{ display: { xs: "none", lg: "inline" } }}
              >
                Image size: {activeImageSizeLabel}
              </Box>
            </Button>

            <BannerFilterButton
              filters={bannerFilters}
              onChange={onBannerFiltersChange}
              color="inherit"
              doneBannersFilterMode="show"
              showMinimumMissionsFilter
              labelSx={{ display: { xs: "none", lg: "inline" } }}
              sx={{
                justifyContent: "space-between",
                borderColor: "rgba(255,255,255,0.16)",
                color: "inherit",
                minWidth: { xs: 36, lg: 64 },
                width: { xs: 36, lg: "auto" },
                px: { xs: 0, lg: 1.25 },
                "& .MuiButton-startIcon": {
                  m: { xs: 0, lg: "0 8px 0 -4px" },
                },
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
            Enable location to sort around you.
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
