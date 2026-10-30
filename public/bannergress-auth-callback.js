// public/bannergress-auth-callback.html's script, as a file so the
// Content-Security-Policy can be script-src 'self'.
const AUTH_STORAGE_KEY = "openbanners-bannergress-auth";
// Must match BANNERGRESS_AUTH_PENDING_STORAGE_KEY in src/bannergressSync.js
// (src/bannergressAuthCallback.test.js checks). The second name is what
// this page used to read; still accepted, and cleared with the first.
const AUTH_PENDING_STORAGE_KEY = "openbanners:bannergress-auth-pending";
const AUTH_PENDING_STORAGE_KEYS = [
  AUTH_PENDING_STORAGE_KEY,
  "openbanners-bannergress-auth-pending",
];
const AUTH_COMPLETE_MESSAGE = "openbanners:bannergress-auth-complete";
const AUTH_PENDING_WINDOW_NAME_PREFIX =
  "openbanners:bannergress-auth-pending:";
const TOKEN_URL =
  "https://login.bannergress.com/auth/realms/bannergress/protocol/openid-connect/token";
const CLIENT_ID = "openbanners";
const CALLBACK_PATH = "/bannergress-auth-callback.html";

function setStatus(title, message) {
  document.getElementById("title").textContent = title;
  document.getElementById("message").textContent = message;
}

// A path on this site only (the app saves where the sign-in started).
// Strict: one leading "/", no whitespace/control characters or
// backslashes (browsers drop tabs/newlines, so "/<TAB>/evil" would turn
// into "//evil"), and it must resolve to this origin.
function safeReturnPath(value) {
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
  } catch (error) {
    return "/";
  }
}

function setBackLink(pendingAuth) {
  const back = document.getElementById("back");
  const path = safeReturnPath(pendingAuth && pendingAuth.returnTo);

  if (back) {
    back.setAttribute("href", path);
  }

  return path;
}

function parseLocationParams() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashSource = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashSource);

  const getParam = (name) =>
    searchParams.get(name) ?? hashParams.get(name) ?? null;

  return {
    code: getParam("code"),
    state: getParam("state"),
    error: getParam("error"),
    errorDescription: getParam("error_description"),
  };
}

function readStorageValue(storage, key) {
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(storage, key, value) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, value);
  } catch {}
}

function removeStorageValue(storage, key) {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {}
}

function readPendingValue(storage) {
  for (const key of AUTH_PENDING_STORAGE_KEYS) {
    const value = readStorageValue(storage, key);

    if (value) {
      return value;
    }
  }

  return null;
}

function removePendingValue(storage) {
  for (const key of AUTH_PENDING_STORAGE_KEYS) {
    removeStorageValue(storage, key);
  }
}

function parseJson(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parsePendingAuthFromWindowName() {
  if (
    typeof window.name !== "string" ||
    !window.name.startsWith(AUTH_PENDING_WINDOW_NAME_PREFIX)
  ) {
    return null;
  }

  return parseJson(
    window.decodeURIComponent(
      window.name.slice(AUTH_PENDING_WINDOW_NAME_PREFIX.length)
    )
  );
}

function getOpenerLocalStorage() {
  if (!window.opener || window.opener === window) {
    return null;
  }

  try {
    if (window.opener.location.origin !== window.location.origin) {
      return null;
    }

    return window.opener.localStorage;
  } catch {
    return null;
  }
}

function loadPendingAuth() {
  const localValue = readPendingValue(window.localStorage);
  const openerStorage = getOpenerLocalStorage();
  const openerValue = readPendingValue(openerStorage);
  const pendingAuth =
    parseJson(localValue) ??
    parseJson(openerValue) ??
    parsePendingAuthFromWindowName();

  if (pendingAuth && !localValue) {
    writeStorageValue(
      window.localStorage,
      AUTH_PENDING_STORAGE_KEY,
      JSON.stringify(pendingAuth)
    );
  }

  return pendingAuth;
}

function saveCompletedAuth(authPayload) {
  const serializedValue = JSON.stringify(authPayload);
  const openerStorage = getOpenerLocalStorage();

  writeStorageValue(window.localStorage, AUTH_STORAGE_KEY, serializedValue);
  writeStorageValue(openerStorage, AUTH_STORAGE_KEY, serializedValue);
  removePendingValue(window.localStorage);
  removePendingValue(openerStorage);
  window.name = "";
}

function decodeJwtExpiryTimestamp(token) {
  if (typeof token !== "string") {
    return null;
  }

  try {
    const encodedPayload = token.split(".")[1];

    if (!encodedPayload) {
      return null;
    }

    const normalizedPayload = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const paddingLength = (4 - (normalizedPayload.length % 4)) % 4;
    const paddedPayload = `${normalizedPayload}${"=".repeat(paddingLength)}`;
    const payload = JSON.parse(window.atob(paddedPayload));
    return Number.isFinite(payload && payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function buildStoredAuthPayload(tokenResult) {
  const updatedAt = Date.now();
  const accessExpiresAt = Number.isFinite(tokenResult.expires_in)
    ? updatedAt + tokenResult.expires_in * 1000
    : decodeJwtExpiryTimestamp(tokenResult.access_token);
  const refreshExpiresAt = Number.isFinite(tokenResult.refresh_expires_in)
    ? updatedAt + tokenResult.refresh_expires_in * 1000
    : decodeJwtExpiryTimestamp(tokenResult.refresh_token);

  return {
    accessToken:
      typeof tokenResult.access_token === "string"
        ? tokenResult.access_token
        : null,
    idToken:
      typeof tokenResult.id_token === "string" ? tokenResult.id_token : null,
    refreshToken:
      typeof tokenResult.refresh_token === "string"
        ? tokenResult.refresh_token
        : null,
    accessExpiresAt: Number.isFinite(accessExpiresAt) ? accessExpiresAt : null,
    refreshExpiresAt: Number.isFinite(refreshExpiresAt)
      ? refreshExpiresAt
      : null,
    updatedAt,
  };
}

function notifyOpener(payload) {
  if (window.opener && window.opener !== window) {
    window.opener.postMessage(
      {
        type: AUTH_COMPLETE_MESSAGE,
        ...payload,
      },
      window.location.origin
    );
  }
}

async function finishAuthentication() {
  const { code, state, error, errorDescription } = parseLocationParams();

  if (error) {
    const message = errorDescription || `Authentication failed: ${error}`;
    notifyOpener({ success: false, message });
    setStatus("Bannergress sign-in failed", message);
    return;
  }

  const pendingAuth = loadPendingAuth();
  const returnPath = setBackLink(pendingAuth);
  // The sign-in ran in the site's own tab (no popup): go back there.
  const sameTab = Boolean(pendingAuth && pendingAuth.mode === "redirect");

  if (!code || !state || !pendingAuth) {
    const missingParts = [];

    if (!code) {
      missingParts.push("authorization code");
    }

    if (!state) {
      missingParts.push("sign-in state");
    }

    if (!pendingAuth) {
      missingParts.push("saved PKCE session");
    }

    const message = `The Bannergress callback is missing required data${
      missingParts.length > 0 ? `: ${missingParts.join(", ")}.` : "."
    }`;
    notifyOpener({ success: false, message });
    setStatus("Bannergress sign-in failed", message);
    return;
  }

  if (pendingAuth.state !== state) {
    const message = "The Bannergress sign-in state did not match.";
    removePendingValue(window.localStorage);
    removePendingValue(getOpenerLocalStorage());
    window.name = "";
    notifyOpener({ success: false, message });
    setStatus("Bannergress sign-in failed", message);
    return;
  }

  const redirectUri =
    typeof pendingAuth.redirectUri === "string"
      ? pendingAuth.redirectUri
      : new URL(CALLBACK_PATH, window.location.origin).toString();

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: pendingAuth.codeVerifier,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const tokenResult = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        tokenResult && tokenResult.error_description
          ? tokenResult.error_description
          : "Bannergress rejected the token exchange."
      );
    }

    saveCompletedAuth(buildStoredAuthPayload(tokenResult));
    notifyOpener({ success: true });
    setStatus(
      "Bannergress sign-in complete",
      sameTab
        ? "Taking you back to OpenBanners…"
        : "You can return to OpenBanners now."
    );

    if (sameTab) {
      window.setTimeout(() => {
        window.location.replace(returnPath);
      }, 600);
    } else {
      window.setTimeout(() => {
        window.close();
      }, 150);
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Bannergress sign-in could not be completed.";
    removePendingValue(window.localStorage);
    removePendingValue(getOpenerLocalStorage());
    window.name = "";
    notifyOpener({ success: false, message });
    setStatus("Bannergress sign-in failed", message);
  }
}

void finishAuthentication();
