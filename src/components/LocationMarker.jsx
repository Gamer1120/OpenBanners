import { Marker, useMap } from "react-leaflet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";

const MIN_DIRECTION_DISTANCE_METERS = 5;
const MIN_DIRECTION_CHANGE_DEGREES = 8;
const MIN_POSITION_CHANGE_METERS = 8;
const MAX_TRACKED_ACCURACY_METERS = 75;
const ORIENTATION_UPDATE_INTERVAL_MS = 250;
const GEOLOCATION_POLL_INTERVAL_MS = 5000;
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

  const distance = map.distance(previousPosition, nextPosition);
  const accuracyThreshold = Math.max(
    MIN_POSITION_CHANGE_METERS,
    Math.min(
      Number.isFinite(nextAccuracy) ? nextAccuracy * 0.5 : MIN_POSITION_CHANGE_METERS,
      24
    ),
    Math.min(
      Number.isFinite(previousAccuracy)
        ? previousAccuracy * 0.35
        : MIN_POSITION_CHANGE_METERS,
      16
    )
  );

  return distance >= accuracyThreshold;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeRect(rect) {
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  const right = Number(rect?.right);
  const bottom = Number(rect?.bottom);
  const width = Number(rect?.width ?? right - left);
  const height = Number(rect?.height ?? bottom - top);

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
  };
}

function getViewportRect() {
  if (typeof window === "undefined") {
    return null;
  }

  const width = Number(window.visualViewport?.width ?? window.innerWidth);
  const height = Number(window.visualViewport?.height ?? window.innerHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
  };
}

function getIntersectionRect(firstRect, secondRect) {
  if (!firstRect || !secondRect) {
    return null;
  }

  const left = Math.max(firstRect.left, secondRect.left);
  const top = Math.max(firstRect.top, secondRect.top);
  const right = Math.min(firstRect.right, secondRect.right);
  const bottom = Math.min(firstRect.bottom, secondRect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
  };
}

function getRectArea(rect) {
  return rect ? rect.width * rect.height : 0;
}

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getPreferredTargetPoint(map) {
  const containerRect = normalizeRect(map.getContainer?.()?.getBoundingClientRect?.());

  if (!containerRect) {
    return null;
  }

  const visibleRect =
    getIntersectionRect(containerRect, getViewportRect()) ?? containerRect;

  let targetRect = visibleRect;

  if (typeof document !== "undefined") {
    const overlayRect = normalizeRect(
      document
        .querySelector('[data-map-overlay="mission-controls"]')
        ?.getBoundingClientRect?.()
    );
    const overlappingOverlayRect = getIntersectionRect(visibleRect, overlayRect);

    if (overlappingOverlayRect) {
      const candidates = [
        {
          left: visibleRect.left,
          top: visibleRect.top,
          right: overlappingOverlayRect.left,
          bottom: visibleRect.bottom,
        },
        {
          left: overlappingOverlayRect.right,
          top: visibleRect.top,
          right: visibleRect.right,
          bottom: visibleRect.bottom,
        },
        {
          left: visibleRect.left,
          top: visibleRect.top,
          right: visibleRect.right,
          bottom: overlappingOverlayRect.top,
        },
        {
          left: visibleRect.left,
          top: overlappingOverlayRect.bottom,
          right: visibleRect.right,
          bottom: visibleRect.bottom,
        },
      ]
        .map((candidateRect) => normalizeRect(candidateRect))
        .filter(Boolean)
        .sort((firstRect, secondRect) => getRectArea(secondRect) - getRectArea(firstRect));

      if (candidates.length > 0) {
        targetRect = candidates[0];
      }
    }
  }

  const targetCenter = getRectCenter(targetRect);
  const mapSize = map.getSize?.();
  const maxX = Number.isFinite(mapSize?.x) ? mapSize.x : containerRect.width;
  const maxY = Number.isFinite(mapSize?.y) ? mapSize.y : containerRect.height;

  return {
    x: clamp(targetCenter.x - containerRect.left, 0, maxX),
    y: clamp(targetCenter.y - containerRect.top, 0, maxY),
  };
}

function getCenteredMapTarget(map, nextPosition) {
  const targetPoint = getPreferredTargetPoint(map);
  const userPoint = map.latLngToContainerPoint?.(nextPosition);
  const currentCenter = map.getCenter?.();
  const currentCenterPoint = currentCenter
    ? map.latLngToContainerPoint?.(currentCenter)
    : null;

  if (
    !targetPoint ||
    !userPoint ||
    !currentCenterPoint ||
    typeof map.containerPointToLatLng !== "function"
  ) {
    return nextPosition;
  }

  const desiredCenterPoint = {
    x: currentCenterPoint.x - (targetPoint.x - userPoint.x),
    y: currentCenterPoint.y - (targetPoint.y - userPoint.y),
  };
  const desiredCenter = map.containerPointToLatLng(desiredCenterPoint);

  if (!Number.isFinite(desiredCenter?.lat) || !Number.isFinite(desiredCenter?.lng)) {
    return nextPosition;
  }

  return desiredCenter;
}

export default function LocationMarker() {
  const [position, setPosition] = useState(null);
  const [direction, setDirection] = useState(null);
  const map = useMap();
  const previousPositionRef = useRef(null);
  const previousAccuracyRef = useRef(null);
  const latestProcessedPositionRef = useRef(null);
  const manualInteractionAnchorRef = useRef(null);
  const followSuspendedRef = useRef(false);
  const hasCenteredRef = useRef(false);
  const lastOrientationUpdateAtRef = useRef(0);
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

  const recenterMap = useCallback(
    (nextPosition, { forceSetView = false } = {}) => {
      if (!nextPosition) {
        return;
      }

      map.invalidateSize?.(false);
      const centeredTarget = getCenteredMapTarget(map, nextPosition);

      if (!hasCenteredRef.current || forceSetView) {
        map.setView(centeredTarget, map.getZoom());
        hasCenteredRef.current = true;
        return;
      }

      map.panTo(centeredTarget, {
        animate: true,
        duration: 0.35,
      });
    },
    [map]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      return () => {};
    }

    const handlePositionUpdate = ({ coords }) => {
      if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
        return;
      }

      const nextPosition = {
        lat: coords.latitude,
        lng: coords.longitude,
      };
      const previousPosition = previousPositionRef.current;
      const nextAccuracy = Number(coords.accuracy);

      if (Number.isFinite(nextAccuracy) && nextAccuracy > MAX_TRACKED_ACCURACY_METERS) {
        return;
      }

      latestProcessedPositionRef.current = nextPosition;

      const shouldResumeFollow =
        followSuspendedRef.current &&
        shouldAcceptPositionUpdate({
          previousPosition: manualInteractionAnchorRef.current,
          previousAccuracy: previousAccuracyRef.current,
          nextPosition,
          nextAccuracy,
          map,
        });

      if (shouldResumeFollow) {
        followSuspendedRef.current = false;
        manualInteractionAnchorRef.current = null;
      }

      if (!followSuspendedRef.current) {
        recenterMap(nextPosition);
      }

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
      previousAccuracyRef.current = Number.isFinite(nextAccuracy)
        ? nextAccuracy
        : previousAccuracyRef.current;
      updateEffectiveHeading();
    };

    const handlePositionError = (error) => {
      console.error("Couldn't fetch user location in BannerGuider.", error);
    };

    const pollCurrentPosition = () => {
      navigator.geolocation.getCurrentPosition(
        handlePositionUpdate,
        handlePositionError,
        GEOLOCATION_OPTIONS
      );
    };

    pollCurrentPosition();
    const intervalId = window.setInterval(
      pollCurrentPosition,
      GEOLOCATION_POLL_INTERVAL_MS
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [map, recenterMap, updateEffectiveHeading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const handleLayoutChange = () => {
      if (!latestProcessedPositionRef.current || followSuspendedRef.current) {
        return;
      }

      recenterMap(latestProcessedPositionRef.current, {
        forceSetView: true,
      });
    };

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", handleLayoutChange);
    visualViewport?.addEventListener?.("resize", handleLayoutChange);
    map.on?.("resize", handleLayoutChange);

    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      visualViewport?.removeEventListener?.("resize", handleLayoutChange);
      map.off?.("resize", handleLayoutChange);
    };
  }, [map, recenterMap]);

  useEffect(() => {
    const handleManualViewportChange = () => {
      followSuspendedRef.current = true;
      manualInteractionAnchorRef.current = latestProcessedPositionRef.current;
    };

    map.on?.("dragstart", handleManualViewportChange);
    map.on?.("zoomstart", handleManualViewportChange);

    return () => {
      map.off?.("dragstart", handleManualViewportChange);
      map.off?.("zoomstart", handleManualViewportChange);
    };
  }, [map]);

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
