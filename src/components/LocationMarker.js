import { Popup, Marker, useMap } from "react-leaflet";
import React, { useState, useEffect } from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import icon, { locationIcon } from "../constants";

export default function LocationMarker() {
  const [position, setPosition] = useState(null);

  const map = useMap();

  const [time, setTime] = useState(Date.now());

  function angleFromCoordinate(lat1, lon1, lat2, lon2) {
    var p1 = {
      x: lat1,
      y: lon1,
    };

    var p2 = {
      x: lat2,
      y: lon2,
    };
    // angle in radians
    var angleRadians = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    // angle in degrees
    var angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
    console.log(angleDeg);
    return angleDeg;
  }

  useEffect(() => {
    let previousPosition = null;
    map.locate().on("locationfound", function (e) {
      if (
        previousPosition == null ||
        (previousPosition.lat !== e.lat && previousPosition.lng !== e.lng)
      ) {
        previousPosition = e.latlng;
        setPosition(e.latlng);
        map.flyTo(e.latlng, map.getZoom());
      }
    });
    const interval = setInterval(() => {
      setTime(Date.now());
      map.locate();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  return position === null ? null : (
    <Marker position={position} icon={locationIcon} />
  );
}
