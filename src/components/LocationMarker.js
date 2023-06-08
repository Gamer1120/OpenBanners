import { Marker, useMap } from "react-leaflet";
import React, { useState, useEffect } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";

export default function LocationMarker() {
  const [position, setPosition] = useState(null);
  const [direction, setDirection] = useState(null);

  const map = useMap();

  const calculateAngle = (alpha) => {
    // Convert alpha to a value between 0 and 360
    let angle = alpha % 360;
    if (angle < 0) {
      angle += 360;
    }
    return angle;
  };

  useEffect(() => {
    const handleDeviceOrientation = (event) => {
      const { alpha } = event;
      if (alpha !== null) {
        const bearing = calculateAngle(alpha);
        setDirection(bearing);
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", handleDeviceOrientation);
    }

    const handleLocationFound = (e) => {
      setPosition(e.latlng);
      map.flyTo(e.latlng, map.getZoom());
    };

    map.locate().on("locationfound", handleLocationFound);

    const interval = setInterval(() => {
      map.locate();
    }, 5000);

    return () => {
      window.removeEventListener("deviceorientation", handleDeviceOrientation);
      clearInterval(interval);
    };
  }, [map]);

  return position === null ? null : (
    <Marker
      position={position}
      icon={direction ? locationIcon(direction) : icon}
    />
  );
}
