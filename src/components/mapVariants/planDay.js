import { bannerPoint, distanceBetween, walkingMinutes } from "./mapMath";

// Nearest-neighbour visiting order from a start point (or from the first banner when
// there is no start point). Banners without coordinates go last, in input order.
export function orderNearestNeighbour(banners, start = null) {
  const located = banners.filter((banner) => bannerPoint(banner));
  const unlocated = banners.filter((banner) => !bannerPoint(banner));
  const remaining = [...located];
  const ordered = [];
  let current = start ?? (remaining.length ? bannerPoint(remaining[0]) : null);

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    remaining.forEach((banner, index) => {
      const distance = distanceBetween(current, bannerPoint(banner));

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = bannerPoint(next);
  }

  return [...ordered, ...unlocated];
}

// Legs between consecutive stops (start → 1 → 2 …) and the day's totals. Banner end
// points aren't in the list data, so a leg runs from one banner start to the next.
export function summarizePlan(orderedBanners, start = null) {
  const legs = [];
  let previous = start;

  for (const banner of orderedBanners) {
    const point = bannerPoint(banner);
    legs.push(previous && point ? distanceBetween(previous, point) : 0);
    previous = point ?? previous;
  }

  const walkingMeters = legs.reduce((total, leg) => total + leg, 0);
  const bannerMeters = orderedBanners.reduce(
    (total, banner) => total + (Number(banner?.lengthMeters) || 0),
    0
  );
  const totalMeters = walkingMeters + bannerMeters;

  return {
    legs,
    walkingMeters,
    bannerMeters,
    totalMeters,
    missions: orderedBanners.reduce((total, banner) => total + (Number(banner?.numberOfMissions) || 0), 0),
    minutes: walkingMinutes(totalMeters),
  };
}
