import {
  getBannerListType,
  shouldKeepHiddenBannerVisible,
} from "./bannergressSync";

export const PRESET_MISSION_COUNT_FILTERS = Object.freeze([0, 6, 12, 18]);

export const DEFAULT_BANNER_FILTERS = Object.freeze({
  showOfflineBanners: false,
  showHiddenBanners: false,
  hideDoneBanners: false,
  minimumMissions: 0,
  missionCountFilterMode: "preset",
  customMinimumMissions: "",
  customMaximumMissions: "",
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

export function countActiveBannerFilters(filters) {
  return [
    filters?.showOfflineBanners,
    filters?.showHiddenBanners,
    filters?.hideDoneBanners,
    getMissionCountBounds(filters).hasMissionCountFilter,
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

    return true;
  });
}
