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

  const calculateAngle = (lat1, lon1, lat2, lon2) => {
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    let bearing = (Math.atan2(x, y) * 180) / Math.PI;
    bearing = (bearing + 360) % 360;
    bearing = (bearing + 180) % 360; // Adjust the calculation to account for the clockwise rotation
    return bearing;
  };

  useEffect(() => {
    let previousPosition = null;

    map.locate().on("locationfound", function (e) {
      if (
        previousPosition == null ||
        previousPosition.lat !== e.latlng.lat ||
        previousPosition.lng !== e.latlng.lng
      ) {
        setPosition(e.latlng);
        map.flyTo(e.latlng, map.getZoom());

        if (
          previousPosition !== null &&
          e.latlng !== null &&
          (previousPosition.lat !== e.latlng.lat ||
            previousPosition.lng !== e.latlng.lng)
        ) {
          const bearing = calculateAngle(
            previousPosition.lat,
            previousPosition.lng,
            e.latlng.lat,
            e.latlng.lng
          );
          setDirection(bearing);
        }

        previousPosition = e.latlng;
      }
    });

    const interval = setInterval(() => {
      map.locate();
    }, 5000);

    return () => {
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
