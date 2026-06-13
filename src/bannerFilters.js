import {
  getBannerListType,
  shouldKeepHiddenBannerVisible,
} from "./bannergressSync";

export const PRESET_MISSION_COUNT_FILTERS = Object.freeze([0, 6, 12, 18]);

export const DEFAULT_BANNER_FILTERS = Object.freeze({
  showOfflineBanners: false,
  showHiddenBanners: false,
  showTodoBannersOnly: false,
  hideDoneBanners: false,
  minimumMissions: 0,
  missionCountFilterMode: "preset",
  customMinimumMissions: "",
  customMaximumMissions: "",
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
