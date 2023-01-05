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

  useEffect(() => {
    let previousPosition = null;
    map.locate().on("locationfound", function (e) {
      console.log("triggering event hook");
      console.log("Previous position " + previousPosition);
      previousPosition = e.latlng;
      setPosition(e.latlng);
      map.flyTo(e.latlng, map.getZoom());
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
