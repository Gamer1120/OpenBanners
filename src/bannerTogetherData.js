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
export const BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX =
  "openbanners-banner-together-membership-v1:";

const PRIVATE_LIST_TYPES = ["todo", "done", "blacklist"];
const MEMBERSHIP_CACHE_VERSION = 1;
const MEMBERSHIP_LIST_KEYS = ["todo", "done", "blacklist"];
const MAX_BANNER_ID_LENGTH = 256;
const MAX_PLACE_ID_LENGTH = 256;
const CACHE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }

  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function normalizeCacheIdentifier(value, label, maximumLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }

  return value;
}

function normalizeMembershipSnapshot(snapshot, { now = Date.now() } = {}) {
  if (!hasExactKeys(snapshot, ["capturedAt", "lists"])) {
    throw new Error("The cached Banner Together membership is invalid.");
  }

  if (!hasExactKeys(snapshot.lists, MEMBERSHIP_LIST_KEYS)) {
    throw new Error("The cached Banner Together lists are invalid.");
  }

  const capturedAt = new Date(snapshot.capturedAt);

  if (
    typeof snapshot.capturedAt !== "string" ||
    Number.isNaN(capturedAt.getTime()) ||
    capturedAt.toISOString() !== snapshot.capturedAt ||
    capturedAt.getTime() - now > CACHE_FUTURE_TOLERANCE_MS ||
    now - capturedAt.getTime() >= BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS
  ) {
    throw new Error("The cached Banner Together membership has expired.");
  }

  const seenBannerIds = new Set();
  let totalBannerIds = 0;
  const lists = Object.fromEntries(
    MEMBERSHIP_LIST_KEYS.map((listType) => {
      const sourceIds = snapshot.lists[listType];

      if (!Array.isArray(sourceIds)) {
        throw new Error("The cached Banner Together lists are invalid.");
      }

      const bannerIds = sourceIds.map((bannerId) =>
        normalizeCacheIdentifier(
          bannerId,
          "Cached Banner Together banner ID",
          MAX_BANNER_ID_LENGTH
        )
      );

      bannerIds.forEach((bannerId) => {
        if (seenBannerIds.has(bannerId)) {
          throw new Error(
            "A cached Banner Together banner appears in more than one list."
          );
        }

        seenBannerIds.add(bannerId);
      });
      totalBannerIds += bannerIds.length;

      if (totalBannerIds > BANNER_TOGETHER_MAX_BANNERS) {
        throw new Error("The cached Banner Together membership is too large.");
      }

      const sortedBannerIds = [...bannerIds].sort();

      if (
        bannerIds.some(
          (bannerId, index) => bannerId !== sortedBannerIds[index]
        )
      ) {
        throw new Error("Cached Banner Together lists must be sorted.");
      }

      return [listType, sortedBannerIds];
    })
  );

  return { capturedAt: snapshot.capturedAt, lists };
}

function decodeJwtIdentity(token) {
  if (typeof token !== "string") {
    return null;
  }

  try {
    const [, encodedPayload] = token.split(".");

    if (!encodedPayload) {
      return null;
    }

    const normalizedPayload = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const paddedPayload = `${normalizedPayload}${"=".repeat(
      (4 - (normalizedPayload.length % 4)) % 4
    )}`;
    const payloadBytes = Uint8Array.from(
      globalThis.atob(paddedPayload),
      (character) => character.charCodeAt(0)
    );
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));

    return typeof payload.sub === "string" && payload.sub
      ? `${typeof payload.iss === "string" ? payload.iss : ""}:${payload.sub}`
      : null;
  } catch {
    return null;
  }
}

function getMembershipCacheIdentity(authData) {
  const jwtIdentity =
    decodeJwtIdentity(authData?.idToken) ||
    decodeJwtIdentity(authData?.accessToken);

  if (jwtIdentity) {
    return `oidc:${jwtIdentity}`;
  }

  const fallbackToken =
    authData?.refreshToken || authData?.idToken || authData?.accessToken;
  return typeof fallbackToken === "string" && fallbackToken
    ? `token:${fallbackToken}`
    : null;
}

async function hashMembershipCacheIdentity(identity) {
  if (!globalThis.crypto?.subtle) {
    return null;
  }

  let digest;

  try {
    digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identity)
    );
  } catch {
    return null;
  }

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function getMembershipCacheContext(placeId, authData) {
  const normalizedPlaceId = normalizeCacheIdentifier(
    placeId,
    "Banner Together place ID",
    MAX_PLACE_ID_LENGTH
  );
  const identity = getMembershipCacheIdentity(authData);

  if (!identity) {
    return null;
  }

  const accountFingerprint = await hashMembershipCacheIdentity(identity);

  if (!accountFingerprint) {
    return null;
  }

  return {
    accountFingerprint,
    normalizedPlaceId,
    storageKey: `${BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX}${accountFingerprint}:${encodeURIComponent(
      normalizedPlaceId
    )}`,
  };
}

export async function loadBannerTogetherMembershipCache(
  placeId,
  { authData = loadBannergressAuthData(), now = Date.now() } = {}
) {
  const context = await getMembershipCacheContext(placeId, authData);

  if (!context || typeof window === "undefined") {
    return null;
  }

  let storedValue;

  try {
    storedValue = window.localStorage.getItem(context.storageKey);
  } catch {
    return null;
  }

  if (!storedValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(storedValue);

    if (
      !hasExactKeys(parsedValue, [
        "version",
        "accountFingerprint",
        "placeId",
        "capturedAt",
        "lists",
      ]) ||
      parsedValue.version !== MEMBERSHIP_CACHE_VERSION ||
      parsedValue.accountFingerprint !== context.accountFingerprint ||
      parsedValue.placeId !== context.normalizedPlaceId
    ) {
      throw new Error("The cached Banner Together membership is invalid.");
    }

    return normalizeMembershipSnapshot(
      { capturedAt: parsedValue.capturedAt, lists: parsedValue.lists },
      { now }
    );
  } catch {
    try {
      window.localStorage.removeItem(context.storageKey);
    } catch {
      // An unavailable cache must not prevent a fresh Bannergress request.
    }
    return null;
  }
}

export async function saveBannerTogetherMembershipCache(
  placeId,
  snapshot,
  { authData = loadBannergressAuthData(), now = Date.now() } = {}
) {
  const context = await getMembershipCacheContext(placeId, authData);

  if (!context || typeof window === "undefined") {
    return null;
  }

  const normalizedSnapshot = normalizeMembershipSnapshot(snapshot, { now });
  const storedValue = {
    version: MEMBERSHIP_CACHE_VERSION,
    accountFingerprint: context.accountFingerprint,
    placeId: context.normalizedPlaceId,
    ...normalizedSnapshot,
  };

  try {
    window.localStorage.setItem(
      context.storageKey,
      JSON.stringify(storedValue)
    );
  } catch {
    return null;
  }

  return normalizedSnapshot;
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
