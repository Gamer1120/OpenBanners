import { Marker, useMap } from "react-leaflet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";
import L from "leaflet";

const MIN_MOVEMENT_HEADING_DISTANCE_METERS = 18;
const MIN_DIRECTION_CHANGE_DEGREES = 8;
const MIN_POSITION_CHANGE_METERS = 3;
const MAX_TRACKED_ACCURACY_METERS = 100;
const MAX_HEADING_ACCURACY_METERS = 30;
const MIN_TRUSTED_GEO_HEADING_SPEED_MPS = 1.4;
const MIN_TRUSTED_MOVEMENT_SPEED_MPS = 0.9;
const ORIENTATION_UPDATE_INTERVAL_MS = 250;
const CACHED_INITIAL_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: Infinity,
  timeout: 1000,
};
const FRESH_INITIAL_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 3500,
};
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 2000,
  timeout: 15000,
};

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function normalizeHeading(heading) {
  if (!Number.isFinite(heading)) {
    return null;
  }

  return ((heading % 360) + 360) % 360;
}

function getHeadingDifferenceDegrees(firstHeading, secondHeading) {
  if (!Number.isFinite(firstHeading) || !Number.isFinite(secondHeading)) {
    return Infinity;
  }

  const difference = Math.abs(firstHeading - secondHeading) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function calculateBearing(from, to) {
  if (!from || !to) {
    return null;
  }

  const latitude1 = toRadians(from.lat);
  const latitude2 = toRadians(to.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);

  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function getScreenOrientationAngle() {
  if (typeof window === "undefined") {
    return 0;
  }

  if (Number.isFinite(window.screen?.orientation?.angle)) {
    return window.screen.orientation.angle;
  }

  if (Number.isFinite(window.orientation)) {
    return window.orientation;
  }

  return 0;
}

function extractOrientationHeading(event) {
  if (!event) {
    return null;
  }

  if (Number.isFinite(event.webkitCompassHeading)) {
    return normalizeHeading(event.webkitCompassHeading);
  }

  const alpha = Number(event.alpha);

  if (!Number.isFinite(alpha)) {
    return null;
  }

  return normalizeHeading(360 - alpha + getScreenOrientationAngle());
}

function extractGeolocationHeading(coords) {
  return normalizeHeading(Number(coords?.heading));
}

function extractTrustedSpeed(coords) {
  const speed = Number(coords?.speed);
  return Number.isFinite(speed) && speed >= 0 ? speed : null;
}

function getDesiredVisiblePoint(map) {
  const mapContainer = typeof map.getContainer === "function" ? map.getContainer() : null;
  const overlay = mapContainer?.querySelector('[data-map-overlay="mission-controls"]');
  const mapRect = mapContainer?.getBoundingClientRect?.();
  const overlayRect = overlay?.getBoundingClientRect?.();

  const bottomReservedSpace = mapRect
    ? Math.max(56, Math.min(mapRect.height * 0.22, 120))
    : 72;

  if (mapRect && overlayRect) {
    const overlayRight = overlayRect.right - mapRect.left;
    const overlayBottom = overlayRect.bottom - mapRect.top;
    const safeLeft = Math.min(mapRect.width - 40, overlayRight + 24);
    const safeTop = Math.min(mapRect.height - 40, overlayBottom + 24);
    const safeBottom = Math.max(safeTop + 40, mapRect.height - bottomReservedSpace);

    return L.point(
      safeLeft + Math.max(0, (mapRect.width - safeLeft) / 2),
      safeTop + Math.max(24, (safeBottom - safeTop) * 0.62)
    );
  }

  const mapSize = typeof map.getSize === "function" ? map.getSize() : null;
  return mapSize
    ? L.point(
        mapSize.x * 0.55,
        Math.min(mapSize.y * 0.5, Math.max(56, mapSize.y - bottomReservedSpace - 12))
      )
    : null;
}

function shouldAcceptPositionUpdate({
  previousPosition,
  previousAccuracy,
  nextPosition,
  nextAccuracy,
  map,
}) {
  if (!previousPosition) {
    return true;
  }

  if (Number.isFinite(nextAccuracy) && nextAccuracy > MAX_TRACKED_ACCURACY_METERS) {
    return false;
  }

  const distance = map.distance(previousPosition, nextPosition);
  const accuracyThreshold = Math.max(
    MIN_POSITION_CHANGE_METERS,
    Math.min(
      Number.isFinite(nextAccuracy) ? nextAccuracy * 0.2 : MIN_POSITION_CHANGE_METERS,
      8
    ),
    Math.min(
      Number.isFinite(previousAccuracy)
        ? previousAccuracy * 0.15
        : MIN_POSITION_CHANGE_METERS,
      6
    )
  );

  return distance >= accuracyThreshold;
}

export default function LocationMarker() {
  const [position, setPosition] = useState(null);
  const [direction, setDirection] = useState(null);
  const map = useMap();
  const previousPositionRef = useRef(null);
  const previousAccuracyRef = useRef(null);
  const hasCenteredRef = useRef(false);
  const latestPositionRef = useRef(null);
  const lastOrientationUpdateAtRef = useRef(0);
  const hasNativeOrientationRef = useRef(false);
  const headingSourcesRef = useRef({
    orientation: null,
    geolocation: null,
    movement: null,
  });

  const updateEffectiveHeading = useCallback(() => {
    const nextDirection =
      headingSourcesRef.current.orientation ??
      headingSourcesRef.current.geolocation ??
      headingSourcesRef.current.movement;

    setDirection((currentDirection) => {
      if (!Number.isFinite(nextDirection)) {
        return currentDirection ?? null;
      }

      if (
        Number.isFinite(currentDirection) &&
        getHeadingDifferenceDegrees(currentDirection, nextDirection) <
          MIN_DIRECTION_CHANGE_DEGREES
      ) {
        return currentDirection;
      }

      return nextDirection;
    });
  }, []);

  const processLocationCoords = useCallback(
    (coords) => {
      if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
        return;
      }

      const nextPosition = {
        lat: coords.latitude,
        lng: coords.longitude,
      };
      const previousPosition = previousPositionRef.current;
      const nextAccuracy = Number(coords.accuracy);
      const speedMetersPerSecond = extractTrustedSpeed(coords);

      if (
        !shouldAcceptPositionUpdate({
          previousPosition,
          previousAccuracy: previousAccuracyRef.current,
          nextPosition,
          nextAccuracy,
          map,
        })
      ) {
        return;
      }

      setPosition(nextPosition);
      latestPositionRef.current = nextPosition;

      const desiredPoint = getDesiredVisiblePoint(map);
      if (!desiredPoint || typeof map.containerPointToLatLng !== "function") {
        return;
      }

      const offsetTargetLatLng = map.containerPointToLatLng(desiredPoint);

      if (!hasCenteredRef.current) {
        map.setView(offsetTargetLatLng, map.getZoom());
        hasCenteredRef.current = true;
      } else {
        map.panTo(offsetTargetLatLng, {
          animate: true,
          duration: 0.35,
        });
      }

      if (!hasNativeOrientationRef.current) {
        const geolocationHeading = extractGeolocationHeading(coords);

        if (
          Number.isFinite(geolocationHeading) &&
          (!Number.isFinite(nextAccuracy) ||
            nextAccuracy <= MAX_HEADING_ACCURACY_METERS) &&
          Number.isFinite(speedMetersPerSecond) &&
          speedMetersPerSecond >= MIN_TRUSTED_GEO_HEADING_SPEED_MPS
        ) {
          headingSourcesRef.current.geolocation = geolocationHeading;
        }

        if (
          previousPosition &&
          map.distance(previousPosition, nextPosition) >=
            Math.max(
              MIN_MOVEMENT_HEADING_DISTANCE_METERS,
              Number.isFinite(nextAccuracy) ? nextAccuracy * 0.75 : 0
            ) &&
          (!Number.isFinite(nextAccuracy) ||
            nextAccuracy <= MAX_HEADING_ACCURACY_METERS) &&
          (!Number.isFinite(speedMetersPerSecond) ||
            speedMetersPerSecond >= MIN_TRUSTED_MOVEMENT_SPEED_MPS)
        ) {
          headingSourcesRef.current.movement = calculateBearing(
            previousPosition,
            nextPosition
          );
        }
      }

      previousPositionRef.current = nextPosition;
      previousAccuracyRef.current = Number.isFinite(nextAccuracy)
        ? nextAccuracy
        : previousAccuracyRef.current;
      updateEffectiveHeading();
    },
    [map, updateEffectiveHeading]
  );

  useEffect(() => {
    const recenterToLatestPosition = () => {
      const latestPosition = latestPositionRef.current;
      if (!latestPosition) {
        return;
      }

      const desiredPoint = getDesiredVisiblePoint(map);
      if (!desiredPoint || typeof map.containerPointToLatLng !== "function") {
        return;
      }

      const nextCenter = map.containerPointToLatLng(desiredPoint);
      map.setView(nextCenter, map.getZoom(), { animate: false });
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", recenterToLatestPosition);
    }

    if (typeof map.on === "function") {
      map.on("resize", recenterToLatestPosition);
      map.on("zoomend", recenterToLatestPosition);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", recenterToLatestPosition);
      }

      if (typeof map.off === "function") {
        map.off("resize", recenterToLatestPosition);
        map.off("zoomend", recenterToLatestPosition);
      }
    };
  }, [map]);

  useEffect(() => {
    if (!navigator.geolocation) {
      return () => {};
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        processLocationCoords(coords);
      },
      () => {},
      CACHED_INITIAL_GEOLOCATION_OPTIONS
    );

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        processLocationCoords(coords);
      },
      () => {},
      FRESH_INITIAL_GEOLOCATION_OPTIONS
    );

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        processLocationCoords(coords);
      },
      (error) => {
        console.error("Couldn't watch user location in BannerGuider.", error);
      },
      GEOLOCATION_OPTIONS
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [processLocationCoords]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const handleOrientation = (event) => {
      const now = Date.now();

      if (
        now - lastOrientationUpdateAtRef.current <
        ORIENTATION_UPDATE_INTERVAL_MS
      ) {
        return;
      }

      const orientationHeading = extractOrientationHeading(event);

      if (!Number.isFinite(orientationHeading)) {
        return;
      }

      lastOrientationUpdateAtRef.current = now;
      hasNativeOrientationRef.current = true;
      headingSourcesRef.current.orientation = orientationHeading;
      updateEffectiveHeading();
    };

    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);

    return () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        handleOrientation,
        true
      );
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [updateEffectiveHeading]);

  return position === null ? null : (
    <Marker
      position={position}
      icon={locationIcon(direction) || icon}
      zIndexOffset={2000}
    />
  );
}
