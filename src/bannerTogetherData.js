import {
  clearBannergressAuthData,
  fetchBannergress,
  loadBannergressAuthData,
  requestBannergressAccessToken,
} from "./bannergressSync";

export const BANNER_TOGETHER_PAGE_SIZE = 100;
export const BANNER_TOGETHER_MAX_BANNERS = 10000;
export const BANNER_TOGETHER_MAX_PAGES =
  BANNER_TOGETHER_MAX_BANNERS / BANNER_TOGETHER_PAGE_SIZE + 1;

const PRIVATE_LIST_TYPES = ["todo", "done", "blacklist"];
const CATALOG_ATTRIBUTES = [
  "id",
  "title",
  "picture",
  "numberOfMissions",
  "lengthMeters",
  "numberOfDisabledMissions",
  "formattedAddress",
];

function createAbortError() {
  return Object.assign(new Error("Banner Together request was cancelled."), {
    name: "AbortError",
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAuthRequiredError() {
  return Object.assign(
    new Error("Authenticate with Bannergress to compare banner lists."),
    { code: "AUTH_REQUIRED" }
  );
}

function addRepeatedParameters(url, name, values) {
  values.forEach((value) => url.searchParams.append(name, value));
}

function sortCatalog(banners) {
  return [...banners].sort((bannerA, bannerB) => {
    const titleComparison = String(bannerA?.title ?? "").localeCompare(
      String(bannerB?.title ?? "")
    );

    return titleComparison || String(bannerA?.id ?? "").localeCompare(bannerB?.id ?? "");
  });
}

export function createBannerTogetherCatalogUrl(placeId, offset = 0) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("placeId", placeId);
  url.searchParams.set("orderBy", "title");
  url.searchParams.set("orderDirection", "ASC");
  url.searchParams.set("limit", String(BANNER_TOGETHER_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  addRepeatedParameters(url, "attributes", CATALOG_ATTRIBUTES);
  return url;
}

export function createBannerTogetherMembershipUrl(placeId, offset = 0) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("placeId", placeId);
  addRepeatedParameters(url, "listTypes", PRIVATE_LIST_TYPES);
  url.searchParams.set("orderBy", "listAdded");
  url.searchParams.set("orderDirection", "DESC");
  url.searchParams.set("limit", String(BANNER_TOGETHER_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  addRepeatedParameters(url, "attributes", ["id", "listType"]);
  return url;
}

export async function fetchBannerTogetherCatalog(
  placeId,
  { onPage = () => {}, signal = null } = {}
) {
  const bannersById = new Map();
  let offset = 0;

  for (
    let pageIndex = 0;
    pageIndex < BANNER_TOGETHER_MAX_PAGES;
    pageIndex += 1
  ) {
    throwIfAborted(signal);
    const response = await fetch(
      createBannerTogetherCatalogUrl(placeId, offset).toString(),
      { signal }
    );

    if (!response.ok) {
      throw new Error("Bannergress could not load the place banner catalog.");
    }

    const page = await response.json();

    if (!Array.isArray(page)) {
      throw new Error("Bannergress returned an unexpected banner catalog.");
    }

    if (offset >= BANNER_TOGETHER_MAX_BANNERS && page.length > 0) {
      throw new Error("The place banner catalog exceeded the safe page limit.");
    }

    page.forEach((banner) => {
      if (typeof banner?.id === "string" && banner.id) {
        const { listType: _listType, ...publicBanner } = banner;
        bannersById.set(banner.id, publicBanner);
      }
    });

    const sortedCatalog = sortCatalog([...bannersById.values()]);
    onPage(sortedCatalog);

    if (page.length < BANNER_TOGETHER_PAGE_SIZE) {
      return sortedCatalog;
    }

    offset += page.length;
  }

  throw new Error("The place banner catalog exceeded the safe page limit.");
}

export async function fetchBannerTogetherMembership(
  placeId,
  { onProgress = () => {}, signal = null } = {}
) {
  const accessToken = await requestBannergressAccessToken();

  if (!accessToken) {
    throw createAuthRequiredError();
  }

  throwIfAborted(signal);
  const requestAuthData = loadBannergressAuthData();
  const listTypeByBannerId = new Map();
  let offset = 0;

  for (
    let pageIndex = 0;
    pageIndex < BANNER_TOGETHER_MAX_PAGES;
    pageIndex += 1
  ) {
    throwIfAborted(signal);
    const response = await fetchBannergress(
      createBannerTogetherMembershipUrl(placeId, offset).toString(),
      {
        authenticate: false,
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      }
    );

    if (response.status === 401 || response.status === 403) {
      const latestAuthData = loadBannergressAuthData();

      if (
        latestAuthData.accessToken === accessToken &&
        latestAuthData.refreshToken === requestAuthData.refreshToken
      ) {
        clearBannergressAuthData();
      }

      throw createAuthRequiredError();
    }

    if (!response.ok) {
      throw new Error("Bannergress could not load the private banner lists.");
    }

    const page = await response.json();

    if (!Array.isArray(page)) {
      throw new Error("Bannergress returned unexpected private list data.");
    }

    if (offset >= BANNER_TOGETHER_MAX_BANNERS && page.length > 0) {
      throw new Error("The private banner lists exceeded the safe page limit.");
    }

    page.forEach((banner) => {
      if (
        typeof banner?.id !== "string" ||
        !banner.id ||
        !PRIVATE_LIST_TYPES.includes(banner.listType)
      ) {
        return;
      }

      const previousListType = listTypeByBannerId.get(banner.id);

      if (previousListType && previousListType !== banner.listType) {
        throw new Error(
          "Bannergress returned overlapping private list memberships. Refresh and try again."
        );
      }

      listTypeByBannerId.set(banner.id, banner.listType);
    });

    onProgress(listTypeByBannerId.size);

    if (page.length < BANNER_TOGETHER_PAGE_SIZE) {
      const lists = { todo: [], done: [], blacklist: [] };

      listTypeByBannerId.forEach((listType, bannerId) => {
        lists[listType].push(bannerId);
      });
      Object.values(lists).forEach((bannerIds) => bannerIds.sort());

      return {
        capturedAt: new Date().toISOString(),
        lists,
      };
    }

    offset += page.length;
  }

  throw new Error("The private banner lists exceeded the safe page limit.");
}
