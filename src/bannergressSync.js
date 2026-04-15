import { useSyncExternalStore } from "react";

export const BANNERGRESS_SYNC_STORAGE_KEY = "openbanners-bannergress-sync";
export const BANNERGRESS_SYNC_CHANGE_EVENT =
  "openbanners:bannergress-sync-change";
export const BANNERGRESS_SYNC_REQUEST =
  "openbanners:bannergress-sync-request";
export const BANNERGRESS_SYNC_READY = "openbanners:bannergress-sync-ready";
export const BANNERGRESS_SYNC_RESULT =
  "openbanners:bannergress-sync-result";
export const BANNERGRESS_SYNC_ERROR = "openbanners:bannergress-sync-error";
export const BANNERGRESS_SYNC_BRIDGE = "openbanners-bannergress-sync";
export const BANNERGRESS_TOKEN_REQUEST =
  "openbanners:bannergress-token-request";
export const BANNERGRESS_TOKEN_RESULT =
  "openbanners:bannergress-token-result";
export const BANNERGRESS_TOKEN_ERROR =
  "openbanners:bannergress-token-error";
export const BANNERGRESS_AUTH_STATUS_REQUEST =
  "openbanners:bannergress-auth-status-request";
export const BANNERGRESS_AUTH_STATUS_RESULT =
  "openbanners:bannergress-auth-status-result";
export const BANNERGRESS_AUTH_STATUS_ERROR =
  "openbanners:bannergress-auth-status-error";

const TOKEN_CACHE_SAFETY_MS = 60 * 1000;
const TOKEN_CACHE_FALLBACK_MS = 5 * 60 * 1000;

const EMPTY_SYNC_STATE = Object.freeze({
  syncedAt: null,
  bannerLists: {},
});

let cachedSyncStorageValue = null;
let cachedSyncSnapshot = EMPTY_SYNC_STATE;
const temporarilyVisibleHiddenBannerIds = new Set();

function normalizeListType(listType) {
  if (listType === "todo" || listType === "done") {
    return listType;
  }

  if (listType === "blacklist" || listType === "hide") {
    return "blacklist";
  }

  return null;
}

function normalizeStoredListType(listType) {
  const normalizedListType = normalizeListType(listType);

  if (normalizedListType) {
    return normalizedListType;
  }

  if (listType === "none") {
    return "none";
  }

  return null;
}

function buildBannerLists(source) {
  if (!source || typeof source !== "object") {
    return {};
  }

  const bannerLists = {};

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = normalizeStoredListType(key);

    if (normalizedKey && normalizedKey !== "none" && Array.isArray(value)) {
      value.forEach((entry) => {
        const bannerId =
          typeof entry === "string" ? entry : typeof entry?.id === "string" ? entry.id : null;

        if (bannerId) {
          bannerLists[bannerId] = normalizedKey;
        }
      });

      return;
    }

    const normalizedValue = normalizeStoredListType(value);

    if (normalizedValue && typeof key === "string") {
      bannerLists[key] = normalizedValue;
    }
  });

  return bannerLists;
}

function normalizeSyncState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return EMPTY_SYNC_STATE;
  }

  const bannerLists = buildBannerLists(
    rawValue.bannerLists ?? rawValue.lists ?? rawValue
  );

  return {
    syncedAt:
      typeof rawValue.syncedAt === "string" ? rawValue.syncedAt : null,
    bannerLists,
  };
}

export function loadBannergressSyncData() {
  if (typeof window === "undefined") {
    return EMPTY_SYNC_STATE;
  }

  try {
    const rawValue = window.localStorage.getItem(BANNERGRESS_SYNC_STORAGE_KEY);

    if (!rawValue) {
      cachedSyncStorageValue = null;
      cachedSyncSnapshot = EMPTY_SYNC_STATE;
      return EMPTY_SYNC_STATE;
    }

    if (rawValue === cachedSyncStorageValue) {
      return cachedSyncSnapshot;
    }

    cachedSyncStorageValue = rawValue;
    cachedSyncSnapshot = normalizeSyncState(JSON.parse(rawValue));
    return cachedSyncSnapshot;
  } catch (error) {
    console.error("Couldn't read Bannergress sync data.", error);
    cachedSyncStorageValue = null;
    cachedSyncSnapshot = EMPTY_SYNC_STATE;
    return EMPTY_SYNC_STATE;
  }
}

function emitSyncChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(BANNERGRESS_SYNC_CHANGE_EVENT));
}

export function saveBannergressSyncData(syncPayload) {
  if (typeof window === "undefined") {
    return EMPTY_SYNC_STATE;
  }

  const normalizedValue = normalizeSyncState(syncPayload);
  const storedValue = {
    version: 1,
    syncedAt: normalizedValue.syncedAt ?? new Date().toISOString(),
    bannerLists: normalizedValue.bannerLists,
  };
  const serializedValue = JSON.stringify(storedValue);

  window.localStorage.setItem(BANNERGRESS_SYNC_STORAGE_KEY, serializedValue);
  cachedSyncStorageValue = serializedValue;
  cachedSyncSnapshot = storedValue;
  emitSyncChange();

  return storedValue;
}

export function clearBannergressSyncData() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(BANNERGRESS_SYNC_STORAGE_KEY);
  cachedSyncStorageValue = null;
  cachedSyncSnapshot = EMPTY_SYNC_STATE;
  temporarilyVisibleHiddenBannerIds.clear();
  emitSyncChange();
}

function subscribeToSyncChanges(callback) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event) => {
    if (
      !event ||
      event.key === null ||
      event.key === BANNERGRESS_SYNC_STORAGE_KEY
    ) {
      callback();
    }
  };

  window.addEventListener(BANNERGRESS_SYNC_CHANGE_EVENT, callback);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(BANNERGRESS_SYNC_CHANGE_EVENT, callback);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useBannergressSync() {
  return useSyncExternalStore(
    subscribeToSyncChanges,
    loadBannergressSyncData,
    () => EMPTY_SYNC_STATE
  );
}

export function getBannerListType(syncState, bannerId, fallbackListType = null) {
  if (bannerId && Object.hasOwn(syncState?.bannerLists ?? {}, bannerId)) {
    const syncedListType = normalizeListType(syncState?.bannerLists?.[bannerId]);

    if (syncedListType) {
      return syncedListType;
    }

    return null;
  }

  return normalizeListType(fallbackListType);
}

export function getBannergressSyncCounts(syncState) {
  return Object.values(syncState?.bannerLists ?? {}).reduce(
    (counts, listType) => {
      counts[listType] = (counts[listType] ?? 0) + 1;
      return counts;
    },
    {
      todo: 0,
      done: 0,
      blacklist: 0,
    }
  );
}

let tokenRequestCounter = 0;
let cachedAccessTokenPayload = null;
let cachedAuthStatusPayload = null;

function getCachedDeadline(timestamp) {
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isTimestampUsable(timestamp) {
  return Number.isFinite(timestamp) && timestamp - Date.now() > TOKEN_CACHE_SAFETY_MS;
}

function isRecentlyUpdated(updatedAt) {
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < TOKEN_CACHE_FALLBACK_MS;
}

function hasFreshAccessToken(payload) {
  if (!payload?.accessToken) {
    return false;
  }

  return (
    isTimestampUsable(getCachedDeadline(payload.accessExpiresAt)) ||
    (!Number.isFinite(payload.accessExpiresAt) && isRecentlyUpdated(payload.updatedAt))
  );
}

function hasFreshAuthStatus(payload) {
  if (!payload?.authenticated) {
    return false;
  }

  return (
    isTimestampUsable(getCachedDeadline(payload.accessExpiresAt)) ||
    isTimestampUsable(getCachedDeadline(payload.refreshExpiresAt)) ||
    (!Number.isFinite(payload.accessExpiresAt) &&
      !Number.isFinite(payload.refreshExpiresAt) &&
      isRecentlyUpdated(payload.updatedAt))
  );
}

function cacheAccessTokenPayload(payload) {
  cachedAccessTokenPayload = payload ?? null;
}

function cacheAuthStatusPayload(payload) {
  cachedAuthStatusPayload = payload ?? null;
}

function clearAuthCaches() {
  cachedAccessTokenPayload = null;
  cachedAuthStatusPayload = null;
}

export function isBannergressBridgePresent() {
  return (
    typeof window !== "undefined" &&
    window.__openBannersBannergressBridgePresent === true
  );
}

function requestBridgePayload({
  requestType,
  resultType,
  errorType,
  timeoutMs,
  requestIdPrefix,
}) {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  if (!isBannergressBridgePresent()) {
    return Promise.resolve(null);
  }

  const requestId = `${requestIdPrefix}-${Date.now()}-${tokenRequestCounter++}`;

  return new Promise((resolve) => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (
        !event.data ||
        typeof event.data !== "object" ||
        event.data.bridge !== BANNERGRESS_SYNC_BRIDGE ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      if (event.data.type === resultType) {
        cleanup();
        resolve({
          ok: true,
          payload: event.data.payload ?? null,
          code: null,
          message: null,
        });
        return;
      }

      if (event.data.type === errorType) {
        cleanup();
        resolve({
          ok: false,
          payload: null,
          code:
            typeof event.data.code === "string" ? event.data.code : "BRIDGE_ERROR",
          message:
            typeof event.data.message === "string"
              ? event.data.message
              : null,
        });
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        type: requestType,
        bridge: BANNERGRESS_SYNC_BRIDGE,
        requestId,
      },
      window.location.origin
    );
  });
}

export async function requestBannergressAccessToken({ timeoutMs = 1800 } = {}) {
  if (hasFreshAccessToken(cachedAccessTokenPayload)) {
    return cachedAccessTokenPayload.accessToken;
  }

  const result = await requestBridgePayload({
    requestType: BANNERGRESS_TOKEN_REQUEST,
    resultType: BANNERGRESS_TOKEN_RESULT,
    errorType: BANNERGRESS_TOKEN_ERROR,
    timeoutMs,
    requestIdPrefix: "bannergress-token",
  });

  if (result?.ok && result.payload?.accessToken) {
    cacheAccessTokenPayload(result.payload);
    cacheAuthStatusPayload({
      authenticated: true,
      hasAccessToken: true,
      hasRefreshToken: cachedAuthStatusPayload?.hasRefreshToken ?? false,
      accessExpiresAt: result.payload.accessExpiresAt ?? null,
      refreshExpiresAt: cachedAuthStatusPayload?.refreshExpiresAt ?? null,
      updatedAt: result.payload.updatedAt ?? Date.now(),
    });
    return result.payload.accessToken;
  }

  clearAuthCaches();
  return null;
}

export async function requestBannergressAuthStatus({
  timeoutMs = 1500,
  forceRefresh = false,
} = {}) {
  if (!forceRefresh && hasFreshAuthStatus(cachedAuthStatusPayload)) {
    return cachedAuthStatusPayload;
  }

  const result = await requestBridgePayload({
    requestType: BANNERGRESS_AUTH_STATUS_REQUEST,
    resultType: BANNERGRESS_AUTH_STATUS_RESULT,
    errorType: BANNERGRESS_AUTH_STATUS_ERROR,
    timeoutMs,
    requestIdPrefix: "bannergress-auth-status",
  });

  if (result?.ok && result.payload) {
    cacheAuthStatusPayload(result.payload);
    return result.payload;
  }

  clearAuthCaches();
  return null;
}

export async function requestBannergressSyncData({ timeoutMs = 15000 } = {}) {
  const result = await requestBridgePayload({
    requestType: BANNERGRESS_SYNC_REQUEST,
    resultType: BANNERGRESS_SYNC_RESULT,
    errorType: BANNERGRESS_SYNC_ERROR,
    timeoutMs,
    requestIdPrefix: "bannergress-sync",
  });

  if (result?.ok) {
    return result.payload;
  }

  if (result?.code === "AUTH_REQUIRED") {
    clearAuthCaches();
  }

  throw Object.assign(
    new Error(result?.message ?? "Bannergress sync failed."),
    {
      code: result?.code ?? "SYNC_FAILED",
    }
  );
}

export async function fetchBannergress(url, options = {}) {
  const { authenticate = true, ...fetchOptions } = options;
  const token = authenticate ? await requestBannergressAccessToken() : null;
  const headers = new Headers(fetchOptions.headers ?? {});

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, {
    ...fetchOptions,
    headers,
  });
}

export function shouldKeepHiddenBannerVisible(bannerId) {
  return (
    typeof bannerId === "string" &&
    temporarilyVisibleHiddenBannerIds.has(bannerId)
  );
}

export function saveBannergressBannerListType(
  bannerId,
  listType,
  { keepHiddenVisible = false } = {}
) {
  if (!bannerId) {
    return loadBannergressSyncData();
  }

  const normalizedListType = normalizeStoredListType(listType);
  const currentState = loadBannergressSyncData();
  const bannerLists = { ...(currentState.bannerLists ?? {}) };

  if (normalizedListType) {
    bannerLists[bannerId] = normalizedListType;
  } else {
    delete bannerLists[bannerId];
  }

  if (normalizedListType === "blacklist" && keepHiddenVisible) {
    temporarilyVisibleHiddenBannerIds.add(bannerId);
  } else {
    temporarilyVisibleHiddenBannerIds.delete(bannerId);
  }

  return saveBannergressSyncData({
    syncedAt: new Date().toISOString(),
    bannerLists,
  });
}

export async function updateBannergressBannerListType(
  bannerId,
  listType,
  { keepHiddenVisible = false } = {}
) {
  const normalizedListType = normalizeStoredListType(listType);

  if (!bannerId || !normalizedListType) {
    throw new Error("A valid Bannergress list action is required.");
  }

  const response = await fetchBannergress(
    `https://api.bannergress.com/bnrs/${encodeURIComponent(bannerId)}/settings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        listType: normalizedListType,
      }),
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearAuthCaches();
    }

    const error = new Error(
      response.status === 401 || response.status === 403
        ? "Authenticate with Bannergress again."
        : "Bannergress rejected the list update."
    );

    error.status = response.status;
    throw error;
  }

  return saveBannergressBannerListType(bannerId, normalizedListType, {
    keepHiddenVisible,
  });
}

export function formatBannergressSyncTime(syncedAt) {
  if (!syncedAt) {
    return null;
  }

  const date = new Date(syncedAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function buildBannergressSyncPopupUrl(origin) {
  const url = new URL("https://bannergress.com/");
  url.searchParams.set("openbanners-sync", "1");
  url.searchParams.set("openbanners-origin", origin);
  url.hash = "openbanners-sync";
  return url.toString();
}
