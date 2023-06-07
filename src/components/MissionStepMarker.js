import React from "react";
import { Popup, Marker } from "react-leaflet";
import L from "leaflet";

export default function MissionStepMarker({
  latitude,
  longitude,
  missionNumber,
  isFirst,
}) {
  let icon;

  if (isFirst) {
    icon = L.divIcon({
      className: "custom-icon first-icon",
      html: `<div class="icon-content">${missionNumber}</div>`,
    });
  } else {
    icon = L.divIcon({
      className: "custom-icon black-icon",
    });
  }

  return (
    <div>
      <Marker position={[latitude, longitude]} icon={icon}>
        <Popup>
          {isFirst && (
            <div>
              <div>Mission Number: {missionNumber}</div>
              <div>Other Content</div>
            </div>
          )}
          {!isFirst && <div>Other Content</div>}
        </Popup>
      </Marker>
    </div>
  );
}
