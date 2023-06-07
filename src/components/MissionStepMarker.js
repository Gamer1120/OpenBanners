import React from "react";
import { Popup, Marker } from "react-leaflet";
import L from "leaflet";

export default function MissionStepMarker({
  latitude,
  longitude,
  missionNumber,
  color,
  isFirst,
}) {
  const iconContentClass = isFirst ? "first-icon" : "";
  const iconHtml = `<div class="icon-content ${iconContentClass}" style="height: ${
    isFirst ? "24px" : "12px"
  }; width: ${isFirst ? "24px" : "12px"}; border-radius: ${
    isFirst ? "50%" : "50%"
  }; background-color: ${isFirst ? color : "#000000"}">${
    isFirst ? missionNumber : ""
  }</div>`;

  const icon = L.divIcon({
    className: "custom-icon",
    html: iconHtml,
    iconAnchor: [12, 12], // Adjust the icon anchor to center the icon
  });

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
