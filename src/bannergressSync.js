import { useSyncExternalStore } from "react";
import { getLanguage, t } from "./i18n";

export const BANNERGRESS_SYNC_STORAGE_KEY = "openbanners-bannergress-sync";
export const BANNERGRESS_SYNC_CHANGE_EVENT =
  "openbanners:bannergress-sync-change";
export const BANNERGRESS_AUTH_STORAGE_KEY = "openbanners-bannergress-auth";
export const BANNERGRESS_AUTH_CHANGE_EVENT =
  "openbanners:bannergress-auth-change";
// The Ingress agent name of the signed-in account, from Bannergress's /user
// endpoint (the sign-in tokens carry no agent name). Cached per account.
export const BANNERGRESS_AGENT_STORAGE_KEY = "openbanners-bannergress-agent";
export const BANNERGRESS_AGENT_CHANGE_EVENT =
  "openbanners:bannergress-agent-change";
export const BANNERGRESS_USER_URL = "https://api.bannergress.com/user";
export const BANNERGRESS_AUTH_PENDING_STORAGE_KEY =
  "openbanners:bannergress-auth-pending";
export const BANNERGRESS_AUTH_COMPLETE_MESSAGE =
  "openbanners:bannergress-auth-complete";
export const BANNERGRESS_AUTH_REQUEST_EVENT =
  "openbanners:bannergress-auth-request";
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
  supportedHostnames: [
    "test.openbanners.org",
    "openbanners.org",
    "www.openbanners.org",
  ],
});

const TOKEN_CACHE_SAFETY_MS = 60 * 1000;
const TOKEN_CACHE_FALLBACK_MS = 5 * 60 * 1000;
const SYNC_PAGE_SIZE = 100;
// Every Bannergress request in the list sync gives up after this long, so the
// Lists counters can't wait forever on one stuck request.
export const BANNERGRESS_REQUEST_TIMEOUT_MS = 15 * 1000;
// 100 pages of 100 = 10,000 banners per list; past that the API is looping.
const SYNC_MAX_PAGES = 100;
const SYNC_DEBUG =
  typeof window !== "undefined" &&
  /(?:^|[?&])openbanners-debug=1(?:&|$)/.test(window.location?.search ?? "");

function syncDebug(...args) {
  if (SYNC_DEBUG) {
    // Strings, so a copied console shows the details instead of "Object".
    console.log(
      "[OpenBanners sync]",
      ...args.map((arg) => (arg && typeof arg === "object" ? JSON.stringify(arg) : arg))
    );
  }
}

// Runs task(signal); rejects with code TIMEOUT (and aborts the request) when it
// takes longer than timeoutMs, including the time to read the body.
export function withTimeout(task, timeoutMs, label = "request") {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(
        Object.assign(
          new Error(
            t("Bannergress {label} timed out after {seconds} s.", {
              label,
              seconds: Math.round(timeoutMs / 1000),
            })
          ),
          { code: "TIMEOUT" }
        )
      );
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve().then(() => task(controller?.signal)),
    timeout,
  ]).finally(() => clearTimeout(timer));
}
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
let refreshAuthPromise = null;
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

function decodeJwtPayload(token) {
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
    const payloadBytes = Uint8Array.from(
      globalThis.atob(paddedPayload),
      (character) => character.charCodeAt(0)
    );
    const payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)
    );
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function decodeJwtExpiryTimestamp(token) {
  const payload = decodeJwtPayload(token);
  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
}

function normalizeBannergressAgentName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.normalize("NFC");

  if (
    normalizedValue.length === 0 ||
    normalizedValue.trim() !== normalizedValue ||
    Array.from(normalizedValue).length > 64 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(
      normalizedValue
    )
  ) {
    return null;
  }

  return normalizedValue;
}

export function getBannergressAgentName(
  authData = loadBannergressAuthData()
) {
  for (const token of [authData?.idToken, authData?.accessToken]) {
    const agentName = normalizeBannergressAgentName(
      decodeJwtPayload(token)?.preferred_username
    );

    if (agentName) {
      return agentName;
    }
  }

  return null;
}

// Bannergress account identity (issuer + subject) from the tokens, so a cached
// agent name is never shown for another account signed in later.
export function getBannergressAccountId(authData = loadBannergressAuthData()) {
  for (const token of [authData?.idToken, authData?.accessToken]) {
    const payload = decodeJwtPayload(token);

    if (typeof payload?.sub === "string" && payload.sub) {
      return `${typeof payload.iss === "string" ? payload.iss : ""}:${payload.sub}`;
    }
  }

  return null;
}

// Agent name from a Bannergress /user response ({ agent: { name } }); null when
// the account has no verified agent or the value is unusable.
export function readBannergressUserAgentName(user) {
  const name = user?.agent?.name;
  return normalizeBannergressAgentName(
    typeof name === "string" ? name.trim() : null
  );
}

const AGENT_NAME_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const AGENT_NAME_MISSING_RECHECK_MS = 30 * 60 * 1000;
let agentNameRequest = null;

function readCachedAgentRecord(authData) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const record = JSON.parse(
      window.localStorage.getItem(BANNERGRESS_AGENT_STORAGE_KEY) ?? "null"
    );

    if (
      !record ||
      typeof record !== "object" ||
      record.account !== getBannergressAccountId(authData) ||
      !Number.isFinite(record.fetchedAt)
    ) {
      return null;
    }

    return {
      name: normalizeBannergressAgentName(record.name),
      fetchedAt: record.fetchedAt,
    };
  } catch {
    return null;
  }
}

function writeCachedAgentRecord(authData, name) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      BANNERGRESS_AGENT_STORAGE_KEY,
      JSON.stringify({
        account: getBannergressAccountId(authData),
        name: name ?? null,
        fetchedAt: Date.now(),
      })
    );
  } catch {
    // Storage full or blocked: the name is just fetched again next time.
  }

  window.dispatchEvent(new CustomEvent(BANNERGRESS_AGENT_CHANGE_EVENT));
}

// Name shown for the signed-in account: the verified Ingress agent name from
// Bannergress (cached), else a username claim in the tokens, else null (the
// UI then says just "Signed in").
export function getBannergressDisplayName(
  authData = loadBannergressAuthData()
) {
  return (
    readCachedAgentRecord(authData)?.name ?? getBannergressAgentName(authData)
  );
}

// Fetches the agent name from Bannergress when the cache is missing or old.
// Resolves to the display name; never rejects.
export function refreshBannergressAgentName({ force = false } = {}) {
  const authData = loadBannergressAuthData();

  if (!authData.accessToken && !authData.refreshToken) {
    return Promise.resolve(null);
  }

  const cached = readCachedAgentRecord(authData);
  const maxAge = cached?.name ? AGENT_NAME_MAX_AGE_MS : AGENT_NAME_MISSING_RECHECK_MS;

  if (!force && cached && Date.now() - cached.fetchedAt < maxAge) {
    return Promise.resolve(getBannergressDisplayName(authData));
  }

  if (!agentNameRequest) {
    agentNameRequest = withTimeout(
      (signal) => fetchBannergress(BANNERGRESS_USER_URL, { signal }),
      BANNERGRESS_REQUEST_TIMEOUT_MS,
      "user request"
    )
      .then(async (response) => {
        if (!response?.ok) {
          return getBannergressDisplayName(authData);
        }

        const user = await response.json().catch(() => null);

        if (!user || typeof user !== "object") {
          return getBannergressDisplayName(authData);
        }

        writeCachedAgentRecord(authData, readBannergressUserAgentName(user));
        return getBannergressDisplayName(authData);
      })
      .catch(() => getBannergressDisplayName(authData))
      .finally(() => {
        agentNameRequest = null;
      });
  }

  return agentNameRequest;
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
  window.localStorage.removeItem(BANNERGRESS_AGENT_STORAGE_KEY);
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

function subscribeToAuthChanges(callback) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event) => {
    if (
      !event ||
      event.key === null ||
      event.key === BANNERGRESS_AUTH_STORAGE_KEY
    ) {
      callback();
    }
  };

  window.addEventListener(BANNERGRESS_AUTH_CHANGE_EVENT, callback);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(BANNERGRESS_AUTH_CHANGE_EVENT, callback);
    window.removeEventListener("storage", handleStorage);
  };
}

// A stored session (it may still need a token refresh). Signed-out visitors
// get a "sign in" prompt instead of a request that can only fail.
export function isSignedInToBannergress() {
  const auth = loadBannergressAuthData();
  return Boolean(auth?.accessToken || auth?.refreshToken);
}

export function useBannergressAuth() {
  return useSyncExternalStore(
    subscribeToAuthChanges,
    loadBannergressAuthData,
    () => EMPTY_AUTH_STATE
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
    BANNERGRESS_OIDC_CONFIGURATION.supportedHostnames.includes(
      window.location.hostname
    )
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

// A path on this site only: one leading "/", no whitespace, control
// characters or backslashes (browsers strip tabs/newlines from URLs, so
// "/<TAB>/evil.example" would become "//evil.example"), same origin.
export function safeReturnPath(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\s\u0000-\u001f\u007f\\]/.test(value)
  ) {
    return "/";
  }
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin
      ? url.pathname + url.search + url.hash
      : "/";
  } catch {
    return "/";
  }
}

// mode "redirect": the sign-in runs in this tab (no popup); the callback page
// then goes back to returnTo (a path on this site).
export async function buildBannergressAuthorizationUrl({ mode = "popup", returnTo = null } = {}) {
  if (!isBannergressAuthSupportedOrigin()) {
    throw new Error(
      t("Bannergress auth is currently only enabled on {hosts}", {
        hosts: BANNERGRESS_OIDC_CONFIGURATION.supportedHostnames
          .map((hostname) => `https://${hostname}/`)
          .join(", "),
      })
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
    mode: mode === "redirect" ? "redirect" : "popup",
    returnTo: safeReturnPath(returnTo),
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
    if (loadBannergressAuthData().refreshToken === payload.refreshToken) {
      clearBannergressAuthData();
    }
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: BANNERGRESS_OIDC_CONFIGURATION.clientId,
    refresh_token: payload.refreshToken,
  });

  syncDebug("Refreshing Bannergress access token.");
  // A refresh that never answers used to hold the shared refresh lock forever,
  // so every later sync waited on it too.
  const { response, result } = await withTimeout(async (signal) => {
    const tokenResponse = await fetch(BANNERGRESS_OIDC_CONFIGURATION.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal,
    });

    return {
      response: tokenResponse,
      result: await tokenResponse.json().catch(() => null),
    };
  }, BANNERGRESS_REQUEST_TIMEOUT_MS, "token refresh");
  syncDebug("Token refresh answered.", { status: response.status });

  if (!response.ok) {
    if (loadBannergressAuthData().refreshToken === payload.refreshToken) {
      clearBannergressAuthData();
    }
    throw Object.assign(new Error(t("Bannergress token refresh failed.")), {
      status: response.status,
      result,
    });
  }

  const latestAuthData = loadBannergressAuthData();

  if (latestAuthData.refreshToken !== payload.refreshToken) {
    return latestAuthData;
  }

  return saveBannergressAuthData({
    ...result,
    refreshToken: result?.refresh_token ?? payload.refreshToken,
    updatedAt: Date.now(),
  });
}

function requestBannergressAuthRefresh(currentAuthData) {
  if (!refreshAuthPromise) {
    refreshAuthPromise = refreshBannergressAuthData(currentAuthData).finally(() => {
      refreshAuthPromise = null;
    });
  }

  return refreshAuthPromise;
}

export async function requestBannergressAccessToken() {
  const authData = loadBannergressAuthData();

  if (hasFreshAccessToken(authData)) {
    return authData.accessToken;
  }

  if (hasUsableRefreshToken(authData)) {
    try {
      const refreshedAuthData = await requestBannergressAuthRefresh(authData);
      return hasFreshAccessToken(refreshedAuthData)
        ? refreshedAuthData.accessToken
        : null;
    } catch (error) {
      console.error("Couldn't refresh Bannergress access token.", error);
      const latestAuthData = loadBannergressAuthData();
      return hasFreshAccessToken(latestAuthData)
        ? latestAuthData.accessToken
        : null;
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
      const refreshedAuthData = await requestBannergressAuthRefresh(authData);
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

    throw Object.assign(new Error(t("Authenticate with Bannergress again.")), {
      code: "AUTH_REQUIRED",
      status: response.status,
    });
  }

  throw Object.assign(new Error(t("Bannergress request failed.")), {
    code: "REQUEST_FAILED",
    status: response.status,
  });
}

// Like requestBannergressAccessToken, but a refresh that times out or can't
// reach Bannergress is reported as such instead of as "sign in again".
async function requestSyncAccessToken() {
  const authData = loadBannergressAuthData();

  if (hasFreshAccessToken(authData)) {
    return authData.accessToken;
  }

  if (!hasUsableRefreshToken(authData)) {
    return null;
  }

  try {
    const refreshedAuthData = await requestBannergressAuthRefresh(authData);
    return hasFreshAccessToken(refreshedAuthData)
      ? refreshedAuthData.accessToken
      : null;
  } catch (error) {
    syncDebug("Token refresh failed.", {
      code: error?.code ?? null,
      status: error?.status ?? null,
      message: error?.message,
    });
    const latestAuthData = loadBannergressAuthData();

    if (hasFreshAccessToken(latestAuthData)) {
      return latestAuthData.accessToken;
    }

    if (error?.code === "TIMEOUT") {
      throw error;
    }

    if (!Number.isFinite(error?.status)) {
      throw Object.assign(new Error(t("Couldn't reach Bannergress.")), {
        code: "NETWORK",
        cause: error,
      });
    }

    return null;
  }
}

function syncRequestError(response) {
  if (response.status === 401 || response.status === 403) {
    clearBannergressAuthData();
    return Object.assign(new Error(t("Authenticate with Bannergress again.")), {
      code: "AUTH_REQUIRED",
      status: response.status,
    });
  }

  return Object.assign(new Error(t("Bannergress answered {status}.", { status: response.status })), {
    code: "REQUEST_FAILED",
    status: response.status,
  });
}

// One page of a list: { ok, status, result } with the body already read, all
// inside the timeout. Network errors become code NETWORK.
async function requestSyncPage(url, accessToken, timeoutMs) {
  return withTimeout(async (signal) => {
    let response;

    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      throw Object.assign(new Error(t("Couldn't reach Bannergress.")), {
        code: "NETWORK",
        cause: error,
      });
    }

    if (!response.ok) {
      return { ok: false, status: response.status, response };
    }

    let result;

    try {
      result = await response.json();
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      throw Object.assign(new Error(t("Unexpected Bannergress sync response.")), {
        code: "SYNC_FAILED",
        status: response.status,
      });
    }

    return { ok: true, status: response.status, result };
  }, timeoutMs, "list request");
}

// Retrying without `attributes` only makes sense when Bannergress rejected
// the request itself; overload (429) and server errors fail the sync.
function shouldRetryWithoutAttributes(status) {
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

let syncInFlightPromise = null;

// The app-start sync and the Lists page share one run instead of asking twice.
export function requestBannergressSyncData(options) {
  if (options) {
    return runBannergressSync(options);
  }

  if (!syncInFlightPromise) {
    syncInFlightPromise = runBannergressSync().finally(() => {
      syncInFlightPromise = null;
    });
  }

  return syncInFlightPromise;
}

async function runBannergressSync({
  timeoutMs = BANNERGRESS_REQUEST_TIMEOUT_MS,
  maxPages = SYNC_MAX_PAGES,
} = {}) {
  syncDebug("List sync started.");
  const accessToken = await requestSyncAccessToken();

  if (!accessToken) {
    syncDebug("No usable Bannergress token.");
    throw Object.assign(new Error(t("Authenticate with Bannergress first.")), {
      code: "AUTH_REQUIRED",
    });
  }

  const bannerLists = {};
  // Ask only for id + listType; if Bannergress refuses that, ask again once for
  // whole banners, so one bad answer can't leave every count at 0.
  let idsOnly = true;

  for (const listType of ["todo", "done", "blacklist"]) {
    let offset = 0;
    const seenIds = new Set();

    for (let page = 0; ; page += 1) {
      if (page >= maxPages) {
        syncDebug("Stopped paging: too many pages.", { listType, page });
        break;
      }

      const url = new URL("https://api.bannergress.com/bnrs");
      url.searchParams.set("listTypes", listType);
      url.searchParams.set("limit", String(SYNC_PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("orderBy", "listAdded");
      url.searchParams.set("orderDirection", "DESC");

      if (idsOnly) {
        url.searchParams.append("attributes", "id");
        url.searchParams.append("attributes", "listType");
      }

      syncDebug("Requesting page.", { listType, offset, idsOnly });
      let answer = await requestSyncPage(url.toString(), accessToken, timeoutMs);
      syncDebug("Page answered.", {
        listType,
        offset,
        status: answer.status,
        count: Array.isArray(answer.result) ? answer.result.length : null,
      });

      if (!answer.ok && idsOnly && shouldRetryWithoutAttributes(answer.status)) {
        idsOnly = false;
        url.searchParams.delete("attributes");
        syncDebug("Retrying page without attributes.", { listType, offset });
        answer = await requestSyncPage(url.toString(), accessToken, timeoutMs);
        syncDebug("Retry answered.", { listType, offset, status: answer.status });
      }

      if (!answer.ok) {
        throw syncRequestError(answer);
      }

      const result = answer.result;

      if (!Array.isArray(result)) {
        throw Object.assign(new Error(t("Unexpected Bannergress sync response.")), {
          code: "SYNC_FAILED",
          status: answer.status,
        });
      }

      let newIds = 0;

      result.forEach((entry) => {
        if (typeof entry?.id === "string") {
          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            newIds += 1;
          }

          bannerLists[entry.id] = normalizeListType(entry.listType) ?? listType;
        }
      });

      if (result.length < SYNC_PAGE_SIZE) {
        break;
      }

      if (newIds === 0) {
        // Same page again: Bannergress ignored the offset.
        syncDebug("Stopped paging: page repeated.", { listType, offset });
        break;
      }

      offset += SYNC_PAGE_SIZE;
    }
  }

  syncDebug("List sync done.", { banners: Object.keys(bannerLists).length });

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

// Banners hidden from a row/banner page stay visible only until the user comes
// back to a list, so Browse never keeps showing banners that are marked Hidden.
export function forgetTemporarilyVisibleHiddenBanners() {
  temporarilyVisibleHiddenBannerIds.clear();
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

  return new Intl.DateTimeFormat(getLanguage(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
