import {
  getBannerListType,
  shouldKeepHiddenBannerVisible,
} from "./bannergressSync";

export const PRESET_MISSION_COUNT_FILTERS = Object.freeze([0, 6, 12, 18]);
// Distance (banner length) presets, as on the map: "< 5 km" … "< 20 km".
export const PRESET_MAXIMUM_KILOMETER_FILTERS = Object.freeze([5, 10, 15, 20]);

export const DEFAULT_BANNER_FILTERS = Object.freeze({
  showOfflineBanners: false,
  showHiddenBanners: false,
  showTodoBannersOnly: false,
  hideDoneBanners: false,
  minimumMissions: 0,
  missionCountFilterMode: "preset",
  customMinimumMissions: "",
  customMaximumMissions: "",
  // "preset": Any (both empty) or "< N km" (maximumKilometers = N);
  // "custom": the min–max fields.
  kilometerFilterMode: "preset",
  minimumKilometers: "",
  maximumKilometers: "",
});

export const DEFAULT_MAP_BANNER_FILTERS = Object.freeze({
  ...DEFAULT_BANNER_FILTERS,
  hideDoneBanners: true,
});

export function parseMissionCountInput(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return Math.max(0, Math.floor(parsedValue));
}

export function parseKilometerInput(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsedValue = Number(String(value).replace(",", "."));

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return Math.max(0, parsedValue);
}

export function getMissionCountBounds(filters) {
  if (filters?.missionCountFilterMode === "custom") {
    const minimumMissions = parseMissionCountInput(
      filters?.customMinimumMissions
    );
    const maximumMissions = parseMissionCountInput(
      filters?.customMaximumMissions
    );

    return {
      minimumMissions,
      maximumMissions,
      hasMissionCountFilter:
        minimumMissions !== null || maximumMissions !== null,
    };
  }

  const minimumMissions = parseMissionCountInput(filters?.minimumMissions) ?? 0;

  return {
    minimumMissions,
    maximumMissions: null,
    hasMissionCountFilter: minimumMissions > 0,
  };
}

export function getKilometerBounds(filters) {
  const minimumKilometers = parseKilometerInput(filters?.minimumKilometers);
  const maximumKilometers = parseKilometerInput(filters?.maximumKilometers);

  return {
    minimumKilometers,
    maximumKilometers,
    hasKilometerFilter:
      (minimumKilometers !== null && minimumKilometers > 0) ||
      maximumKilometers !== null,
  };
}

// Banner length (lengthMeters) within the Distance filter: minimum inclusive,
// maximum exclusive ("< 5 km"), like the map. Unknown lengths only pass
// without a filter.
export function bannerMatchesKilometerFilter(banner, filters) {
  const { minimumKilometers, maximumKilometers, hasKilometerFilter } =
    getKilometerBounds(filters);

  if (!hasKilometerFilter) {
    return true;
  }

  const meters = Number(banner?.lengthMeters);

  if (banner?.lengthMeters === null || banner?.lengthMeters === undefined || !Number.isFinite(meters)) {
    return false;
  }

  if (minimumKilometers !== null && meters < minimumKilometers * 1000) {
    return false;
  }

  if (maximumKilometers !== null && meters >= maximumKilometers * 1000) {
    return false;
  }

  return true;
}

// A list sorted by length has no more matches after its last banner once it
// passed the Distance filter's bound (Shortest first beyond the maximum,
// Longest first below the minimum), so paging can stop there.
export function isPastKilometerFilter(lastBanner, filters, sortOrder) {
  const { minimumKilometers, maximumKilometers, hasKilometerFilter } =
    getKilometerBounds(filters);
  const meters = Number(lastBanner?.lengthMeters);

  if (!hasKilometerFilter || lastBanner?.lengthMeters == null || !Number.isFinite(meters)) {
    return false;
  }

  if (sortOrder === "ASC") {
    return maximumKilometers !== null && meters >= maximumKilometers * 1000;
  }

  return minimumKilometers !== null && minimumKilometers > 0 && meters < minimumKilometers * 1000;
}

export function countActiveBannerFilters(
  filters,
  { doneBannersFilterMode = "hide" } = {}
) {
  const doneBannersFilterActive =
    doneBannersFilterMode === "show"
      ? filters?.hideDoneBanners === false
      : filters?.hideDoneBanners;

  return [
    filters?.showOfflineBanners,
    filters?.showHiddenBanners,
    filters?.showTodoBannersOnly,
    doneBannersFilterActive,
    getMissionCountBounds(filters).hasMissionCountFilter,
    getKilometerBounds(filters).hasKilometerFilter,
  ].filter(Boolean).length;
}

export function applyBannerFilters(banners, syncState, filters) {
  if (!Array.isArray(banners)) {
    return [];
  }

  return banners.filter((banner) => {
    const effectiveListType = getBannerListType(
      syncState,
      banner?.id,
      banner?.listType
    );
    const isOffline = Number(banner?.numberOfDisabledMissions) > 0;

    if (!filters?.showOfflineBanners && isOffline) {
      return false;
    }

    if (
      !filters?.showHiddenBanners &&
      effectiveListType === "blacklist" &&
      !shouldKeepHiddenBannerVisible(banner?.id)
    ) {
      return false;
    }

    if (filters?.hideDoneBanners && effectiveListType === "done") {
      return false;
    }

    if (filters?.showTodoBannersOnly && effectiveListType !== "todo") {
      return false;
    }

    return true;
  });
}

// Banners on the user's Hidden list, except one that was hidden a moment ago on
// the current page (kept so the user can undo it).
export function isBannerHidden(banner, syncState) {
  return (
    getBannerListType(syncState, banner?.id, banner?.listType) === "blacklist" &&
    !shouldKeepHiddenBannerVisible(banner?.id)
  );
}

export function withoutHiddenBanners(banners, syncState) {
  return Array.isArray(banners)
    ? banners.filter((banner) => !isBannerHidden(banner, syncState))
    : [];
}
