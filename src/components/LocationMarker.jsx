import { Marker, useMap } from "react-leaflet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";

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
  const lastOrientationUpdateAtRef = useRef(0);
  const hasNativeOrientationRef = useRef(false);
  const headingSourcesRef = useRef({
    orientation: null,
    geolocation: null,
    movement: null,
  });
  const followOffsetRef = useRef({ lat: 0, lng: 0 });
  const latestPositionRef = useRef(null);
  const suppressProgrammaticMoveRef = useRef(false);

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

  const refreshFollowOffsetFromCurrentView = useCallback(() => {
    const latestPosition = latestPositionRef.current;
    if (!latestPosition || typeof map.getCenter !== "function") {
      return;
    }

    const currentCenter = map.getCenter();
    if (!currentCenter) {
      return;
    }

    followOffsetRef.current = {
      lat: currentCenter.lat - latestPosition.lat,
      lng: currentCenter.lng - latestPosition.lng,
    };
  }, [map]);

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

      if (!hasCenteredRef.current) {
        map.setView(nextPosition, map.getZoom());
        followOffsetRef.current = { lat: 0, lng: 0 };
        hasCenteredRef.current = true;
      } else {
        suppressProgrammaticMoveRef.current = true;
        map.panTo(
          {
            lat: nextPosition.lat + followOffsetRef.current.lat,
            lng: nextPosition.lng + followOffsetRef.current.lng,
          },
          {
            animate: true,
            duration: 0.35,
          }
        );
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
    const handleViewportChanged = () => {
      if (suppressProgrammaticMoveRef.current) {
        suppressProgrammaticMoveRef.current = false;
        return;
      }

      refreshFollowOffsetFromCurrentView();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleViewportChanged);
    }

    if (typeof map.on === "function") {
      map.on("resize", handleViewportChanged);
      map.on("zoomend", handleViewportChanged);
      map.on("moveend", handleViewportChanged);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleViewportChanged);
      }

      if (typeof map.off === "function") {
        map.off("resize", handleViewportChanged);
        map.off("zoomend", handleViewportChanged);
        map.off("moveend", handleViewportChanged);
      }
    };
  }, [map, refreshFollowOffsetFromCurrentView]);

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
      headingSourcesRef.current.geolocation = null;
      headingSourcesRef.current.movement = null;
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
