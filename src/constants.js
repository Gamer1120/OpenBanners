import L from "leaflet";

function createUserLocationIcon(rotation = null) {
  const lineLength = 19;
  const lineGap = 56;
  const line1Angle = Number.isFinite(rotation) ? rotation - lineGap / 2 : null;
  const line2Angle = Number.isFinite(rotation) ? rotation + lineGap / 2 : null;
  const line1X = Number.isFinite(line1Angle)
    ? lineLength * Math.sin((line1Angle * Math.PI) / 180)
    : null;
  const line1Y = Number.isFinite(line1Angle)
    ? -lineLength * Math.cos((line1Angle * Math.PI) / 180)
    : null;
  const line2X = Number.isFinite(line2Angle)
    ? lineLength * Math.sin((line2Angle * Math.PI) / 180)
    : null;
  const line2Y = Number.isFinite(line2Angle)
    ? -lineLength * Math.cos((line2Angle * Math.PI) / 180)
    : null;
  const headingMarkup =
    Number.isFinite(line1X) &&
    Number.isFinite(line1Y) &&
    Number.isFinite(line2X) &&
    Number.isFinite(line2Y)
      ? `
        <line
          x1="30"
          y1="30"
          x2="${30 + line1X}"
          y2="${30 + line1Y}"
          stroke="rgba(255,255,255,0.96)"
          stroke-width="4"
          stroke-linecap="round"
        />
        <line
          x1="30"
          y1="30"
          x2="${30 + line2X}"
          y2="${30 + line2Y}"
          stroke="rgba(255,255,255,0.96)"
          stroke-width="4"
          stroke-linecap="round"
        />
      `
      : "";

  return L.divIcon({
    html: `<?xml version="1.0" encoding="utf-8"?>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 60 60"
        width="60"
        height="60"
        aria-hidden="true"
      >
        <circle
          cx="30"
          cy="30"
          r="13"
          fill="rgba(66, 133, 244, 0.48)"
          stroke="rgba(255,255,255,0.92)"
          stroke-width="2.5"
        />
        <circle
          cx="30"
          cy="30"
          r="5"
          fill="rgba(255,255,255,0.95)"
        />
        ${headingMarkup}
      </svg>`,
    className: "user-location-icon",
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  });
}

const userLocationIcon = createUserLocationIcon();

export default userLocationIcon;
export const locationIcon = (rotation = null) =>
  Number.isFinite(rotation) ? createUserLocationIcon(rotation) : userLocationIcon;
