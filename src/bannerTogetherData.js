import {
  clearBannergressAuthData,
  fetchBannergress,
  loadBannergressAuthData,
  requestBannergressAccessToken,
} from "./bannergressSync";

export const BANNER_TOGETHER_PAGE_SIZE = 100;
export const BANNER_TOGETHER_PAGE_CONCURRENCY = 4;
export const BANNER_TOGETHER_MAX_BANNERS = 10000;
export const BANNER_TOGETHER_MAX_PAGES =
  BANNER_TOGETHER_MAX_BANNERS / BANNER_TOGETHER_PAGE_SIZE + 1;
export const BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX =
  "openbanners-banner-together-membership-v2:";
export const BANNER_TOGETHER_CATALOG_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const BANNER_TOGETHER_CATALOG_CACHE_STORAGE_PREFIX =
  "openbanners-banner-together-catalog-v1:";

const PRIVATE_LIST_TYPES = ["todo", "done", "blacklist"];
const MEMBERSHIP_CACHE_VERSION = 2;
const CATALOG_CACHE_VERSION = 1;
const RETIRED_MEMBERSHIP_CACHE_STORAGE_PREFIX =
  "openbanners-banner-together-membership-v1:";
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

function normalizeCatalogCapturedAt(capturedAt, now) {
  const capturedDate = new Date(capturedAt);

  if (
    typeof capturedAt !== "string" ||
    Number.isNaN(capturedDate.getTime()) ||
    capturedDate.toISOString() !== capturedAt ||
    capturedDate.getTime() - now > CACHE_FUTURE_TOLERANCE_MS ||
    now - capturedDate.getTime() >= BANNER_TOGETHER_CATALOG_CACHE_TTL_MS
  ) {
    throw new Error("The cached Banner Together catalog has expired.");
  }

  return capturedAt;
}

function normalizeCatalogBanner(banner) {
  if (!isPlainObject(banner)) {
    throw new Error("The cached Banner Together catalog is invalid.");
  }

  const normalizedBanner = {
    id: normalizeCacheIdentifier(
      banner.id,
      "Cached Banner Together banner ID",
      MAX_BANNER_ID_LENGTH
    ),
  };

  ["title", "picture", "formattedAddress"].forEach((key) => {
    if (Object.hasOwn(banner, key) && banner[key] !== null) {
      if (typeof banner[key] !== "string" || banner[key].length > 8192) {
        throw new Error("The cached Banner Together catalog is invalid.");
      }

      normalizedBanner[key] = banner[key];
    }
  });

  [
    "numberOfMissions",
    "lengthMeters",
    "numberOfDisabledMissions",
  ].forEach((key) => {
    if (Object.hasOwn(banner, key) && banner[key] !== null) {
      if (!Number.isSafeInteger(banner[key]) || banner[key] < 0) {
        throw new Error("The cached Banner Together catalog is invalid.");
      }

      normalizedBanner[key] = banner[key];
    }
  });

  return normalizedBanner;
}

function normalizeCatalogSnapshot(snapshot, { now = Date.now() } = {}) {
  if (!hasExactKeys(snapshot, ["capturedAt", "banners"])) {
    throw new Error("The cached Banner Together catalog is invalid.");
  }

  if (
    !Array.isArray(snapshot.banners) ||
    snapshot.banners.length > BANNER_TOGETHER_MAX_BANNERS
  ) {
    throw new Error("The cached Banner Together catalog is invalid.");
  }

  const bannersById = new Map();
  snapshot.banners.forEach((banner) => {
    const normalizedBanner = normalizeCatalogBanner(banner);
    bannersById.set(normalizedBanner.id, {
      ...(bannersById.get(normalizedBanner.id) ?? {}),
      ...normalizedBanner,
    });
  });

  return {
    capturedAt: normalizeCatalogCapturedAt(snapshot.capturedAt, now),
    banners: sortCatalog([...bannersById.values()]),
  };
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
    if (
      !storeWithCatalogEviction(
        window.localStorage,
        context.storageKey,
        JSON.stringify(storedValue),
        now,
        {
          protectedCatalogKeys: [getCatalogCacheContext(placeId).storageKey],
        }
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return normalizedSnapshot;
}

function getCatalogCacheContext(placeId) {
  const normalizedPlaceId = normalizeCacheIdentifier(
    placeId,
    "Banner Together place ID",
    MAX_PLACE_ID_LENGTH
  );

  return {
    normalizedPlaceId,
    storageKey: `${BANNER_TOGETHER_CATALOG_CACHE_STORAGE_PREFIX}${encodeURIComponent(
      normalizedPlaceId
    )}`,
  };
}

function removeStoredValue(storage, storageKey) {
  try {
    storage.removeItem(storageKey);
  } catch {
    // Cache cleanup remains best-effort when browser storage is unavailable.
  }
}

function getCatalogCacheEvictionCandidates(
  storage,
  protectedCatalogKeys,
  now
) {
  const storageKeys = Array.from(
    { length: storage.length },
    (_value, index) => storage.key(index)
  ).filter((storageKey) => typeof storageKey === "string");
  const candidates = [];

  storageKeys.forEach((storageKey) => {
    if (storageKey.startsWith(RETIRED_MEMBERSHIP_CACHE_STORAGE_PREFIX)) {
      removeStoredValue(storage, storageKey);
      return;
    }

    if (storageKey.startsWith(BANNER_TOGETHER_MEMBERSHIP_CACHE_STORAGE_PREFIX)) {
      let isFreshMembership = false;

      try {
        const parsedValue = JSON.parse(storage.getItem(storageKey));
        const capturedDate = new Date(parsedValue?.capturedAt);
        isFreshMembership =
          parsedValue?.version === MEMBERSHIP_CACHE_VERSION &&
          typeof parsedValue?.capturedAt === "string" &&
          !Number.isNaN(capturedDate.getTime()) &&
          capturedDate.toISOString() === parsedValue.capturedAt &&
          capturedDate.getTime() - now <= CACHE_FUTURE_TOLERANCE_MS &&
          now - capturedDate.getTime() <
            BANNER_TOGETHER_MEMBERSHIP_CACHE_TTL_MS;
      } catch {
        isFreshMembership = false;
      }

      if (!isFreshMembership) {
        removeStoredValue(storage, storageKey);
      }
      return;
    }

    if (
      !storageKey.startsWith(BANNER_TOGETHER_CATALOG_CACHE_STORAGE_PREFIX) ||
      protectedCatalogKeys.has(storageKey)
    ) {
      return;
    }

    let capturedAt = null;

    try {
      const parsedValue = JSON.parse(storage.getItem(storageKey));
      const capturedDate = new Date(parsedValue?.capturedAt);

      if (
        typeof parsedValue?.capturedAt === "string" &&
        !Number.isNaN(capturedDate.getTime()) &&
        capturedDate.toISOString() === parsedValue.capturedAt &&
        capturedDate.getTime() - now <= CACHE_FUTURE_TOLERANCE_MS &&
        now - capturedDate.getTime() < BANNER_TOGETHER_CATALOG_CACHE_TTL_MS
      ) {
        capturedAt = capturedDate.getTime();
      }
    } catch {
      capturedAt = null;
    }

    if (capturedAt === null) {
      removeStoredValue(storage, storageKey);
    } else {
      candidates.push({ storageKey, capturedAt });
    }
  });

  return candidates.sort(
    (candidateA, candidateB) => candidateA.capturedAt - candidateB.capturedAt
  );
}

function storeWithCatalogEviction(
  storage,
  storageKey,
  serializedValue,
  now,
  { protectedCatalogKeys = [] } = {}
) {
  const candidates = getCatalogCacheEvictionCandidates(
    storage,
    new Set([storageKey, ...protectedCatalogKeys]),
    now
  );

  try {
    storage.setItem(storageKey, serializedValue);
    return true;
  } catch {
    // Older place catalogs are expendable when this browser reaches its quota.
  }

  for (const candidate of candidates) {
    removeStoredValue(storage, candidate.storageKey);

    try {
      storage.setItem(storageKey, serializedValue);
      return true;
    } catch {
      // Continue from the oldest remaining place catalog.
    }
  }

  return false;
}

export function loadBannerTogetherCatalogCache(
  placeId,
  { now = Date.now() } = {}
) {
  if (typeof window === "undefined") {
    return null;
  }

  const context = getCatalogCacheContext(placeId);
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
        "placeId",
        "capturedAt",
        "banners",
      ]) ||
      parsedValue.version !== CATALOG_CACHE_VERSION ||
      parsedValue.placeId !== context.normalizedPlaceId
    ) {
      throw new Error("The cached Banner Together catalog is invalid.");
    }

    return normalizeCatalogSnapshot(
      { capturedAt: parsedValue.capturedAt, banners: parsedValue.banners },
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

export function saveBannerTogetherCatalogCache(
  placeId,
  banners,
  { now = Date.now() } = {}
) {
  if (typeof window === "undefined") {
    return null;
  }

  const context = getCatalogCacheContext(placeId);
  const normalizedSnapshot = normalizeCatalogSnapshot(
    {
      capturedAt: new Date(now).toISOString(),
      banners,
    },
    { now }
  );
  const serializedValue = JSON.stringify({
    version: CATALOG_CACHE_VERSION,
    placeId: context.normalizedPlaceId,
    ...normalizedSnapshot,
  });

  try {
    if (
      !storeWithCatalogEviction(
        window.localStorage,
        context.storageKey,
        serializedValue,
        now
      )
    ) {
      return null;
    }
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

export function createBannerTogetherMembershipUrl(
  placeId,
  offset = 0,
  listType = null
) {
  const url = new URL("https://api.bannergress.com/bnrs");
  url.searchParams.set("placeId", placeId);
  addRepeatedParameters(
    url,
    "listTypes",
    listType === null ? PRIVATE_LIST_TYPES : [listType]
  );
  url.searchParams.set("orderBy", "listAdded");
  url.searchParams.set("orderDirection", "DESC");
  url.searchParams.set("limit", String(BANNER_TOGETHER_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  addRepeatedParameters(url, "attributes", ["id", "listType"]);
  return url;
}

function createConcurrencyLimiter(maximumConcurrency) {
  const pendingTasks = [];
  let activeTaskCount = 0;

  const startNextTask = () => {
    while (
      activeTaskCount < maximumConcurrency &&
      pendingTasks.length > 0
    ) {
      const { task, resolve, reject } = pendingTasks.shift();
      activeTaskCount += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeTaskCount -= 1;
          startNextTask();
        });
    }
  };

  return (task) =>
    new Promise((resolve, reject) => {
      pendingTasks.push({ task, resolve, reject });
      startNextTask();
    });
}

function normalizePrivateListType(listType) {
  if (listType === "hide") {
    return "blacklist";
  }

  return PRIVATE_LIST_TYPES.includes(listType) ? listType : null;
}

function requestBannerTogetherPageWindow({
  offsets,
  requestPage,
  signal,
}) {
  return offsets.map(async (offset) => {
    try {
      const response = await requestPage(offset, signal);
      let page = null;
      let parseError = null;

      if (response.ok) {
        try {
          page = await response.json();
        } catch (error) {
          parseError = error;
        }
      }

      return { offset, response, page, parseError, requestError: null };
    } catch (requestError) {
      return {
        offset,
        response: null,
        page: null,
        parseError: null,
        requestError,
      };
    }
  });
}

async function fetchBannerTogetherPages({
  requestPage,
  readPage,
  onPage,
  signal,
}) {
  let nextOffset = 0;
  let windowSize = 1;

  for (;;) {
    throwIfAborted(signal);
    const offsets = Array.from(
      { length: windowSize },
      (_value, index) => nextOffset + index * BANNER_TOGETHER_PAGE_SIZE
    ).filter((offset) => offset <= BANNER_TOGETHER_MAX_BANNERS);

    if (offsets.length === 0) {
      throw new Error("Banner Together pagination exceeded the safe page limit.");
    }

    const windowController = new AbortController();
    const abortWindow = () => windowController.abort();

    if (signal?.aborted) {
      abortWindow();
    } else {
      signal?.addEventListener("abort", abortWindow, { once: true });
    }

    const pageResults = requestBannerTogetherPageWindow({
      offsets,
      requestPage,
      signal: windowController.signal,
    });

    try {
      for (const pageResultPromise of pageResults) {
        const pageResult = await pageResultPromise;
        throwIfAborted(signal);
        const page = readPage(pageResult);

        if (!Array.isArray(page) || page.length > BANNER_TOGETHER_PAGE_SIZE) {
          throw new Error("Bannergress returned an invalid Banner Together page.");
        }

        onPage(page, pageResult.offset);

        if (page.length < BANNER_TOGETHER_PAGE_SIZE) {
          abortWindow();
          return;
        }

        nextOffset = pageResult.offset + BANNER_TOGETHER_PAGE_SIZE;
      }
    } catch (error) {
      abortWindow();

      if (signal?.aborted) {
        throw createAbortError();
      }

      throw error;
    } finally {
      signal?.removeEventListener("abort", abortWindow);
    }

    windowSize = BANNER_TOGETHER_PAGE_CONCURRENCY;
  }
}

export async function fetchBannerTogetherCatalog(
  placeId,
  { onPage = () => {}, signal = null } = {}
) {
  const bannersById = new Map();

  await fetchBannerTogetherPages({
    signal,
    requestPage: (offset, pageSignal) =>
      fetch(createBannerTogetherCatalogUrl(placeId, offset).toString(), {
        signal: pageSignal,
      }),
    readPage: ({ requestError, response, page, parseError }) => {
      if (requestError) {
        throw requestError;
      }

      if (!response.ok) {
        throw new Error("Bannergress could not load the place banner catalog.");
      }

      if (parseError || !Array.isArray(page)) {
        throw new Error("Bannergress returned an unexpected banner catalog.");
      }

      return page;
    },
    onPage: (page, offset) => {
      if (offset >= BANNER_TOGETHER_MAX_BANNERS && page.length > 0) {
        throw new Error("The place banner catalog exceeded the safe page limit.");
      }

      page.forEach((banner) => {
        if (typeof banner?.id === "string" && banner.id) {
          const { listType: _listType, ...publicBanner } = banner;
          bannersById.set(banner.id, publicBanner);
        }
      });

      onPage(sortCatalog([...bannersById.values()]));
    },
  });

  return sortCatalog([...bannersById.values()]);
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
  const requestController = new AbortController();
  const abortRequests = () => requestController.abort();

  if (signal?.aborted) {
    abortRequests();
  } else {
    signal?.addEventListener("abort", abortRequests, { once: true });
  }

  const requestSignal = requestController.signal;
  const limitRequest = createConcurrencyLimiter(
    BANNER_TOGETHER_PAGE_CONCURRENCY
  );
  let firstRequestError = null;
  const loadListType = (requestedListType) =>
    fetchBannerTogetherPages({
      signal: requestSignal,
      requestPage: (offset, pageSignal) =>
        limitRequest(() => {
          throwIfAborted(pageSignal);
          return fetchBannergress(
            createBannerTogetherMembershipUrl(
              placeId,
              offset,
              requestedListType
            ).toString(),
            {
              authenticate: false,
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: pageSignal,
            }
          );
        }),
      readPage: ({ requestError, response, page, parseError }) => {
        if (requestError) {
          throw requestError;
        }

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

        if (parseError || !Array.isArray(page)) {
          throw new Error("Bannergress returned unexpected private list data.");
        }

        return page;
      },
      onPage: (page, offset) => {
        if (offset >= BANNER_TOGETHER_MAX_BANNERS && page.length > 0) {
          throw new Error("The private banner lists exceeded the safe page limit.");
        }

        page.forEach((banner) => {
          if (typeof banner?.id !== "string" || !banner.id) {
            return;
          }

          const returnedListType = normalizePrivateListType(banner.listType);

          if (
            returnedListType &&
            returnedListType !== requestedListType
          ) {
            throw new Error(
              "Bannergress returned overlapping private list memberships. Refresh and try again."
            );
          }

          const previousListType = listTypeByBannerId.get(banner.id);

          if (previousListType && previousListType !== requestedListType) {
            throw new Error(
              "Bannergress returned overlapping private list memberships. Refresh and try again."
            );
          }

          listTypeByBannerId.set(banner.id, requestedListType);

          if (listTypeByBannerId.size > BANNER_TOGETHER_MAX_BANNERS) {
            throw new Error(
              "The private banner lists exceeded the safe page limit."
            );
          }
        });

        onProgress(listTypeByBannerId.size);
      },
    });

  const listRequests = PRIVATE_LIST_TYPES.map((listType) =>
    loadListType(listType).catch((error) => {
      firstRequestError ??= error;
      abortRequests();
      throw error;
    })
  );

  try {
    const settledListRequests = await Promise.allSettled(listRequests);
    const failedRequest = settledListRequests.find(
      (result) => result.status === "rejected"
    );

    if (failedRequest) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      throw firstRequestError ?? failedRequest.reason;
    }
  } finally {
    signal?.removeEventListener("abort", abortRequests);
  }

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
