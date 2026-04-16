import { useSyncExternalStore } from "react";

export const BANNERGRESS_SYNC_STORAGE_KEY = "openbanners-bannergress-sync";
export const BANNERGRESS_SYNC_CHANGE_EVENT =
  "openbanners:bannergress-sync-change";
export const BANNERGRESS_AUTH_STORAGE_KEY = "openbanners-bannergress-auth";
export const BANNERGRESS_AUTH_CHANGE_EVENT =
  "openbanners:bannergress-auth-change";
export const BANNERGRESS_AUTH_PENDING_STORAGE_KEY =
  "openbanners:bannergress-auth-pending";
export const BANNERGRESS_AUTH_COMPLETE_MESSAGE =
  "openbanners:bannergress-auth-complete";
export const BANNERGRESS_AUTH_PENDING_WINDOW_NAME_PREFIX =
  "openbanners:bannergress-auth-pending:";

const BANNERGRESS_OIDC_CONFIGURATION = Object.freeze({
  authorizationUrl:
    "https://login.bannergress.com/auth/realms/bannergress/protocol/openid-connect/auth",
  tokenUrl:
    "https://login.bannergress.com/auth/realms/bannergress/protocol/openid-connect/token",
  clientId: "openbanners",
  scope: "openid",
  callbackPath: "/bannergress-auth-callback.html",
  supportedHostname: "test.openbanners.org",
});

const TOKEN_CACHE_SAFETY_MS = 60 * 1000;
const TOKEN_CACHE_FALLBACK_MS = 5 * 60 * 1000;
const SYNC_PAGE_SIZE = 100;
const EMPTY_SYNC_STATE = Object.freeze({
  syncedAt: null,
  bannerLists: {},
});
const EMPTY_AUTH_STATE = Object.freeze({
  accessToken: null,
  idToken: null,
  refreshToken: null,
  accessExpiresAt: null,
  refreshExpiresAt: null,
  updatedAt: null,
});

let cachedSyncStorageValue = null;
let cachedSyncSnapshot = EMPTY_SYNC_STATE;
let cachedAuthStorageValue = null;
let cachedAuthSnapshot = EMPTY_AUTH_STATE;
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
          typeof entry === "string"
            ? entry
            : typeof entry?.id === "string"
              ? entry.id
              : null;

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
    syncedAt: typeof rawValue.syncedAt === "string" ? rawValue.syncedAt : null,
    bannerLists,
  };
}

function decodeJwtExpiryTimestamp(token) {
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
    const paddingLength = (4 - (normalizedPayload.length % 4)) % 4;
    const paddedPayload = `${normalizedPayload}${"=".repeat(paddingLength)}`;
    const payload = JSON.parse(window.atob(paddedPayload));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function normalizeAuthState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return EMPTY_AUTH_STATE;
  }

  const updatedAt = Number.isFinite(rawValue.updatedAt)
    ? rawValue.updatedAt
    : Date.now();
  const accessToken =
    typeof rawValue.accessToken === "string"
      ? rawValue.accessToken
      : typeof rawValue.access_token === "string"
        ? rawValue.access_token
        : null;
  const idToken =
    typeof rawValue.idToken === "string"
      ? rawValue.idToken
      : typeof rawValue.id_token === "string"
        ? rawValue.id_token
        : null;
  const refreshToken =
    typeof rawValue.refreshToken === "string"
      ? rawValue.refreshToken
      : typeof rawValue.refresh_token === "string"
        ? rawValue.refresh_token
        : null;
  const accessExpiresAt = Number.isFinite(rawValue.accessExpiresAt)
    ? rawValue.accessExpiresAt
    : Number.isFinite(rawValue.expires_in)
      ? updatedAt + rawValue.expires_in * 1000
      : decodeJwtExpiryTimestamp(accessToken);
  const refreshExpiresAt = Number.isFinite(rawValue.refreshExpiresAt)
    ? rawValue.refreshExpiresAt
    : Number.isFinite(rawValue.refresh_expires_in)
      ? updatedAt + rawValue.refresh_expires_in * 1000
      : decodeJwtExpiryTimestamp(refreshToken);

  return {
    accessToken,
    idToken,
    refreshToken,
    accessExpiresAt: Number.isFinite(accessExpiresAt) ? accessExpiresAt : null,
    refreshExpiresAt: Number.isFinite(refreshExpiresAt)
      ? refreshExpiresAt
      : null,
    updatedAt,
  };
}

function emitSyncChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(BANNERGRESS_SYNC_CHANGE_EVENT));
}

function emitAuthChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(BANNERGRESS_AUTH_CHANGE_EVENT));
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

export function loadBannergressAuthData() {
  if (typeof window === "undefined") {
    return EMPTY_AUTH_STATE;
  }

  try {
    const rawValue = window.localStorage.getItem(BANNERGRESS_AUTH_STORAGE_KEY);

    if (!rawValue) {
      cachedAuthStorageValue = null;
      cachedAuthSnapshot = EMPTY_AUTH_STATE;
      return EMPTY_AUTH_STATE;
    }

    if (rawValue === cachedAuthStorageValue) {
      return cachedAuthSnapshot;
    }

    cachedAuthStorageValue = rawValue;
    cachedAuthSnapshot = normalizeAuthState(JSON.parse(rawValue));
    return cachedAuthSnapshot;
  } catch (error) {
    console.error("Couldn't read Bannergress auth data.", error);
    cachedAuthStorageValue = null;
    cachedAuthSnapshot = EMPTY_AUTH_STATE;
    return EMPTY_AUTH_STATE;
  }
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

export function saveBannergressAuthData(authPayload) {
  if (typeof window === "undefined") {
    return EMPTY_AUTH_STATE;
  }

  const normalizedValue = normalizeAuthState(authPayload);
  const serializedValue = JSON.stringify(normalizedValue);

  window.localStorage.setItem(BANNERGRESS_AUTH_STORAGE_KEY, serializedValue);
  cachedAuthStorageValue = serializedValue;
  cachedAuthSnapshot = normalizedValue;
  emitAuthChange();

  return normalizedValue;
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

export function clearBannergressAuthData() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(BANNERGRESS_AUTH_STORAGE_KEY);
  window.localStorage.removeItem(BANNERGRESS_AUTH_PENDING_STORAGE_KEY);
  cachedAuthStorageValue = null;
  cachedAuthSnapshot = EMPTY_AUTH_STATE;
  emitAuthChange();
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
    (!Number.isFinite(payload.accessExpiresAt) &&
      isRecentlyUpdated(payload.updatedAt))
  );
}

function hasUsableRefreshToken(payload) {
  if (!payload?.refreshToken) {
    return false;
  }

  return (
    isTimestampUsable(getCachedDeadline(payload.refreshExpiresAt)) ||
    (!Number.isFinite(payload.refreshExpiresAt) &&
      isRecentlyUpdated(payload.updatedAt))
  );
}

function summarizeAuthPayload(payload) {
  if (!payload) {
    return {
      authenticated: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      accessExpiresAt: null,
      refreshExpiresAt: null,
      updatedAt: null,
    };
  }

  return {
    authenticated:
      hasFreshAccessToken(payload) || hasUsableRefreshToken(payload),
    hasAccessToken: Boolean(payload.accessToken),
    hasRefreshToken: Boolean(payload.refreshToken),
    accessExpiresAt: payload.accessExpiresAt ?? null,
    refreshExpiresAt: payload.refreshExpiresAt ?? null,
    updatedAt: payload.updatedAt ?? null,
  };
}

export function isBannergressAuthSupportedOrigin() {
  if (typeof window === "undefined") {
    return false;
  }

  if (import.meta.env.MODE === "test") {
    return true;
  }

  return (
    window.location.protocol === "https:" &&
    window.location.hostname === BANNERGRESS_OIDC_CONFIGURATION.supportedHostname
  );
}

export function getBannergressAuthRedirectUri() {
  if (typeof window === "undefined") {
    return null;
  }

  return new URL(
    BANNERGRESS_OIDC_CONFIGURATION.callbackPath,
    window.location.origin
  ).toString();
}

function toBase64Url(value) {
  return window.btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createRandomString(length) {
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  return toBase64Url(values).slice(0, length);
}

async function createPkceChallenge(verifier) {
  const encodedVerifier = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest("SHA-256", encodedVerifier);
  return toBase64Url(new Uint8Array(digest));
}

export function serializeBannergressPendingAuth(pendingAuth) {
  return `${BANNERGRESS_AUTH_PENDING_WINDOW_NAME_PREFIX}${window.encodeURIComponent(
    JSON.stringify(pendingAuth)
  )}`;
}

export async function buildBannergressAuthorizationUrl() {
  if (!isBannergressAuthSupportedOrigin()) {
    throw new Error(
      `Bannergress auth is currently only enabled on https://${BANNERGRESS_OIDC_CONFIGURATION.supportedHostname}/`
    );
  }

  const redirectUri = getBannergressAuthRedirectUri();
  const state = createRandomString(48);
  const codeVerifier = createRandomString(96);
  const codeChallenge = await createPkceChallenge(codeVerifier);
  const pendingAuth = {
    state,
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  };

  window.localStorage.setItem(
    BANNERGRESS_AUTH_PENDING_STORAGE_KEY,
    JSON.stringify(pendingAuth)
  );

  const url = new URL(BANNERGRESS_OIDC_CONFIGURATION.authorizationUrl);
  url.searchParams.set("client_id", BANNERGRESS_OIDC_CONFIGURATION.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", BANNERGRESS_OIDC_CONFIGURATION.scope);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    authorizationUrl: url.toString(),
    pendingAuth,
  };
}

async function refreshBannergressAuthData(currentAuthData) {
  const payload = currentAuthData ?? loadBannergressAuthData();

  if (!hasUsableRefreshToken(payload)) {
    clearBannergressAuthData();
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: BANNERGRESS_OIDC_CONFIGURATION.clientId,
    refresh_token: payload.refreshToken,
  });

  const response = await fetch(BANNERGRESS_OIDC_CONFIGURATION.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    clearBannergressAuthData();
    throw Object.assign(new Error("Bannergress token refresh failed."), {
      status: response.status,
      result,
    });
  }

  return saveBannergressAuthData({
    ...result,
    refreshToken: result?.refresh_token ?? payload.refreshToken,
    updatedAt: Date.now(),
  });
}

export async function requestBannergressAccessToken() {
  const authData = loadBannergressAuthData();

  if (hasFreshAccessToken(authData)) {
    return authData.accessToken;
  }

  if (hasUsableRefreshToken(authData)) {
    try {
      const refreshedAuthData = await refreshBannergressAuthData(authData);
      return hasFreshAccessToken(refreshedAuthData)
        ? refreshedAuthData.accessToken
        : null;
    } catch (error) {
      console.error("Couldn't refresh Bannergress access token.", error);
      return null;
    }
  }

  return null;
}

export async function requestBannergressAuthStatus({
  forceRefresh = false,
} = {}) {
  if (!isBannergressAuthSupportedOrigin()) {
    return null;
  }

  const authData = loadBannergressAuthData();

  if (
    forceRefresh &&
    !hasFreshAccessToken(authData) &&
    hasUsableRefreshToken(authData)
  ) {
    try {
      const refreshedAuthData = await refreshBannergressAuthData(authData);
      return summarizeAuthPayload(refreshedAuthData);
    } catch (error) {
      console.error("Couldn't refresh Bannergress auth status.", error);
      return summarizeAuthPayload(loadBannergressAuthData());
    }
  }

  return summarizeAuthPayload(authData);
}

async function assertAuthenticatedResponse(response) {
  if (response.ok) {
    return;
  }

  if (response.status === 401 || response.status === 403) {
    clearBannergressAuthData();

    throw Object.assign(new Error("Authenticate with Bannergress again."), {
      code: "AUTH_REQUIRED",
      status: response.status,
    });
  }

  throw Object.assign(new Error("Bannergress request failed."), {
    code: "REQUEST_FAILED",
    status: response.status,
  });
}

export async function requestBannergressSyncData() {
  const accessToken = await requestBannergressAccessToken();

  if (!accessToken) {
    throw Object.assign(new Error("Authenticate with Bannergress first."), {
      code: "AUTH_REQUIRED",
    });
  }

  const bannerLists = {};

  for (const listType of ["todo", "done", "blacklist"]) {
    let offset = 0;

    for (;;) {
      const url = new URL("https://api.bannergress.com/bnrs");
      url.searchParams.set("listTypes", listType);
      url.searchParams.set("limit", String(SYNC_PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("orderBy", "listAdded");
      url.searchParams.set("orderDirection", "DESC");
      url.searchParams.append("attributes", "id");
      url.searchParams.append("attributes", "listType");

      const response = await fetchBannergress(url.toString());
      await assertAuthenticatedResponse(response);
      const result = await response.json();

      if (!Array.isArray(result)) {
        throw Object.assign(new Error("Unexpected Bannergress sync response."), {
          code: "SYNC_FAILED",
        });
      }

      result.forEach((entry) => {
        if (typeof entry?.id === "string") {
          bannerLists[entry.id] = normalizeListType(entry.listType) ?? listType;
        }
      });

      if (result.length < SYNC_PAGE_SIZE) {
        break;
      }

      offset += SYNC_PAGE_SIZE;
    }
  }

  return {
    syncedAt: new Date().toISOString(),
    bannerLists,
  };
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

  await assertAuthenticatedResponse(response);

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
