import { Marker, useMap } from "react-leaflet";
import React, { useState, useEffect } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";

export default function LocationMarker() {
  const [position, setPosition] = useState(null);
  const [permissionAsked, setPermissionAsked] = useState(false); // Track if permission has been asked before

  const map = useMap();

  const [time, setTime] = useState(Date.now());
  const [direction, setDirection] = useState(null);

  function angleFromCoordinate(lat1, lon1, lat2, lon2) {
    var p1 = {
      x: lat1,
      y: lon1,
    };

    var p2 = {
      x: lat2,
      y: lon2,
    };
    return (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  }

  useEffect(() => {
    let previousPosition = null;

    // Check permission status before calling locate()
    if (!permissionAsked) {
      map.locate();
      setPermissionAsked(true);
    }

    map.on("locationfound", function (e) {
      if (
        previousPosition == null ||
        previousPosition.lat !== e.latlng.lat ||
        previousPosition.lng !== e.latlng.lng
      ) {
        setPosition(e.latlng);
        map.setView(e.latlng, map.getZoom());

        if (
          previousPosition !== null &&
          e.latlng !== null &&
          (previousPosition.lat !== e.latlng.lat ||
            previousPosition.lng !== e.latlng.lng)
        ) {
          setDirection(
            angleFromCoordinate(
              previousPosition.lat,
              previousPosition.lng,
              e.latlng.lat,
              e.latlng.lng
            )
          );
        }

        previousPosition = e.latlng;
      }
    });

    const interval = setInterval(() => {
      setTime(Date.now());

      // Check permission status before calling locate()
      if (map.locate && map.locate._active) {
        map.locate();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [map, permissionAsked]);

  return position === null ? null : (
    <Marker
      position={position}
      icon={direction ? locationIcon(direction) : icon}
    />
  );
}
