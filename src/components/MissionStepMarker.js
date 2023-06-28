import React from "react";
import { Popup, Marker } from "react-leaflet";
import L from "leaflet";

export default function MissionStepMarker({
  portalName,
  latitude,
  longitude,
  missionNumber,
  color,
  isFirst,
}) {
  const iconContentClass = isFirst ? "first-icon" : "";
  const shadowStyle = isFirst
    ? "box-shadow: 0px 0px 8px rgba(0, 0, 0, 1);"
    : "box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.5);";
  const iconHtml = `<div class="icon-content ${iconContentClass}" style="height: ${
    isFirst ? "24px" : "12px"
  }; width: ${isFirst ? "24px" : "12px"}; border-radius: ${
    isFirst ? "50%" : "50%"
  }; background-color: ${color};${shadowStyle}">${
    isFirst ? missionNumber : ""
  }</div>`;

  const icon = L.divIcon({
    className: "custom-icon",
    html: iconHtml,
    iconAnchor: [12, 12],
  });

  const zIndexOffset = isFirst ? 1000 : 0;

  return (
    <div>
      <Marker
        position={[latitude, longitude]}
        icon={icon}
        zIndexOffset={zIndexOffset}
      >
        <Popup>
          <div>
            {isFirst && <div>Mission Number: {missionNumber}</div>}
            <div>{portalName}</div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Navigate to portal
            </a>
          </div>
        </Popup>
      </Marker>
    </div>
  );
}
