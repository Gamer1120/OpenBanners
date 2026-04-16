import { Marker, useMap } from "react-leaflet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";

const MIN_DIRECTION_DISTANCE_METERS = 5;
const MIN_DIRECTION_CHANGE_DEGREES = 3;
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 5000,
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

export default function LocationMarker() {
  const [position, setPosition] = useState(null);
  const [direction, setDirection] = useState(null);
  const map = useMap();
  const previousPositionRef = useRef(null);
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

  useEffect(() => {
    if (!navigator.geolocation) {
      return () => {};
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
          return;
        }

        const nextPosition = {
          lat: coords.latitude,
          lng: coords.longitude,
        };
        const previousPosition = previousPositionRef.current;

        setPosition(nextPosition);
        map.setView(nextPosition, map.getZoom());

        const geolocationHeading = extractGeolocationHeading(coords);

        if (Number.isFinite(geolocationHeading)) {
          headingSourcesRef.current.geolocation = geolocationHeading;
        }

        if (
          previousPosition &&
          map.distance(previousPosition, nextPosition) >= MIN_DIRECTION_DISTANCE_METERS
        ) {
          headingSourcesRef.current.movement = calculateBearing(
            previousPosition,
            nextPosition
          );
        }

        previousPositionRef.current = nextPosition;
        updateEffectiveHeading();
      },
      (error) => {
        console.error("Couldn't watch user location in BannerGuider.", error);
      },
      GEOLOCATION_OPTIONS
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [map, updateEffectiveHeading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const handleOrientation = (event) => {
      const orientationHeading = extractOrientationHeading(event);

      if (!Number.isFinite(orientationHeading)) {
        return;
      }

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
