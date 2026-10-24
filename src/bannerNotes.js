import { useCallback, useEffect, useState } from "react";
import { requestBannergressAccessToken, useBannergressAuth } from "./bannergressSync";
import { PASSPHRASES_BASE } from "./passphraseApi";

// Personal banner notes. They are encrypted in this browser (AES-GCM) with a
// key per Bannergress account that stays on the device: the server only keeps
// ciphertext and a fingerprint of the key. Another device gets the key through
// a link with the key in its #fragment, which never reaches a server.
export const NOTES_KEYS_STORAGE_KEY = "openbanners-notes-keys";
const PENDING_KEY_STORAGE_KEY = "openbanners-notes-key-pending";
const LINK_PREFIX = "#notes-key=";
const KEYS_EVENT = "openbanners:notes-keys";
export const MAX_NOTE_LENGTH = 10000;

const toB64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (text) => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// The account a token belongs to (its subject), as the server sees it.
export function accountOf(token) {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64(token.split(".")[1]))).sub || null;
  } catch {
    return null;
  }
}

function readKeys() {
  try {
    return JSON.parse(window.localStorage.getItem(NOTES_KEYS_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export const localKeyFor = (account) => (account ? readKeys()[account] ?? null : null);

function storeKey(account, rawKey) {
  window.localStorage.setItem(NOTES_KEYS_STORAGE_KEY, JSON.stringify({ ...readKeys(), [account]: rawKey }));
  window.dispatchEvent(new Event(KEYS_EVENT));
}

export async function keyIdOf(rawKey) {
  return toB64(await crypto.subtle.digest("SHA-256", fromB64(rawKey))).slice(0, 22);
}

export const newRawKey = () => toB64(crypto.getRandomValues(new Uint8Array(32)));

// The account and banner are bound into the ciphertext, so a note can't be moved elsewhere.
const aad = (account, bannerId) => new TextEncoder().encode(`openbanners-note|${account}|${bannerId}`);
const importKey = (rawKey) => crypto.subtle.importKey("raw", fromB64(rawKey), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function encryptNote(rawKey, account, bannerId, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(account, bannerId) },
    await importKey(rawKey),
    new TextEncoder().encode(text)
  );
  return { iv: toB64(iv), data: toB64(data) };
}

export async function decryptNote(rawKey, account, bannerId, note) {
  const text = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(note.iv), additionalData: aad(account, bannerId) },
    await importKey(rawKey),
    fromB64(note.data)
  );
  return new TextDecoder().decode(text);
}

async function call(path, { method = "GET", body } = {}) {
  const token = await requestBannergressAccessToken();
  const response = await fetch(`${PASSPHRASES_BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw Object.assign(new Error(result?.message || "Couldn't reach OpenBanners."), { code: result?.error, status: response.status });
  }
  return { result, account: accountOf(token) };
}

// A key arriving through a link waits here until the app knows who is logged in.
export function captureNotesKeyFromUrl() {
  if (typeof window === "undefined" || !window.location.hash.startsWith(LINK_PREFIX)) {
    return;
  }
  const rawKey = window.location.hash.slice(LINK_PREFIX.length);
  if (/^[A-Za-z0-9_-]{43}$/.test(rawKey)) {
    window.sessionStorage.setItem(PENDING_KEY_STORAGE_KEY, rawKey);
  }
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}

// Uses a key from a link when it fits the account's notes (or the account has none yet).
async function adoptPendingKey(account, serverKeyId) {
  const rawKey = window.sessionStorage.getItem(PENDING_KEY_STORAGE_KEY);
  if (!rawKey) {
    return;
  }
  if (!serverKeyId || (await keyIdOf(rawKey)) === serverKeyId) {
    storeKey(account, rawKey);
    window.sessionStorage.removeItem(PENDING_KEY_STORAGE_KEY);
  }
}

export const notesLinkFor = (rawKey) => `${window.location.origin}/${LINK_PREFIX}${rawKey}`;

function useLoggedIn() {
  const auth = useBannergressAuth();
  return Boolean(auth?.accessToken || auth?.refreshToken);
}

function useKeysVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(KEYS_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(KEYS_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return version;
}

// { status: "idle" | "loading" | "ready" | "locked" | "error", text, updatedAt, error, save }
// "locked": the account has notes under a key this device doesn't have.
export function useBannerNote(bannerId) {
  const loggedIn = useLoggedIn();
  const keysVersion = useKeysVersion();
  const [state, setState] = useState({ status: "idle", text: "", updatedAt: null, error: "" });

  useEffect(() => {
    if (!loggedIn || !bannerId) {
      setState({ status: "idle", text: "", updatedAt: null, error: "" });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: current.status === "ready" ? "ready" : "loading" }));
    (async () => {
      const { result, account } = await call(`/notes/banners/${encodeURIComponent(bannerId)}`);
      await adoptPendingKey(account, result.keyId);
      const rawKey = localKeyFor(account);
      if (result.keyId && (!rawKey || (await keyIdOf(rawKey)) !== result.keyId)) {
        return { status: "locked", text: "", updatedAt: null, error: "" };
      }
      const text = result.note ? await decryptNote(rawKey, account, bannerId, result.note) : "";
      return { status: "ready", text, updatedAt: result.note?.updatedAt ?? null, error: "" };
    })().then(
      (next) => !cancelled && setState(next),
      (error) => !cancelled && setState({ status: "error", text: "", updatedAt: null, error: error.message })
    );
    return () => {
      cancelled = true;
    };
  }, [bannerId, loggedIn, keysVersion]);

  const save = useCallback(
    async (text) => {
      const trimmed = text.trim() ? text : "";
      const token = await requestBannergressAccessToken();
      const account = accountOf(token);
      let rawKey = localKeyFor(account);
      if (!rawKey) {
        rawKey = newRawKey();
        storeKey(account, rawKey);
      }
      const body = trimmed
        ? { keyId: await keyIdOf(rawKey), ...(await encryptNote(rawKey, account, bannerId, trimmed)) }
        : { keyId: await keyIdOf(rawKey), data: null };
      const { result } = await call(`/notes/banners/${encodeURIComponent(bannerId)}`, { method: "POST", body });
      setState({ status: "ready", text: trimmed, updatedAt: result.note?.updatedAt ?? null, error: "" });
    },
    [bannerId]
  );

  return { ...state, loggedIn, save };
}

// For Settings: { status, count, hasKey, locked, rawKey, reset }
export function useNotesAccount(enabled = true) {
  const loggedIn = useLoggedIn();
  const keysVersion = useKeysVersion();
  const [state, setState] = useState({ status: "idle", count: 0, hasKey: false, locked: false, rawKey: null, error: "" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!loggedIn || !enabled) {
      setState({ status: "idle", count: 0, hasKey: false, locked: false, rawKey: null, error: "" });
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { result, account } = await call("/notes");
      await adoptPendingKey(account, result.keyId);
      const rawKey = localKeyFor(account);
      const matches = Boolean(rawKey) && (!result.keyId || (await keyIdOf(rawKey)) === result.keyId);
      return { status: "ready", count: result.count, hasKey: matches, locked: Boolean(result.keyId) && !matches, rawKey: matches ? rawKey : null, error: "" };
    })().then(
      (next) => !cancelled && setState(next),
      (error) => !cancelled && setState((current) => ({ ...current, status: "error", error: error.message }))
    );
    return () => {
      cancelled = true;
    };
  }, [loggedIn, enabled, keysVersion, reload]);

  const reset = useCallback(async () => {
    const { account } = await call("/notes/reset", { method: "POST", body: { confirm: true } });
    storeKey(account, newRawKey());
    setReload((n) => n + 1);
  }, []);

  return { ...state, loggedIn, reset };
}
