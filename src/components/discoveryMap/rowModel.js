import { bannerPoint } from "./mapMath";

// The "banners in view" row (phone carousel / desktop side list).
// With more than ROW_LIMIT banners in view the row shows the nearest ROW_CAP
// and ends with a "+N more · show list" card.
export const ROW_LIMIT = 40;
export const ROW_CAP = 30;

export function areaCenter(area) {
  if (!area) {
    return null;
  }

  return {
    latitude: (area.minLatitude + area.maxLatitude) / 2,
    longitude: (area.minLongitude + area.maxLongitude) / 2,
  };
}

// Nearest start point first (flat-earth distance is plenty within one view).
// Ties keep their incoming order, so the row doesn't shuffle needlessly.
export function sortByDistance(banners, center) {
  if (!center) {
    return banners.slice();
  }

  const scale = Math.cos((center.latitude * Math.PI) / 180);
  const distance = (banner) => {
    const point = bannerPoint(banner);

    if (!point) {
      return Infinity;
    }

    const dx = (point.longitude - center.longitude) * scale;
    const dy = point.latitude - center.latitude;
    return dx * dx + dy * dy;
  };

  return banners
    .map((banner, index) => ({ banner, index, distance: distance(banner) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((entry) => entry.banner);
}

// Cards for the row: everything up to ROW_LIMIT, otherwise the nearest ROW_CAP
// (plus the focused banner when it is further away, so it always has a card).
export function buildRow(sorted, focusId, { limit = ROW_LIMIT, cap = ROW_CAP } = {}) {
  if (sorted.length <= limit) {
    return { items: sorted, moreCount: 0 };
  }

  const items = sorted.slice(0, cap);

  if (focusId && !items.some((banner) => banner.id === focusId)) {
    const focused = sorted.find((banner) => banner.id === focusId);

    if (focused) {
      items.push(focused);
    }
  }

  return { items, moreCount: sorted.length - items.length };
}

// After the list changes: keep the focus while that banner is still listed,
// otherwise move it to the first (nearest) one.
export function keepFocus(focusId, list) {
  if (focusId && list.some((banner) => banner.id === focusId)) {
    return focusId;
  }

  return list[0]?.id ?? null;
}
