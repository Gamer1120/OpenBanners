import { Marker, useMap } from "react-leaflet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";
import { logBannerGuiderDebug } from "../bannerGuiderDebug";

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

function roundDebugNumber(value) {
  if (!Number.isFinite(value)) {
    return value ?? null;
  }

  return Math.round(value * 1000) / 1000;
}

function serializeLatLng(value) {
  if (!value) {
    return null;
  }

  const latitude = Number(value.lat ?? value.latitude);
  const longitude = Number(value.lng ?? value.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    lat: roundDebugNumber(latitude),
    lng: roundDebugNumber(longitude),
  };
}

function serializePoint(point) {
  if (!point) {
    return null;
  }

  const x = Number(point.x);
  const y = Number(point.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: roundDebugNumber(x),
    y: roundDebugNumber(y),
  };
}

function serializeRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    left: roundDebugNumber(rect.left),
    top: roundDebugNumber(rect.top),
    right: roundDebugNumber(rect.right),
    bottom: roundDebugNumber(rect.bottom),
    width: roundDebugNumber(rect.width),
    height: roundDebugNumber(rect.height),
  };
}

function getDebugWindowMetrics() {
  if (typeof window === "undefined") {
    return null;
  }

  return {
    innerWidth: roundDebugNumber(window.innerWidth),
    innerHeight: roundDebugNumber(window.innerHeight),
    outerWidth: roundDebugNumber(window.outerWidth),
    outerHeight: roundDebugNumber(window.outerHeight),
    visualViewport: window.visualViewport
      ? {
          width: roundDebugNumber(window.visualViewport.width),
          height: roundDebugNumber(window.visualViewport.height),
          offsetLeft: roundDebugNumber(window.visualViewport.offsetLeft),
          offsetTop: roundDebugNumber(window.visualViewport.offsetTop),
          pageLeft: roundDebugNumber(window.visualViewport.pageLeft),
          pageTop: roundDebugNumber(window.visualViewport.pageTop),
          scale: roundDebugNumber(window.visualViewport.scale),
        }
      : null,
  };
}

function getDebugMapMetrics(map) {
  const container = map?.getContainer?.();
  const containerRect = normalizeRect(container?.getBoundingClientRect?.());
  const mapSize = map?.getSize?.();

  return {
    center: serializeLatLng(map?.getCenter?.()),
    zoom: roundDebugNumber(map?.getZoom?.()),
    size: mapSize
      ? {
          x: roundDebugNumber(mapSize.x),
          y: roundDebugNumber(mapSize.y),
        }
      : null,
    containerRect: serializeRect(containerRect),
  };
}

function debugBannerGuider(label, details = {}) {
  logBannerGuiderDebug(label, {
    ...details,
    window: details.window ?? getDebugWindowMetrics(),
  });
}

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
  const shouldAccept = distance >= accuracyThreshold;

  debugBannerGuider("shouldAcceptPositionUpdate", {
    previousPosition: serializeLatLng(previousPosition),
    nextPosition: serializeLatLng(nextPosition),
    previousAccuracy: roundDebugNumber(previousAccuracy),
    nextAccuracy: roundDebugNumber(nextAccuracy),
    distance: roundDebugNumber(distance),
    accuracyThreshold: roundDebugNumber(accuracyThreshold),
    shouldAccept,
    map: getDebugMapMetrics(map),
  });

  return shouldAccept;
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
    debugBannerGuider("getViewportRect invalid", {
      width: roundDebugNumber(width),
      height: roundDebugNumber(height),
    });
    return null;
  }

  const viewportRect = {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
  };

  debugBannerGuider("getViewportRect", {
    viewportRect: serializeRect(viewportRect),
  });

  return viewportRect;
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

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getPreferredTargetPoint(map) {
  const containerRect = normalizeRect(map.getContainer?.()?.getBoundingClientRect?.());

  if (!containerRect) {
    debugBannerGuider("getPreferredTargetPoint missing-container-rect", {
      map: getDebugMapMetrics(map),
    });
    return null;
  }

  const viewportRect = getViewportRect();
  const visibleRect =
    getIntersectionRect(containerRect, viewportRect) ?? containerRect;
  const targetRect = visibleRect;

  const targetCenter = getRectCenter(targetRect);
  const mapSize = map.getSize?.();
  const maxX = Number.isFinite(mapSize?.x) ? mapSize.x : containerRect.width;
  const maxY = Number.isFinite(mapSize?.y) ? mapSize.y : containerRect.height;
  const targetPoint = {
    x: clamp(targetCenter.x - containerRect.left, 0, maxX),
    y: clamp(targetCenter.y - containerRect.top, 0, maxY),
  };

  debugBannerGuider("getPreferredTargetPoint", {
    map: getDebugMapMetrics(map),
    viewportRect: serializeRect(viewportRect),
    visibleRect: serializeRect(visibleRect),
    targetRect: serializeRect(targetRect),
    targetCenter: serializePoint(targetCenter),
    targetPoint: serializePoint(targetPoint),
  });

  return targetPoint;
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
    debugBannerGuider("getCenteredMapTarget fallback-nextPosition", {
      nextPosition: serializeLatLng(nextPosition),
      targetPoint: serializePoint(targetPoint),
      userPoint: serializePoint(userPoint),
      currentCenter: serializeLatLng(currentCenter),
      currentCenterPoint: serializePoint(currentCenterPoint),
      hasContainerPointToLatLng:
        typeof map.containerPointToLatLng === "function",
      map: getDebugMapMetrics(map),
    });
    return nextPosition;
  }

  const desiredCenterPoint = {
    x: currentCenterPoint.x - (targetPoint.x - userPoint.x),
    y: currentCenterPoint.y - (targetPoint.y - userPoint.y),
  };
  const desiredCenter = map.containerPointToLatLng(desiredCenterPoint);

  if (!Number.isFinite(desiredCenter?.lat) || !Number.isFinite(desiredCenter?.lng)) {
    debugBannerGuider("getCenteredMapTarget invalid-desiredCenter", {
      nextPosition: serializeLatLng(nextPosition),
      targetPoint: serializePoint(targetPoint),
      userPoint: serializePoint(userPoint),
      currentCenter: serializeLatLng(currentCenter),
      currentCenterPoint: serializePoint(currentCenterPoint),
      desiredCenterPoint: serializePoint(desiredCenterPoint),
      desiredCenter,
      map: getDebugMapMetrics(map),
    });
    return nextPosition;
  }

  debugBannerGuider("getCenteredMapTarget", {
    nextPosition: serializeLatLng(nextPosition),
    targetPoint: serializePoint(targetPoint),
    userPoint: serializePoint(userPoint),
    currentCenter: serializeLatLng(currentCenter),
    currentCenterPoint: serializePoint(currentCenterPoint),
    desiredCenterPoint: serializePoint(desiredCenterPoint),
    desiredCenter: serializeLatLng(desiredCenter),
    map: getDebugMapMetrics(map),
  });

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
        debugBannerGuider("recenterMap skipped-missing-position", {
          forceSetView,
          map: getDebugMapMetrics(map),
        });
        return;
      }

      debugBannerGuider("recenterMap start", {
        nextPosition: serializeLatLng(nextPosition),
        forceSetView,
        hasCentered: hasCenteredRef.current,
        followSuspended: followSuspendedRef.current,
        manualInteractionAnchor: serializeLatLng(manualInteractionAnchorRef.current),
        latestProcessedPosition: serializeLatLng(latestProcessedPositionRef.current),
        map: getDebugMapMetrics(map),
      });

      map.stop?.();
      map.invalidateSize?.({
        animate: false,
        pan: false,
      });
      const centeredTarget = getCenteredMapTarget(map, nextPosition);

      if (!hasCenteredRef.current || forceSetView) {
        debugBannerGuider("recenterMap setView", {
          centeredTarget: serializeLatLng(centeredTarget),
          nextPosition: serializeLatLng(nextPosition),
          forceSetView,
          map: getDebugMapMetrics(map),
        });
        map.setView(centeredTarget, map.getZoom(), {
          animate: false,
        });
        hasCenteredRef.current = true;
        return;
      }

      debugBannerGuider("recenterMap panTo", {
        centeredTarget: serializeLatLng(centeredTarget),
        nextPosition: serializeLatLng(nextPosition),
        forceSetView,
        map: getDebugMapMetrics(map),
      });
      map.panTo(centeredTarget, {
        animate: false,
      });
    },
    [map]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      return () => {};
    }

    const handlePositionUpdate = ({ coords }) => {
      debugBannerGuider("handlePositionUpdate raw", {
        coords: {
          latitude: roundDebugNumber(coords?.latitude),
          longitude: roundDebugNumber(coords?.longitude),
          accuracy: roundDebugNumber(coords?.accuracy),
          heading: roundDebugNumber(coords?.heading),
          speed: roundDebugNumber(coords?.speed),
        },
        map: getDebugMapMetrics(map),
        previousPosition: serializeLatLng(previousPositionRef.current),
        previousAccuracy: roundDebugNumber(previousAccuracyRef.current),
        followSuspended: followSuspendedRef.current,
        manualInteractionAnchor: serializeLatLng(manualInteractionAnchorRef.current),
      });

      if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
        debugBannerGuider("handlePositionUpdate skipped-invalid-coordinates", {
          coords,
        });
        return;
      }

      const nextPosition = {
        lat: coords.latitude,
        lng: coords.longitude,
      };
      const previousPosition = previousPositionRef.current;
      const nextAccuracy = Number(coords.accuracy);

      if (Number.isFinite(nextAccuracy) && nextAccuracy > MAX_TRACKED_ACCURACY_METERS) {
        debugBannerGuider("handlePositionUpdate skipped-poor-accuracy", {
          nextPosition: serializeLatLng(nextPosition),
          nextAccuracy: roundDebugNumber(nextAccuracy),
          maxTrackedAccuracyMeters: MAX_TRACKED_ACCURACY_METERS,
          map: getDebugMapMetrics(map),
        });
        return;
      }

      latestProcessedPositionRef.current = nextPosition;

      const shouldResumeFollow =
        followSuspendedRef.current &&
        manualInteractionAnchorRef.current &&
        shouldAcceptPositionUpdate({
          previousPosition: manualInteractionAnchorRef.current,
          previousAccuracy: previousAccuracyRef.current,
          nextPosition,
          nextAccuracy,
          map,
        });

      if (shouldResumeFollow) {
        debugBannerGuider("handlePositionUpdate resume-follow", {
          nextPosition: serializeLatLng(nextPosition),
          manualInteractionAnchor: serializeLatLng(manualInteractionAnchorRef.current),
          nextAccuracy: roundDebugNumber(nextAccuracy),
          map: getDebugMapMetrics(map),
        });
        followSuspendedRef.current = false;
        manualInteractionAnchorRef.current = null;
      }

      const shouldAcceptCurrentPosition = shouldAcceptPositionUpdate({
        previousPosition,
        previousAccuracy: previousAccuracyRef.current,
        nextPosition,
        nextAccuracy,
        map,
      });
      const shouldRecenterMap =
        !followSuspendedRef.current &&
        (!previousPosition || shouldResumeFollow || shouldAcceptCurrentPosition);

      if (shouldRecenterMap) {
        recenterMap(nextPosition);
      } else if (followSuspendedRef.current) {
        debugBannerGuider("handlePositionUpdate follow-suspended", {
          nextPosition: serializeLatLng(nextPosition),
          manualInteractionAnchor: serializeLatLng(manualInteractionAnchorRef.current),
          map: getDebugMapMetrics(map),
        });
      } else {
        debugBannerGuider("handlePositionUpdate skipped-recenter-stable-fix", {
          nextPosition: serializeLatLng(nextPosition),
          previousPosition: serializeLatLng(previousPosition),
          nextAccuracy: roundDebugNumber(nextAccuracy),
          previousAccuracy: roundDebugNumber(previousAccuracyRef.current),
          map: getDebugMapMetrics(map),
        });
      }

      if (!shouldAcceptCurrentPosition) {
        debugBannerGuider("handlePositionUpdate skipped-no-meaningful-movement", {
          nextPosition: serializeLatLng(nextPosition),
          previousPosition: serializeLatLng(previousPosition),
          nextAccuracy: roundDebugNumber(nextAccuracy),
          previousAccuracy: roundDebugNumber(previousAccuracyRef.current),
          map: getDebugMapMetrics(map),
        });
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
      debugBannerGuider("handlePositionUpdate accepted", {
        nextPosition: serializeLatLng(nextPosition),
        nextAccuracy: roundDebugNumber(nextAccuracy),
        geolocationHeading: roundDebugNumber(geolocationHeading),
        movementHeading: roundDebugNumber(headingSourcesRef.current.movement),
        orientationHeading: roundDebugNumber(headingSourcesRef.current.orientation),
        geolocationHeadingSource: roundDebugNumber(
          headingSourcesRef.current.geolocation
        ),
        map: getDebugMapMetrics(map),
      });
      updateEffectiveHeading();
    };

    const handlePositionError = (error) => {
      console.error("Couldn't fetch user location in BannerGuider.", error);
      debugBannerGuider("handlePositionError", {
        error: error?.message ?? String(error),
        map: getDebugMapMetrics(map),
      });
    };

    const pollCurrentPosition = () => {
      debugBannerGuider("pollCurrentPosition", {
        geolocationOptions: GEOLOCATION_OPTIONS,
        followSuspended: followSuspendedRef.current,
        latestProcessedPosition: serializeLatLng(latestProcessedPositionRef.current),
        map: getDebugMapMetrics(map),
      });
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
      debugBannerGuider("handleLayoutChange", {
        latestProcessedPosition: serializeLatLng(latestProcessedPositionRef.current),
        followSuspended: followSuspendedRef.current,
        manualInteractionAnchor: serializeLatLng(manualInteractionAnchorRef.current),
        map: getDebugMapMetrics(map),
      });

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
      debugBannerGuider("handleManualViewportChange", {
        latestProcessedPosition: serializeLatLng(latestProcessedPositionRef.current),
        previousPosition: serializeLatLng(previousPositionRef.current),
        followSuspendedBefore: followSuspendedRef.current,
        map: getDebugMapMetrics(map),
      });

      if (!latestProcessedPositionRef.current) {
        debugBannerGuider("handleManualViewportChange ignored-no-position", {
          previousPosition: serializeLatLng(previousPositionRef.current),
          map: getDebugMapMetrics(map),
        });
        return;
      }

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
      debugBannerGuider("handleOrientation", {
        orientationHeading: roundDebugNumber(orientationHeading),
        alpha: roundDebugNumber(event.alpha),
        webkitCompassHeading: roundDebugNumber(event.webkitCompassHeading),
        map: getDebugMapMetrics(map),
      });
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
      interactive={false}
      keyboard={false}
      autoPanOnFocus={false}
      bubblingMouseEvents={false}
    />
  );
}
