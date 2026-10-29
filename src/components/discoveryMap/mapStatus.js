import { getBannerListType, shouldKeepHiddenBannerVisible } from "../../bannergressSync";

// Bannergress list status as the discovery map shows it.
export const STATUS_STYLES = Object.freeze({
  todo: { label: "To do", ring: "#f2b63d", surface: "#4b3410", text: "#ffd67a" },
  done: { label: "Done", ring: "#35a853", surface: "#173f26", text: "#9aecae" },
  hidden: { label: "Hidden", ring: "#d85f5f", surface: "#431e1e", text: "#f5a8a8" },
  none: { label: "", ring: "#e9edf0", surface: "#1d2329", text: "#c9d1d7", dot: "#4d9fff" },
});

export function getBannerStatus(banner, syncState) {
  const listType = getBannerListType(syncState, banner?.id, banner?.listType);

  if (listType === "todo" || listType === "done") {
    return listType;
  }

  if (listType === "blacklist") {
    return shouldKeepHiddenBannerVisible(banner?.id) ? "none" : "hidden";
  }

  return "none";
}

export function getStatusStyle(status) {
  return STATUS_STYLES[status] ?? STATUS_STYLES.none;
}

// Adds _status (and _listType, the raw Bannergress list: a banner hidden from
// its card stays visible with _status "none" but _listType "blacklist") and
// drops Hidden banners (the map never shows them).
export function withStatus(banners, syncState) {
  return (Array.isArray(banners) ? banners : [])
    .map((banner) => ({
      ...banner,
      _status: getBannerStatus(banner, syncState),
      _listType: getBannerListType(syncState, banner?.id, banner?.listType) ?? null,
    }))
    .filter((banner) => banner._status !== "hidden");
}
