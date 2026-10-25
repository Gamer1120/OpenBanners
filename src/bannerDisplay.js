import { getLanguage, t } from "./i18n";

export const BANNERGRESS_ORIGIN = "https://api.bannergress.com";

export function getBannerPictureUrl(banner) {
  return typeof banner?.picture === "string" && banner.picture
    ? `${BANNERGRESS_ORIGIN}${banner.picture}`
    : "";
}

export function formatLength(lengthMeters) {
  const meters = Number(lengthMeters);

  if (!Number.isFinite(meters)) {
    return "?";
  }

  // No digit grouping: "1234 km" as before, with the user's decimal separator.
  const number = (value) => value.toLocaleString(getLanguage(), { useGrouping: false, maximumFractionDigits: 1 });

  if (meters < 1000) {
    return t("{distance} m", { distance: number(Math.round(meters)) });
  }

  const kilometers = meters / 1000;
  return t("{distance} km", {
    distance: number(kilometers < 10 ? Math.round(kilometers * 10) / 10 : Math.round(kilometers)),
  });
}

export function getMissionsPerKm(banner) {
  const missions = Number(banner?.numberOfMissions);
  const meters = Number(banner?.lengthMeters);

  return Number.isFinite(missions) && Number.isFinite(meters) && meters > 0
    ? missions / (meters / 1000)
    : null;
}

export function getBannerRows(banner) {
  const width = Number(banner?.width) || 6;
  const missions = Number(banner?.numberOfMissions) || width;

  return Math.max(1, Math.ceil(missions / width));
}

// Real aspect of a Bannergress picture: columns × rows of 100px tiles + 4px border.
export function getBannerAspect(banner) {
  const width = Number(banner?.width) || 6;

  return (width * 100 + 4) / (getBannerRows(banner) * 100 + 4);
}

export function getDisabledMissionCount(banner) {
  const disabled = Number(banner?.numberOfDisabledMissions);
  return Number.isFinite(disabled) && disabled > 0 ? disabled : 0;
}

export function getDistanceMeters(from, to) {
  if (
    !from ||
    !to ||
    ![from.latitude, from.longitude, to.latitude, to.longitude].every(
      Number.isFinite
    )
  ) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function buildIngressMissionUrl(missionId) {
  const intelUrl = encodeURIComponent(
    `https://intel.ingress.com/mission/${missionId}`
  );

  return `https://link.ingress.com/?link=${intelUrl}&apn=com.nianticproject.ingress&isi=576505181&ibi=com.google.ingress&ifl=${encodeURIComponent(
    "https://apps.apple.com/app/ingress/id576505181"
  )}&ofl=${intelUrl}`;
}

export function buildIntelMissionUrl(missionId) {
  return `https://intel.ingress.com/mission/${encodeURIComponent(missionId)}`;
}

// Portals open in the phone's maps app (geo: URI), never on Intel.
export function buildGeoUrl(latitude, longitude, name) {
  return `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(
    name || "Portal"
  )})`;
}
