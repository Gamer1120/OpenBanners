import {
  getBannerListType,
  shouldKeepHiddenBannerVisible,
} from "./bannergressSync";

export const DEFAULT_BANNER_FILTERS = Object.freeze({
  showOfflineBanners: false,
  showHiddenBanners: false,
  hideDoneBanners: false,
});

export function countActiveBannerFilters(filters) {
  return [
    filters?.showOfflineBanners,
    filters?.showHiddenBanners,
    filters?.hideDoneBanners,
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
