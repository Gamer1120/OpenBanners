import { bannerPoint } from "./mapMath";

// The "banners in view" row (phone carousel / desktop side list) lists every
// banner in view, but renders its cards in steps (infinite scroll): ROW_PAGE
// at first, ROW_PAGE more whenever the end of the list scrolls near
// (useIncrementalRow). The banners themselves are already loaded for the map.
export const ROW_PAGE = 30;
// A selected banner up to this many cards past the rendered ones extends the
// list down to it; one further away gets its own card at the end, so a dot
// tapped at the edge of a crowded view doesn't render hundreds of cards.
export const FOCUS_REACH = 120;

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

// How many of the sorted cards to render so the focused one is among them
// (when it is within FOCUS_REACH of the rendered ones).
export function rowCountFor(sorted, focusId, count) {
  const shown = Math.min(sorted.length, count);

  if (!focusId) {
    return shown;
  }

  const index = sorted.findIndex((banner) => banner.id === focusId);
  return index >= shown && index < shown + FOCUS_REACH ? index + 1 : shown;
}

// Cards to render: the first `count` (see rowCountFor), plus the focused banner
// at the end when it is further down than that. hasMore: cards left to render.
export function buildRow(sorted, focusId, count) {
  const shown = rowCountFor(sorted, focusId, count);
  const items = sorted.slice(0, shown);

  if (focusId && !items.some((banner) => banner.id === focusId)) {
    const focused = sorted.find((banner) => banner.id === focusId);

    if (focused) {
      items.push(focused);
    }
  }

  return { items, shown, hasMore: shown < sorted.length };
}
