// ==UserScript==
// @name         OpenBanners Bannergress Sync Bridge
// @namespace    https://test.openbanners.org/
// @version      0.2.8
// @description  Keep Bannergress auth in userscript storage and sync todo, done, and hidden lists into OpenBanners.
// @match        https://bannergress.com/*
// @match        https://*.openbanners.org/*
// @match        http://localhost/*
// @match        https://localhost/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.bannergress.com
// @connect      login.bannergress.com
// ==/UserScript==

(function () {
  "use strict";

  const BRIDGE_ID = "openbanners-bannergress-sync";
  const AUTH_STORAGE_KEY = `${BRIDGE_ID}:auth`;
  const PAGE_AUTH_EVENT = `${BRIDGE_ID}:page-auth-observed`;
  const SYNC_REQUEST = "openbanners:bannergress-sync-request";
  const SYNC_READY = "openbanners:bannergress-sync-ready";
  const SYNC_RESULT = "openbanners:bannergress-sync-result";
  const SYNC_ERROR = "openbanners:bannergress-sync-error";
  const TOKEN_REQUEST = "openbanners:bannergress-token-request";
  const TOKEN_RESULT = "openbanners:bannergress-token-result";
  const TOKEN_ERROR = "openbanners:bannergress-token-error";
  const AUTH_STATUS_REQUEST = "openbanners:bannergress-auth-status-request";
  const AUTH_STATUS_RESULT = "openbanners:bannergress-auth-status-result";
  const AUTH_STATUS_ERROR = "openbanners:bannergress-auth-status-error";
  const API_ORIGIN = "https://api.bannergress.com";
  const TOKEN_ENDPOINT =
    "https://login.bannergress.com/auth/realms/bannergress/protocol/openid-connect/token";
  const CLIENT_ID = "bannergress-website";
  const OPENBANNERS_ORIGIN_PATTERN =
    /^https?:\/\/(?:localhost(?::\d+)?|(?:[\w-]+\.)*openbanners\.org)$/;
  const TOKEN_REFRESH_SAFETY_MS = 60 * 1000;
  const DEBUG = /(?:^|[?&])openbanners-debug=1(?:&|$)/.test(
    window.location.search
  );

  function debugLog(...args) {
    if (!DEBUG) {
      return;
    }

    console.log("[OpenBanners Bannergress Bridge]", ...args);
  }

  debugLog("Userscript loaded.", {
    href: window.location.href,
    host: window.location.hostname,
  });

  function isBannergressHost() {
    return window.location.hostname === "bannergress.com";
  }

  function isOpenBannersHost() {
    return (
      window.location.hostname === "localhost" ||
      window.location.hostname === "test.openbanners.org" ||
      window.location.hostname.endsWith(".openbanners.org")
    );
  }

  function normalizeToken(rawToken) {
    if (typeof rawToken !== "string") {
      return null;
    }

    const trimmedToken = rawToken.trim();

    if (!trimmedToken) {
      return null;
    }

    return trimmedToken.replace(/^Bearer\s+/i, "");
  }

  function parseJwtExpiry(token) {
    if (typeof token !== "string") {
      return null;
    }

    const tokenParts = token.split(".");

    if (tokenParts.length < 2) {
      return null;
    }

    try {
      const base64Payload = tokenParts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(tokenParts[1].length / 4) * 4, "=");
      const payload = JSON.parse(atob(base64Payload));
      return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
    } catch (_error) {
      return null;
    }
  }

  function parseStoredAuth(rawValue) {
    if (!rawValue || typeof rawValue !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.error("OpenBanners sync bridge could not parse stored auth.", error);
      return null;
    }
  }

  function loadStoredAuth() {
    try {
      const rawValue =
        typeof GM_getValue === "function"
          ? GM_getValue(AUTH_STORAGE_KEY, "")
          : window.localStorage.getItem(AUTH_STORAGE_KEY);
      debugLog("Loaded stored auth snapshot.", {
        hasRawValue: Boolean(rawValue),
      });

      return parseStoredAuth(rawValue);
    } catch (error) {
      console.error("OpenBanners sync bridge could not read stored auth.", error);
      return null;
    }
  }

  function saveStoredAuth(authBundle) {
    const normalizedAccessToken = normalizeToken(authBundle?.accessToken);
    const normalizedRefreshToken = normalizeToken(authBundle?.refreshToken);

    if (!normalizedAccessToken && !normalizedRefreshToken) {
      return null;
    }

    const storedValue = {
      accessToken: normalizedAccessToken,
      refreshToken: normalizedRefreshToken,
      idToken: normalizeToken(authBundle?.idToken),
      tokenType:
        typeof authBundle?.tokenType === "string" && authBundle.tokenType
          ? authBundle.tokenType
          : "Bearer",
      accessExpiresAt:
        typeof authBundle?.accessExpiresAt === "number"
          ? authBundle.accessExpiresAt
          : parseJwtExpiry(normalizedAccessToken),
      refreshExpiresAt:
        typeof authBundle?.refreshExpiresAt === "number"
          ? authBundle.refreshExpiresAt
          : parseJwtExpiry(normalizedRefreshToken),
      updatedAt:
        typeof authBundle?.updatedAt === "number"
          ? authBundle.updatedAt
          : Date.now(),
      source:
        typeof authBundle?.source === "string" ? authBundle.source : "unknown",
    };

    const serializedValue = JSON.stringify(storedValue);

    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(AUTH_STORAGE_KEY, serializedValue);
      } else {
        window.localStorage.setItem(AUTH_STORAGE_KEY, serializedValue);
      }
      debugLog("Saved auth bundle.", {
        hasAccessToken: Boolean(storedValue.accessToken),
        hasRefreshToken: Boolean(storedValue.refreshToken),
        accessExpiresAt: storedValue.accessExpiresAt,
        refreshExpiresAt: storedValue.refreshExpiresAt,
        source: storedValue.source,
      });
    } catch (error) {
      console.error("OpenBanners sync bridge could not persist auth.", error);
    }

    return storedValue;
  }

  function mergeAuthPayload(payload, source) {
    debugLog("Merging observed auth payload.", {
      source,
      hasAccessToken: Boolean(payload?.accessToken ?? payload?.access_token),
      hasRefreshToken: Boolean(payload?.refreshToken ?? payload?.refresh_token),
      hasIdToken: Boolean(payload?.idToken ?? payload?.id_token),
    });
    const currentAuth = loadStoredAuth() ?? {};
    const now = Date.now();
    const accessToken =
      normalizeToken(payload?.accessToken ?? payload?.access_token) ??
      currentAuth.accessToken ??
      null;
    const refreshToken =
      normalizeToken(payload?.refreshToken ?? payload?.refresh_token) ??
      currentAuth.refreshToken ??
      null;
    const idToken =
      normalizeToken(payload?.idToken ?? payload?.id_token) ??
      currentAuth.idToken ??
      null;
    const accessExpiresInSeconds = Number(
      payload?.expiresIn ?? payload?.expires_in
    );
    const refreshExpiresInSeconds = Number(
      payload?.refreshExpiresIn ?? payload?.refresh_expires_in
    );

    return saveStoredAuth({
      accessToken,
      refreshToken,
      idToken,
      tokenType: payload?.tokenType ?? payload?.token_type ?? currentAuth.tokenType,
      accessExpiresAt: Number.isFinite(accessExpiresInSeconds)
        ? now + accessExpiresInSeconds * 1000
        : currentAuth.accessExpiresAt ?? null,
      refreshExpiresAt: Number.isFinite(refreshExpiresInSeconds)
        ? now + refreshExpiresInSeconds * 1000
        : currentAuth.refreshExpiresAt ?? null,
      updatedAt: now,
      source,
    });
  }

  function hasUsableAccessToken(authBundle) {
    if (!authBundle?.accessToken) {
      return false;
    }

    if (!authBundle.accessExpiresAt) {
      return true;
    }

    return authBundle.accessExpiresAt - Date.now() > TOKEN_REFRESH_SAFETY_MS;
  }

  function canRefreshToken(authBundle) {
    if (!authBundle?.refreshToken) {
      return false;
    }

    if (!authBundle.refreshExpiresAt) {
      return true;
    }

    return authBundle.refreshExpiresAt - Date.now() > TOKEN_REFRESH_SAFETY_MS;
  }

  function requestJson(url, options = {}) {
    const {
      method = "GET",
      headers = {},
      body,
      responseType = "json",
    } = options;

    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          url,
          method,
          headers,
          data: body,
          responseType: responseType === "json" ? "text" : responseType,
          onload: (response) => {
            let data = response.responseText;

            if (responseType === "json") {
              try {
                data = data ? JSON.parse(data) : null;
              } catch (error) {
                reject(
                  new Error(
                    `OpenBanners sync bridge could not parse JSON from ${url}.`
                  )
                );
                return;
              }
            }

            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              data,
            });
          },
          onerror: () => {
            reject(new Error(`Network request failed for ${url}.`));
          },
        });
      });
    }

    return fetch(url, {
      method,
      headers,
      body,
    }).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      data: responseType === "json" ? await response.json() : await response.text(),
    }));
  }

  async function refreshStoredAuth(authBundle) {
    debugLog("Refreshing stored auth.", {
      hasRefreshToken: Boolean(authBundle?.refreshToken),
      refreshExpiresAt: authBundle?.refreshExpiresAt ?? null,
    });
    if (!canRefreshToken(authBundle)) {
      throw Object.assign(
        new Error(
          "No stored Bannergress refresh token is available. Open Bannergress and log in once to bootstrap auth."
        ),
        { code: "AUTH_REQUIRED" }
      );
    }

    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", authBundle.refreshToken);
    body.set("client_id", CLIENT_ID);

    const response = await requestJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok || !response.data?.access_token) {
      debugLog("Refresh token request failed.", {
        status: response.status,
        hasAccessToken: Boolean(response.data?.access_token),
      });
      throw Object.assign(
        new Error(
          "Bannergress rejected the stored refresh token. Open Bannergress and log in again."
        ),
        { code: "AUTH_REQUIRED" }
      );
    }

    debugLog("Refresh token request succeeded.");
    return mergeAuthPayload(response.data, "refresh-token");
  }

  async function getAuthBundle() {
    const authBundle = loadStoredAuth();
    debugLog("Resolving auth bundle.", {
      hasUsableAccessToken: hasUsableAccessToken(authBundle),
      canRefreshToken: canRefreshToken(authBundle),
      hasAccessToken: Boolean(authBundle?.accessToken),
      hasRefreshToken: Boolean(authBundle?.refreshToken),
    });

    if (hasUsableAccessToken(authBundle)) {
      return authBundle;
    }

    if (canRefreshToken(authBundle)) {
      return refreshStoredAuth(authBundle);
    }

    throw Object.assign(
      new Error(
        "No stored Bannergress auth is available. Open Bannergress and log in once."
      ),
      { code: "AUTH_REQUIRED" }
    );
  }

  function getAuthStatusPayload() {
    const authBundle = loadStoredAuth();
    const payload = {
      authenticated:
        hasUsableAccessToken(authBundle) || canRefreshToken(authBundle),
      hasAccessToken: Boolean(authBundle?.accessToken),
      hasRefreshToken: Boolean(authBundle?.refreshToken),
      accessExpiresAt: authBundle?.accessExpiresAt ?? null,
      refreshExpiresAt: authBundle?.refreshExpiresAt ?? null,
      updatedAt: authBundle?.updatedAt ?? null,
    };
    debugLog("Computed auth status payload.", payload);

    return payload;
  }

  async function fetchBannerList(listType) {
    let authBundle = await getAuthBundle();
    let offset = 0;
    const banners = [];

    while (true) {
      const url = new URL("/bnrs", API_ORIGIN);
      url.searchParams.set("listTypes", listType);
      url.searchParams.set("limit", "100");
      url.searchParams.set("offset", String(offset));
      url.searchParams.append("attributes", "id");
      url.searchParams.append("attributes", "listType");

      let response = await requestJson(url.toString(), {
        headers: {
          Accept: "application/json",
          "Accept-Language": navigator.language || "en",
          Authorization: `Bearer ${authBundle.accessToken}`,
        },
      });

      if (response.status === 401 && canRefreshToken(authBundle)) {
        authBundle = await refreshStoredAuth(authBundle);
        response = await requestJson(url.toString(), {
          headers: {
            Accept: "application/json",
            "Accept-Language": navigator.language || "en",
            Authorization: `Bearer ${authBundle.accessToken}`,
          },
        });
      }

      if (!response.ok) {
        throw new Error(`Bannergress returned ${response.status} for ${listType}.`);
      }

      if (!Array.isArray(response.data)) {
        throw new Error(`Unexpected Bannergress response for ${listType}.`);
      }

      response.data.forEach((banner) => {
        if (typeof banner?.id === "string") {
          banners.push({
            id: banner.id,
            listType: banner.listType || listType,
          });
        }
      });

      if (response.data.length < 100) {
        break;
      }

      offset += 100;
    }

    return banners;
  }

  async function syncLists() {
    const [todo, done, blacklist] = await Promise.all([
      fetchBannerList("todo"),
      fetchBannerList("done"),
      fetchBannerList("blacklist"),
    ]);

    const bannerLists = {};

    [todo, done, blacklist].forEach((entries) => {
      entries.forEach((entry) => {
        if (entry?.id && entry?.listType) {
          bannerLists[entry.id] =
            entry.listType === "hide" ? "blacklist" : entry.listType;
        }
      });
    });

    return {
      syncedAt: new Date().toISOString(),
      bannerLists,
    };
  }

  async function getAccessTokenPayload() {
    const authBundle = await getAuthBundle();

    if (!authBundle?.accessToken) {
      throw Object.assign(
        new Error(
          "No stored Bannergress access token is available. Open Bannergress and log in once."
        ),
        { code: "AUTH_REQUIRED" }
      );
    }

    return {
      accessToken: authBundle.accessToken,
      accessExpiresAt: authBundle.accessExpiresAt ?? null,
      updatedAt: authBundle.updatedAt ?? Date.now(),
    };
  }

  function postReady(targetWindow = window.opener, targetOrigin = "*") {
    if (!targetWindow) {
      return;
    }

    debugLog("Posting bridge ready message.", {
      targetOrigin,
      hasOpener: Boolean(window.opener),
    });
    targetWindow.postMessage(
      {
        type: SYNC_READY,
        bridge: BRIDGE_ID,
      },
      targetOrigin
    );
  }

  function injectPageFlag(flagName, value) {
    const script = document.createElement("script");
    script.textContent = `window.${flagName} = ${JSON.stringify(value)};`;
    const parent = document.documentElement || document.head;

    if (!parent) {
      window.addEventListener(
        "DOMContentLoaded",
        () => injectPageFlag(flagName, value),
        { once: true }
      );
      return;
    }

    parent.appendChild(script);
    script.remove();
  }

  function injectNetworkObserver() {
    const script = document.createElement("script");
    script.textContent = `
      (() => {
        if (window.__${BRIDGE_ID.replace(/[^a-z0-9]/gi, "")}FetchObserverInstalled) {
          return;
        }

        window.__${BRIDGE_ID.replace(/[^a-z0-9]/gi, "")}FetchObserverInstalled = true;
        const originalFetch = window.fetch;
        const originalXhrOpen = XMLHttpRequest.prototype.open;
        const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        const originalXhrSend = XMLHttpRequest.prototype.send;

        const postAuth = (payload) => {
          console.log("[OpenBanners Bannergress Bridge]", "Observed page auth payload.", {
            hasAccessToken: Boolean(payload?.accessToken),
            hasRefreshToken: Boolean(payload?.refreshToken),
            hasIdToken: Boolean(payload?.idToken),
            source: payload?.source ?? "page",
          });
          window.postMessage(
            {
              type: "${PAGE_AUTH_EVENT}",
              payload,
            },
            window.location.origin
          );
        };

        const normalizeToken = (value) => {
          if (typeof value !== "string") {
            return null;
          }

          const trimmed = value.trim();

          if (!trimmed) {
            return null;
          }

          return trimmed.replace(/^Bearer\\s+/i, "");
        };

        const postAuthFromCandidate = (candidate, source) => {
          if (!candidate || typeof candidate !== "object") {
            return false;
          }

          const accessToken = normalizeToken(
            candidate.accessToken ??
              candidate.access_token ??
              candidate.token ??
              candidate.authToken
          );
          const refreshToken = normalizeToken(
            candidate.refreshToken ?? candidate.refresh_token
          );
          const idToken = normalizeToken(candidate.idToken ?? candidate.id_token);

          if (!accessToken && !refreshToken) {
            return false;
          }

          console.log("[OpenBanners Bannergress Bridge]", "Harvested auth candidate from page state.", {
            source,
            hasAccessToken: Boolean(accessToken),
            hasRefreshToken: Boolean(refreshToken),
            hasIdToken: Boolean(idToken),
          });

          postAuth({
            accessToken,
            refreshToken,
            idToken,
            tokenType: candidate.tokenType ?? candidate.token_type,
            expiresIn: candidate.expiresIn ?? candidate.expires_in,
            refreshExpiresIn:
              candidate.refreshExpiresIn ?? candidate.refresh_expires_in,
            source,
          });

          return true;
        };

        const inspectStorageEntry = (storage, key, source) => {
          try {
            const rawValue = storage.getItem(key);

            if (!rawValue) {
              return false;
            }

            const candidates = [rawValue];
            const lowerKey = String(key).toLowerCase();
            const keyLooksTokenRelated =
              lowerKey.includes("token") ||
              lowerKey.includes("auth") ||
              lowerKey.includes("keycloak");

            try {
              candidates.push(JSON.parse(rawValue));
            } catch (_error) {
              if (keyLooksTokenRelated) {
                return postAuthFromCandidate({ accessToken: rawValue }, source);
              }

              return false;
            }

            return candidates.some((candidate) => {
              if (postAuthFromCandidate(candidate, source)) {
                return true;
              }

              if (candidate && typeof candidate === "object") {
                return Object.values(candidate).some((nestedValue) =>
                  postAuthFromCandidate(nestedValue, source)
                );
              }

              return false;
            });
          } catch (error) {
            console.error(
              "OpenBanners sync bridge could not inspect storage entry.",
              error
            );
            return false;
          }
        };

        const bootstrapFromWindowState = () => {
          console.log("[OpenBanners Bannergress Bridge]", "Bootstrapping auth from window state and storage.");
          const windowCandidates = [
            window.__NEXT_DATA__,
            window.__INITIAL_STATE__,
            window.__PRELOADED_STATE__,
            window.__APOLLO_STATE__,
            window.__KEYCLOAK__,
            window.keycloak,
            window.Keycloak,
          ];

          windowCandidates.some((candidate, index) =>
            postAuthFromCandidate(candidate, "window-state-" + index)
          );

          [window.localStorage, window.sessionStorage].forEach((storage, storageIndex) => {
            try {
              for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);

                if (!key) {
                  continue;
                }

                inspectStorageEntry(
                  storage,
                  key,
                  "storage-" + storageIndex + "-" + key
                );
              }
            } catch (error) {
              console.error(
                "OpenBanners sync bridge could not enumerate storage.",
                error
              );
            }
          });
        };

        window.fetch = async (...args) => {
          const request = args[0] instanceof Request
            ? args[0]
            : new Request(args[0], args[1] ?? {});
          const response = await originalFetch.apply(window, args);

          try {
            const url = new URL(request.url, window.location.href);
            const authHeader = request.headers.get("authorization");

            if (url.origin === "${API_ORIGIN}" && authHeader) {
              postAuth({
                accessToken: authHeader,
              });
            }

            if (url.href === "${TOKEN_ENDPOINT}") {
              const data = await response.clone().json().catch(() => null);

              if (data?.access_token || data?.refresh_token) {
                postAuth({
                  accessToken: data.access_token,
                  refreshToken: data.refresh_token,
                  idToken: data.id_token,
                  tokenType: data.token_type,
                  expiresIn: data.expires_in,
                  refreshExpiresIn: data.refresh_expires_in,
                });
              }
            }
          } catch (error) {
            console.error("OpenBanners sync bridge could not inspect fetch.", error);
          }

          return response;
        };

        XMLHttpRequest.prototype.open = function (...args) {
          this.__openBannersBridgeRequestUrl = args[1];
          return originalXhrOpen.apply(this, args);
        };

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
          if (typeof name === "string" && name.toLowerCase() === "authorization") {
            this.__openBannersBridgeAuthorization = value;
          }

          return originalXhrSetRequestHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function (...args) {
          this.addEventListener("loadend", () => {
            try {
              const url = new URL(
                this.__openBannersBridgeRequestUrl,
                window.location.href
              );

              if (
                url.origin === "${API_ORIGIN}" &&
                this.__openBannersBridgeAuthorization
              ) {
                postAuth({
                  accessToken: this.__openBannersBridgeAuthorization,
                });
              }

              if (url.href === "${TOKEN_ENDPOINT}") {
                const data = JSON.parse(this.responseText || "null");

                if (data?.access_token || data?.refresh_token) {
                  postAuth({
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                    idToken: data.id_token,
                    tokenType: data.token_type,
                    expiresIn: data.expires_in,
                    refreshExpiresIn: data.refresh_expires_in,
                  });
                }
              }
            } catch (error) {
              console.error(
                "OpenBanners sync bridge could not inspect XMLHttpRequest.",
                error
              );
            }
          }, { once: true });

          return originalXhrSend.apply(this, args);
        };

        if (document.readyState === "complete") {
          bootstrapFromWindowState();
        } else {
          window.addEventListener("load", bootstrapFromWindowState, {
            once: true,
          });
        }
      })();
    `;

    const parent = document.documentElement || document.head;

    if (!parent) {
      window.addEventListener("DOMContentLoaded", injectNetworkObserver, {
        once: true,
      });
      return;
    }

    parent.appendChild(script);
    script.remove();
  }

    if (isBannergressHost()) {
    debugLog("Bridge active on Bannergress host.");
    window.addEventListener("message", (event) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === PAGE_AUTH_EVENT
      ) {
        debugLog("Received page auth event from injected observer.");
        mergeAuthPayload(event.data.payload, "bannergress-page");
      }
    });

    window.addEventListener("message", (event) => {
      if (
        !OPENBANNERS_ORIGIN_PATTERN.test(event.origin) ||
        !event.source ||
        (
          event.data?.type !== SYNC_REQUEST &&
          event.data?.type !== TOKEN_REQUEST &&
          event.data?.type !== AUTH_STATUS_REQUEST
        )
      ) {
        return;
      }

      debugLog("Received external bridge request on Bannergress.", {
        origin: event.origin,
        type: event.data?.type,
        requestId: event.data?.requestId ?? null,
      });

      const action =
        event.data.type === TOKEN_REQUEST
          ? getAccessTokenPayload()
          : event.data.type === AUTH_STATUS_REQUEST
            ? Promise.resolve(getAuthStatusPayload())
            : syncLists();

      action
        .then((payload) => {
          debugLog("Responding to bridge request on Bannergress.", {
            type: event.data.type,
            requestId: event.data.requestId,
          });
          event.source.postMessage(
            {
              type:
                event.data.type === TOKEN_REQUEST
                  ? TOKEN_RESULT
                  : event.data.type === AUTH_STATUS_REQUEST
                    ? AUTH_STATUS_RESULT
                    : SYNC_RESULT,
              bridge: BRIDGE_ID,
              requestId: event.data.requestId,
              payload,
            },
            event.origin
          );
        })
        .catch((error) => {
          debugLog("Bridge request failed on Bannergress.", {
            type: event.data?.type,
            requestId: event.data?.requestId ?? null,
            code: error?.code ?? "SYNC_FAILED",
            message:
              error instanceof Error ? error.message : "Bannergress sync failed.",
          });
          event.source.postMessage(
            {
              type:
                event.data.type === TOKEN_REQUEST
                  ? TOKEN_ERROR
                  : event.data.type === AUTH_STATUS_REQUEST
                    ? AUTH_STATUS_ERROR
                    : SYNC_ERROR,
              bridge: BRIDGE_ID,
              requestId: event.data.requestId,
              code: error?.code ?? "SYNC_FAILED",
              message:
                error instanceof Error ? error.message : "Bannergress sync failed.",
            },
            event.origin
          );
        });
    });

    injectNetworkObserver();

    if (window.opener) {
      const targetOrigin =
        new URLSearchParams(window.location.search).get("openbanners-origin") || "*";
      postReady(window.opener, targetOrigin);
    }
  }

  if (isOpenBannersHost()) {
    debugLog("Bridge active on OpenBanners host.");
    window.__openBannersBannergressBridgePresent = true;
    injectPageFlag("__openBannersBannergressBridgePresent", true);

    const announceReady = () => {
      debugLog("Announcing local bridge readiness.");
      window.postMessage(
        {
          type: SYNC_READY,
          bridge: BRIDGE_ID,
          source: "userscript",
        },
        window.location.origin
      );
    };

    window.addEventListener("message", (event) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.bridge !== BRIDGE_ID
      ) {
        return;
      }

      debugLog("Received local bridge request on OpenBanners.", {
        type: event.data?.type,
        requestId: event.data?.requestId ?? null,
      });

      if (event.data.type === SYNC_READY) {
        if (event.data.source === "userscript") {
          return;
        }

        announceReady();
        return;
      }

      const action =
        event.data.type === TOKEN_REQUEST
          ? getAccessTokenPayload()
          : event.data.type === AUTH_STATUS_REQUEST
            ? Promise.resolve(getAuthStatusPayload())
          : event.data.type === SYNC_REQUEST
            ? syncLists()
            : null;

      if (!action) {
        return;
      }

      action.then((payload) => {
          debugLog("Responding to local bridge request on OpenBanners.", {
            type: event.data.type,
            requestId: event.data.requestId,
          });
          window.postMessage(
            {
              type:
                event.data.type === TOKEN_REQUEST
                  ? TOKEN_RESULT
                  : event.data.type === AUTH_STATUS_REQUEST
                    ? AUTH_STATUS_RESULT
                    : SYNC_RESULT,
              bridge: BRIDGE_ID,
              requestId: event.data.requestId,
              payload,
            },
            window.location.origin
          );
        })
        .catch((error) => {
          debugLog("Local bridge request failed on OpenBanners.", {
            type: event.data?.type,
            requestId: event.data?.requestId ?? null,
            code: error?.code ?? "SYNC_FAILED",
            message:
              error instanceof Error ? error.message : "Bannergress sync failed.",
          });
          window.postMessage(
            {
              type:
                event.data.type === TOKEN_REQUEST
                  ? TOKEN_ERROR
                  : event.data.type === AUTH_STATUS_REQUEST
                    ? AUTH_STATUS_ERROR
                    : SYNC_ERROR,
              bridge: BRIDGE_ID,
              requestId: event.data.requestId,
              code: error?.code ?? "SYNC_FAILED",
              message:
                error instanceof Error ? error.message : "Bannergress sync failed.",
            },
            window.location.origin
          );
        });
    });

    announceReady();
  }
})();
