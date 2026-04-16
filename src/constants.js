import L from "leaflet";

function createUserLocationIcon(rotation = null) {
  const headingMarkup = Number.isFinite(rotation)
    ? `<div class="user-location-heading" style="transform: translateX(-50%) rotate(${rotation}deg);"></div>`
    : "";

  return L.divIcon({
    html: `<div class="user-location-marker">${headingMarkup}<div class="user-location-dot"></div></div>`,
    className: "user-location-icon",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

const userLocationIcon = createUserLocationIcon();

export default userLocationIcon;
export const locationIcon = (rotation = null) =>
  Number.isFinite(rotation) ? createUserLocationIcon(rotation) : userLocationIcon;
