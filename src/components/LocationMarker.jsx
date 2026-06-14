import { Marker, useMap } from "react-leaflet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";
import {
  getBannerGuiderLocationGeometry,
  getCenteredMapTarget,
} from "../bannerGuiderLocationGeometry";

const MIN_DIRECTION_DISTANCE_METERS = 5;
const MIN_DIRECTION_CHANGE_DEGREES = 8;
const MIN_POSITION_CHANGE_METERS = 8;
const MAX_TRACKED_ACCURACY_METERS = 75;
const GEOLOCATION_POLL_INTERVAL_MS = 2000;
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

export default function LocationMarker({
  onDebugSnapshot = null,
  mapViewportRevision = 0,
}) {
  const [position, setPosition] = useState(null);
  const [direction, setDirection] = useState(null);
  const map = useMap();
  const previousPositionRef = useRef(null);
  const previousAccuracyRef = useRef(null);
  const latestProcessedPositionRef = useRef(null);
  const manualInteractionAnchorRef = useRef(null);
  const followSuspendedRef = useRef(false);
  const hasCenteredRef = useRef(false);
  const lastRecenterAttemptRef = useRef(null);

  const publishDebugSnapshot = useCallback(
    (snapshot) => {
      onDebugSnapshot?.({
        ...snapshot,
        pollIntervalMs: GEOLOCATION_POLL_INTERVAL_MS,
        geolocationOptions: GEOLOCATION_OPTIONS,
        maxTrackedAccuracyMeters: MAX_TRACKED_ACCURACY_METERS,
      });
    },
    [onDebugSnapshot]
  );

  const updateDirectionFromMovement = useCallback((nextDirection) => {
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
    (
      nextPosition,
      { forceSetView = false, reason = "location-update" } = {}
    ) => {
      const attemptedAt = new Date().toISOString();

      if (!nextPosition) {
        const attempt = {
          attemptedAt,
          reason,
          attempted: false,
          skipped: true,
          skipReason: "missing-position",
        };
        lastRecenterAttemptRef.current = attempt;
        return attempt;
      }

      const shouldResetView = forceSetView || !hasCenteredRef.current;
      const geometry = getBannerGuiderLocationGeometry(map);

      if (shouldResetView) {
        map.stop?.();
        map.invalidateSize?.({
          animate: false,
          pan: false,
        });
      }

      const centeredTarget = getCenteredMapTarget(map, nextPosition);
      const currentCenter = map.getCenter?.();
      const recenterDistance =
        currentCenter && typeof map.distance === "function"
          ? map.distance(currentCenter, centeredTarget)
          : Infinity;
      const attemptBase = {
        attemptedAt,
        reason,
        attempted: true,
        skipped: false,
        forceSetView,
        shouldResetView,
        nextPosition,
        currentCenterBefore: currentCenter ?? null,
        centeredTarget,
        targetPoint: geometry.canCalculate ? geometry.targetPoint : null,
        geometryReason: geometry.canCalculate ? geometry.horizontal?.reason : geometry.reason,
        recenterDistanceMeters: Number.isFinite(recenterDistance)
          ? recenterDistance
          : null,
        zoom: map.getZoom?.() ?? null,
      };

      if (
        !forceSetView &&
        hasCenteredRef.current &&
        Number.isFinite(recenterDistance) &&
        recenterDistance < 1
      ) {
        const attempt = {
          ...attemptBase,
          skipped: true,
          skipReason: "already-centered",
          currentCenterAfter: currentCenter ?? null,
        };
        lastRecenterAttemptRef.current = attempt;
        return attempt;
      }

      const setViewOptions = shouldResetView
        ? {
            animate: false,
            reset: true,
          }
        : {
            animate: false,
          };

      map.setView(centeredTarget, map.getZoom(), setViewOptions);
      hasCenteredRef.current = true;
      const attempt = {
        ...attemptBase,
        setViewOptions,
        currentCenterAfter: map.getCenter?.() ?? null,
      };
      lastRecenterAttemptRef.current = attempt;
      return attempt;
    },
    [map]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      publishDebugSnapshot({
        status: "geolocation-unavailable",
        receivedAt: new Date().toISOString(),
      });

      return () => {};
    }

    const handlePositionUpdate = ({ coords }) => {
      if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
        publishDebugSnapshot({
          status: "invalid-coordinates",
          receivedAt: new Date().toISOString(),
          rawCoords: {
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
            accuracy: coords?.accuracy ?? null,
            altitude: coords?.altitude ?? null,
            altitudeAccuracy: coords?.altitudeAccuracy ?? null,
            heading: coords?.heading ?? null,
            speed: coords?.speed ?? null,
          },
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
        publishDebugSnapshot({
          status: "ignored-inaccurate",
          receivedAt: new Date().toISOString(),
          position: nextPosition,
          accuracy: nextAccuracy,
          rawCoords: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy ?? null,
            altitude: coords.altitude ?? null,
            altitudeAccuracy: coords.altitudeAccuracy ?? null,
            heading: coords.heading ?? null,
            speed: coords.speed ?? null,
          },
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
        followSuspendedRef.current = false;
        manualInteractionAnchorRef.current = null;
      }

      const recentered = !followSuspendedRef.current;
      let recenterAttempt = null;

      if (!followSuspendedRef.current) {
        recenterAttempt = recenterMap(nextPosition);
      }

      const acceptedPositionUpdate = shouldAcceptPositionUpdate({
        previousPosition,
        previousAccuracy: previousAccuracyRef.current,
        nextPosition,
        nextAccuracy,
        map,
      });

      publishDebugSnapshot({
        status: acceptedPositionUpdate ? "accepted" : "stationary",
        receivedAt: new Date().toISOString(),
        position: nextPosition,
        previousPosition,
        accuracy: Number.isFinite(nextAccuracy) ? nextAccuracy : null,
        previousAccuracy: previousAccuracyRef.current,
        rawCoords: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy ?? null,
          altitude: coords.altitude ?? null,
          altitudeAccuracy: coords.altitudeAccuracy ?? null,
          heading: coords.heading ?? null,
          speed: coords.speed ?? null,
        },
        acceptedPositionUpdate,
        shouldResumeFollow,
        followSuspended: followSuspendedRef.current,
        manualInteractionAnchor: manualInteractionAnchorRef.current,
        recentered,
        recenterAttempt,
        lastRecenterAttempt: lastRecenterAttemptRef.current,
        hasCentered: hasCenteredRef.current,
      });

      if (!acceptedPositionUpdate) {
        return;
      }

      setPosition(nextPosition);

      if (
        previousPosition &&
        map.distance(previousPosition, nextPosition) >= MIN_DIRECTION_DISTANCE_METERS
      ) {
        updateDirectionFromMovement(
          calculateBearing(previousPosition, nextPosition)
        );
      }

      previousPositionRef.current = nextPosition;
      previousAccuracyRef.current = Number.isFinite(nextAccuracy)
        ? nextAccuracy
        : previousAccuracyRef.current;
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
  }, [map, publishDebugSnapshot, recenterMap, updateDirectionFromMovement]);

  useEffect(() => {
    if (
      !mapViewportRevision ||
      !latestProcessedPositionRef.current ||
      followSuspendedRef.current
    ) {
      return;
    }

    const recenterAttempt = recenterMap(latestProcessedPositionRef.current, {
      forceSetView: true,
      reason: "map-viewport-change",
    });

    publishDebugSnapshot({
      status: "map-viewport-change-recentered",
      receivedAt: new Date().toISOString(),
      position: latestProcessedPositionRef.current,
      previousPosition: previousPositionRef.current,
      accuracy: previousAccuracyRef.current,
      previousAccuracy: previousAccuracyRef.current,
      followSuspended: followSuspendedRef.current,
      manualInteractionAnchor: manualInteractionAnchorRef.current,
      recentered: true,
      recenterAttempt,
      lastRecenterAttempt: lastRecenterAttemptRef.current,
      hasCentered: hasCenteredRef.current,
      mapViewportRevision,
    });
  }, [mapViewportRevision, publishDebugSnapshot, recenterMap]);

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
      if (!latestProcessedPositionRef.current) {
        return;
      }

      followSuspendedRef.current = false;
      manualInteractionAnchorRef.current = null;
    };

    map.on?.("dragstart", handleManualViewportChange);
    map.on?.("zoomstart", handleManualViewportChange);

    return () => {
      map.off?.("dragstart", handleManualViewportChange);
      map.off?.("zoomstart", handleManualViewportChange);
    };
  }, [map]);


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
