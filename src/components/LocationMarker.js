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
          console.log(previousPosition.lat);
          console.log(previousPosition.lng);
          console.log();
          console.log(e.latlng.lat);
          console.log(e.latlng.lng);
          // show user direction
          console.log(
            "direction is " +
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
      map.locate();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [map]);

  return position === null ? null : (
    <Marker position={position} icon={locationIcon} />
  );
}
