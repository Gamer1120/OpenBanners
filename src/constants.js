import L from "leaflet";

export default L.icon({
  iconSize: [25, 41],
  iconAnchor: [10, 41],
  popupAnchor: [2, -40],
  iconUrl: "https://unpkg.com/leaflet@1.6/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.6/dist/images/marker-shadow.png",
});

export const locationIcon = (rotation) => {
  const lineLength = 40; // Length of the direction indicator lines
  const lineGap = 60; // Angle between the two lines

  const line1Angle = rotation - lineGap / 2 - 180 - 90; // Subtract 90 degrees from the angle
  const line2Angle = rotation + lineGap / 2 - 180 - 90; // Subtract 90 degrees from the angle

  const line1X = lineLength * Math.sin((line1Angle * Math.PI) / 180);
  const line1Y = -lineLength * Math.cos((line1Angle * Math.PI) / 180);

  const line2X = lineLength * Math.sin((line2Angle * Math.PI) / 180);
  const line2Y = -lineLength * Math.cos((line2Angle * Math.PI) / 180);

  return L.divIcon({
    html: `<?xml version="1.0" encoding="utf-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" fill="#4285F4" width="60px" height="60px">
    <circle cx="30" cy="30" r="14" fill="#4285F4" stroke="#FFFFFF" stroke-width="3"/>
    <circle cx="30" cy="30" r="6" fill="#FFFFFF"/>
    <line x1="30" y1="30" x2="${30 + line1X}" y2="${
      30 + line1Y
    }" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
    <line x1="30" y1="30" x2="${30 + line2X}" y2="${
      30 + line2Y
    }" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
    className: "location-icon",
    iconAnchor: [30, 30], // Set the anchor point to the center of the icon
  });
};
