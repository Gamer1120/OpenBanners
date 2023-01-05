import L from "leaflet";

export default L.icon({
  iconSize: [25, 41],
  iconAnchor: [10, 41],
  popupAnchor: [2, -40],
  iconUrl: "https://unpkg.com/leaflet@1.6/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.6/dist/images/marker-shadow.png",
});

export const locationIcon = (rotation) => {
  return L.divIcon({
    html: `<?xml version="1.0" encoding="utf-8"?>
  <svg viewBox="-24 -24 48 48" transform="rotate(${rotation} 0 0)" width=24px xmlns="http://www.w3.org/2000/svg" xmlns:bx="https://boxy-svg.com">
    <circle r="18" style="stroke:#fff;stroke-width:3;fill:#00d900;fill-opacity:1;opacity:1;"/>
    <path d="M -1.2 -22.8 Q 0 -24 1.2 -22.8 L 8.8 -15.2 Q 10 -14 7.6 -14 L -7.6 -14 Q -10 -14 -8.8 -15.2 Z" style="paint-order: markers; stroke-opacity: 0.61; stroke-linejoin: round; fill: rgb(0, 172, 0);" bx:shape="triangle -10 -24 20 10 0.5 0.12 1@5bf11522" bx:origin="0.5 2.317945"/>
  </svg>`,
    className: "location-icon",
  });
};
