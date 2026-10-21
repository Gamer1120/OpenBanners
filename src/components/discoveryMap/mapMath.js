// Walking pace including stops at portals.
export const WALKING_SPEED_KMH = 4.5;

export function walkingMinutes(meters) {
  const value = Number(meters);
  return Number.isFinite(value) && value >= 0 ? (value / 1000 / WALKING_SPEED_KMH) * 60 : null;
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) {
    return "?";
  }

  const rounded = Math.max(1, Math.round(minutes / 5) * 5 || Math.round(minutes));

  if (rounded < 60) {
    return `${rounded} min`;
  }

  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
}

export function bannerPoint(banner) {
  const latitude = Number(banner?._latitude ?? banner?.startLatitude);
  const longitude = Number(banner?._longitude ?? banner?.startLongitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export function isInsideArea(banner, area) {
  const point = bannerPoint(banner);

  return Boolean(
    point &&
      area &&
      point.latitude >= area.minLatitude &&
      point.latitude <= area.maxLatitude &&
      point.longitude >= area.minLongitude &&
      point.longitude <= area.maxLongitude
  );
}
