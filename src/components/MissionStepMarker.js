import React from "react";
import { Popup, Marker } from "react-leaflet";

export default function MissionStepMarker({
  latitude,
  longitude,
  missionNumber,
}) {
  return (
    <div>
      <Marker position={[latitude, longitude]}>
        <Popup>Mission #{missionNumber}</Popup>
      </Marker>
    </div>
  );
}
