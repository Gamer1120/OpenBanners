import { useSyncExternalStore } from "react";
import { BANNERGRESS_AUTH_CHANGE_EVENT, BANNERGRESS_AUTH_STORAGE_KEY, isSignedInToBannergress } from "./bannergressSync";
import { clearCachedCity, readCachedCity, savePickedCity } from "./cityPlace";
import { LANGUAGE_STORAGE_KEY, getLanguageChoice, setLanguageChoice } from "./i18n";
import { MAP_FILTERS_STORAGE_KEY, MAP_ROW_FOLDED_STORAGE_KEY, normalizeMapFilters } from "./components/discoveryMap/mapFilters";
import { call } from "./passphraseApi";
import { SETTING_CHANGED_EVENT, SYNCED_SETTINGS_APPLIED_EVENT } from "./settingsSyncState";

// Settings that follow a signed-in Bannergress account between devices
// (server: server/synced-settings.mjs, GET/PUT/DELETE /preferences).
// - Signed out nothing is sent; this device only remembers which values it
//   has seen and when you changed one (SYNC_META_STORAGE_KEY).
// - Signed in: on load, sign-in, returning to the tab and 2 s after a change,
//   the browser fetches the account's settings and merges them per setting:
//   the last change wins. A value this device never changed explicitly (e.g.
//   from before syncing existed) is older than anything on the server, so a
//   new device takes the account's settings; the recent-plans lists of two
//   devices that both changed are joined.
// - Removing (Settings) deletes them on the server and turns syncing off for
//   the account until it's turned on again.
// Never synced: the sign-in, caches, map position, scroll state, rerouter
// data, recent searches, Banner Together keys.

export const SYNC_META_STORAGE_KEY = "openbanners:settings-sync";
const PREFERENCES_PATH = "/preferences";
const PUSH_DELAY_MS = 2000;
const RESYNC_AFTER_MS = 60 * 1000;
const MAX_RECENT_PLANS = 20;
const MAX_PLAN_TITLE = 120;

// Owned by other modules (keys checked in settingsSync.test.js); these are
// not imported so the sync code doesn't pull the planner or the intro into
// the first page load.
export const VIEW_MODE_STORAGE_KEY = "openbanners-banner-view-mode";
export const INTRO_DISMISSED_STORAGE_KEY = "openbanners:intro-dismissed";
export const RECENT_PLANS_STORAGE_KEY = "openbanners-recent-plans";

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function getRaw(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function setRaw(key, value) {
  try {
    if (value === null) {
      storage()?.removeItem(key);
    } else {
      storage()?.setItem(key, value);
    }
  } catch {
    // Private mode / storage full: the value applies to this visit only.
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const finiteInt = (value) => (Number.isInteger(value) && value >= 0 ? value : undefined);
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);

export function sanitizePlace(place) {
  if (!place || typeof place !== "object" || typeof place.id !== "string" || !place.id || place.id.length > 200) {
    return null;
  }
  const out = { id: place.id };
  for (const key of ["longName", "shortName", "formattedAddress", "type"]) {
    if (typeof place[key] === "string") {
      out[key] = place[key].slice(0, 300);
    }
  }
  if (finiteInt(place.numberOfBanners) !== undefined) {
    out.numberOfBanners = place.numberOfBanners;
  }
  return out;
}

export function sanitizeRecentPlans(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .filter((entry) => entry && typeof entry.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(entry.id))
    .slice(0, MAX_RECENT_PLANS)
    .map((entry) => {
      const out = { id: entry.id };
      const title = text(entry.title, MAX_PLAN_TITLE);
      if (title !== undefined) {
        out.title = title;
      }
      if (finiteInt(entry.missions) !== undefined) {
        out.missions = entry.missions;
      }
      if (typeof entry.readOnly === "boolean") {
        out.readOnly = entry.readOnly;
      }
      if (Number.isFinite(entry.openedAt) && entry.openedAt >= 0) {
        out.openedAt = entry.openedAt;
      }
      return out;
    });
}

// Each setting as a plain value (null = not set on this device).
export const SETTING_ADAPTERS = {
  language: {
    read: () => {
      const value = getRaw(LANGUAGE_STORAGE_KEY);
      return value && /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/.test(value) ? value : null;
    },
    write: (value) => {
      if ((value ?? "auto") !== getLanguageChoice()) {
        void setLanguageChoice(value ?? "auto");
      }
    },
  },
  mapFilters: {
    read: () => {
      const raw = getRaw(MAP_FILTERS_STORAGE_KEY);
      return raw === null ? null : normalizeMapFilters(parseJson(raw));
    },
    write: (value) => setRaw(MAP_FILTERS_STORAGE_KEY, value === null ? null : JSON.stringify(normalizeMapFilters(value))),
  },
  mapRowFolded: {
    read: () => {
      const raw = getRaw(MAP_ROW_FOLDED_STORAGE_KEY);
      return raw === null ? null : raw === "1";
    },
    write: (value) => setRaw(MAP_ROW_FOLDED_STORAGE_KEY, value === null ? null : value ? "1" : "0"),
  },
  viewMode: {
    read: () => {
      const raw = getRaw(VIEW_MODE_STORAGE_KEY);
      return raw === null ? null : raw === "compact" ? "compact" : "visual";
    },
    write: (value) => setRaw(VIEW_MODE_STORAGE_KEY, value),
  },
  // Only a city you picked (or browsed to). The automatic one comes with your
  // rough location, which never leaves the browser.
  city: {
    read: () => {
      const cached = readCachedCity();
      return cached?.picked ? sanitizePlace(cached.place) : null;
    },
    write: (value) => {
      if (value) {
        savePickedCity(value);
      } else if (readCachedCity()?.picked) {
        clearCachedCity();
      }
    },
  },
  introDismissed: {
    read: () => (getRaw(INTRO_DISMISSED_STORAGE_KEY) ? true : null),
    write: (value) => {
      if (value) {
        setRaw(INTRO_DISMISSED_STORAGE_KEY, "1");
      }
    },
  },
  recentPlans: {
    read: () => {
      const raw = getRaw(RECENT_PLANS_STORAGE_KEY);
      return raw === null ? null : sanitizeRecentPlans(parseJson(raw));
    },
    write: (value) => setRaw(RECENT_PLANS_STORAGE_KEY, value === null ? null : JSON.stringify(sanitizeRecentPlans(value))),
  },
};

export const SYNCED_SETTING_NAMES = Object.freeze(Object.keys(SETTING_ADAPTERS));

const json = (value) => JSON.stringify(value ?? null);
export const sameValue = (a, b) => json(a) === json(b);

// Both devices' recent plans, newest first.
export function joinRecentPlans(a, b) {
  const byId = new Map();
  for (const entry of [...sanitizeRecentPlans(a), ...sanitizeRecentPlans(b)]) {
    const other = byId.get(entry.id);
    if (!other || (entry.openedAt ?? 0) > (other.openedAt ?? 0)) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((x, y) => (y.openedAt ?? 0) - (x.openedAt ?? 0)).slice(0, MAX_RECENT_PLANS);
}

export function emptyMeta() {
  return { account: null, off: false, offset: 0, known: {}, changed: {}, synced: {}, lastSync: 0 };
}

export function readSyncMeta() {
  const value = parseJson(getRaw(SYNC_META_STORAGE_KEY));
  if (!value || typeof value !== "object") {
    return emptyMeta();
  }
  const object = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  return {
    ...emptyMeta(),
    account: typeof value.account === "string" ? value.account : null,
    off: value.off === true,
    offset: Number.isFinite(value.offset) ? value.offset : 0,
    known: object(value.known),
    changed: object(value.changed),
    synced: object(value.synced),
    lastSync: Number.isFinite(value.lastSync) ? value.lastSync : 0,
  };
}

function writeSyncMeta(meta) {
  setRaw(SYNC_META_STORAGE_KEY, JSON.stringify(meta));
}

// Records a value this device now has. Returns true for an explicit change
// (made by you, with its time); other differences (first look, a value
// written without noteSettingChanged) keep their old time.
export function trackLocalValue(meta, name, value, { explicit = false, at = 0 } = {}) {
  const serialized = json(value);
  if (meta.known[name] === serialized) {
    return false;
  }
  meta.known[name] = serialized;
  if (explicit) {
    meta.changed[name] = at;
  }
  return explicit;
}

// The merge, per setting. local: { name: value|null }; server: { name: { value, changedAt } }.
// meta.changed[name]: when this device last changed it (0 = never explicitly);
// meta.synced[name]: the change time both sides agreed on at the last sync
// (missing = never synced with this account).
// Returns the values to write here (apply), to send (push), and the new times.
export function mergeSettings({ local, meta, server, now }) {
  const apply = {};
  const push = {};
  const changed = { ...meta.changed };
  const synced = { ...meta.synced };
  const take = (name, entry) => {
    apply[name] = entry.value;
    changed[name] = entry.changedAt;
    synced[name] = entry.changedAt;
  };

  for (const name of SYNCED_SETTING_NAMES) {
    const value = local[name] ?? null;
    const localAt = Number(changed[name]) || 0;
    const base = synced[name];
    const firstSync = base === undefined;
    const dirty = firstSync ? value !== null : localAt > base;
    const entry = server[name];

    if (!entry) {
      if (dirty) {
        push[name] = { value, changedAt: localAt };
      }
      continue;
    }
    if (sameValue(value, entry.value)) {
      synced[name] = Math.max(entry.changedAt, localAt);
      continue;
    }
    const serverMoved = firstSync || entry.changedAt > base;
    if (!dirty) {
      take(name, entry);
    } else if (!serverMoved) {
      push[name] = { value, changedAt: localAt };
    } else if (name === "recentPlans") {
      const joined = joinRecentPlans(value, entry.value);
      if (!sameValue(joined, value)) {
        apply[name] = joined;
      }
      if (sameValue(joined, entry.value)) {
        changed[name] = entry.changedAt;
        synced[name] = entry.changedAt;
      } else {
        const at = Math.max(now, entry.changedAt);
        changed[name] = at;
        push[name] = { value: joined, changedAt: at };
      }
    } else if (entry.changedAt >= localAt) {
      take(name, entry);
    } else {
      push[name] = { value, changedAt: localAt };
    }
  }
  return { apply, push, changed, synced };
}

// After a PUT: what the server kept for each sent setting.
export function settlePush({ push, response, meta }) {
  const apply = {};
  const changed = { ...meta.changed };
  const synced = { ...meta.synced };
  for (const [name, sent] of Object.entries(push)) {
    const kept = response?.[name];
    if (!kept) {
      continue;
    }
    if (sameValue(kept.value, sent.value)) {
      // The server caps times at its own clock; don't send it again for that.
      synced[name] = Math.max(kept.changedAt, sent.changedAt);
    } else {
      apply[name] = kept.value;
      changed[name] = kept.changedAt;
      synced[name] = kept.changedAt;
    }
  }
  return { apply, changed, synced };
}

// ---- Runtime ----

let state = { status: "idle", error: "" };
const listeners = new Set();
let started = false;
let applying = false;
let timer = null;
let running = null;
let runAgain = false;
let wasSignedIn = false;

function setState(next) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function readLocal() {
  const values = {};
  for (const name of SYNCED_SETTING_NAMES) {
    try {
      values[name] = SETTING_ADAPTERS[name].read();
    } catch {
      values[name] = null;
    }
  }
  return values;
}

function scan(meta) {
  const values = readLocal();
  for (const name of SYNCED_SETTING_NAMES) {
    trackLocalValue(meta, name, values[name]);
  }
}

function applyValues(values, meta) {
  const names = Object.keys(values);
  if (!names.length) {
    return;
  }
  applying = true;
  try {
    for (const name of names) {
      meta.known[name] = json(values[name]);
      try {
        SETTING_ADAPTERS[name].write(values[name]);
      } catch {
        // One setting failing to save must not stop the others.
      }
    }
  } finally {
    applying = false;
  }
  window.dispatchEvent(new CustomEvent(SYNCED_SETTINGS_APPLIED_EVENT, { detail: { names } }));
}

async function runSync({ enable = false } = {}) {
  if (!isSignedInToBannergress()) {
    setState({ status: readSyncMeta().off ? "off" : "idle", error: "" });
    return;
  }
  const meta = readSyncMeta();
  scan(meta);
  setState({ status: "syncing", error: "" });
  try {
    const sentAt = Date.now();
    const server = await call(PREFERENCES_PATH);
    if (Number.isFinite(server?.now)) {
      meta.offset = Math.round(server.now - (sentAt + Date.now()) / 2);
    }
    if (server.account !== meta.account || enable) {
      // Another account, or turning syncing back on: start over (first sync).
      meta.account = server.account;
      meta.synced = {};
    }
    if (!server.enabled && !enable) {
      meta.off = true;
      writeSyncMeta(meta);
      setState({ status: "off", error: "" });
      return;
    }
    meta.off = false;
    const now = Date.now() + meta.offset;
    const merged = mergeSettings({ local: readLocal(), meta, server: server.enabled ? server.settings ?? {} : {}, now });
    meta.changed = merged.changed;
    meta.synced = merged.synced;
    applyValues(merged.apply, meta);
    writeSyncMeta(meta);
    if (Object.keys(merged.push).length || (enable && !server.enabled)) {
      const response = await call(PREFERENCES_PATH, {
        method: "PUT",
        body: enable ? { enable: true, settings: merged.push } : { settings: merged.push },
      });
      const settled = settlePush({ push: merged.push, response: response?.settings, meta });
      meta.changed = settled.changed;
      meta.synced = settled.synced;
      applyValues(settled.apply, meta);
    }
    meta.lastSync = Date.now();
    writeSyncMeta(meta);
    setState({ status: "ready", error: "" });
  } catch (error) {
    writeSyncMeta(meta);
    if (error?.code === "sync_off") {
      meta.off = true;
      writeSyncMeta(meta);
      setState({ status: "off", error: "" });
      return;
    }
    // Offline, Bannergress or the server down: try again later, the page goes on.
    setState({ status: "error", error: error?.message || "" });
  }
}

export function syncSettingsNow(options) {
  if (running) {
    runAgain = true;
    return running;
  }
  running = runSync(options).finally(() => {
    running = null;
    if (runAgain) {
      runAgain = false;
      scheduleSync(PUSH_DELAY_MS);
    }
  });
  return running;
}

function scheduleSync(delay) {
  if (!isSignedInToBannergress()) {
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncSettingsNow();
  }, delay);
}

function handleSettingChanged(event) {
  const name = event?.detail?.name;
  if (applying || !Object.hasOwn(SETTING_ADAPTERS, name)) {
    return;
  }
  const meta = readSyncMeta();
  let value = null;
  try {
    value = SETTING_ADAPTERS[name].read();
  } catch {
    return;
  }
  const changed = trackLocalValue(meta, name, value, { explicit: true, at: Date.now() + meta.offset });
  writeSyncMeta(meta);
  if (changed && !meta.off) {
    scheduleSync(PUSH_DELAY_MS);
  }
}

function handleAuthChange() {
  const signedIn = isSignedInToBannergress();
  if (signedIn && !wasSignedIn) {
    scheduleSync(0);
  }
  if (!signedIn) {
    clearTimeout(timer);
    setState({ status: "idle", error: "" });
  }
  wasSignedIn = signedIn;
}

// index.jsx starts this once.
export function startSettingsSync() {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;
  try {
    const meta = readSyncMeta();
    scan(meta);
    writeSyncMeta(meta);
    if (meta.off) {
      setState({ status: "off" });
    }
  } catch {
    // Storage unavailable: nothing to sync.
  }
  window.addEventListener(SETTING_CHANGED_EVENT, handleSettingChanged);
  window.addEventListener(BANNERGRESS_AUTH_CHANGE_EVENT, handleAuthChange);
  window.addEventListener("storage", (event) => {
    if (event.key === BANNERGRESS_AUTH_STORAGE_KEY || event.key === null) {
      handleAuthChange();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!isSignedInToBannergress()) {
      return;
    }
    if (document.visibilityState === "hidden" && timer) {
      // Leaving the page: send a waiting change now.
      clearTimeout(timer);
      timer = null;
      void syncSettingsNow();
    } else if (document.visibilityState === "visible" && Date.now() - readSyncMeta().lastSync > RESYNC_AFTER_MS) {
      scheduleSync(0);
    }
  });
  wasSignedIn = isSignedInToBannergress();
  if (wasSignedIn) {
    scheduleSync(1000);
  }
}

// Settings → "Remove my synced settings".
export async function removeSyncedSettings() {
  clearTimeout(timer);
  timer = null;
  await running;
  const response = await call(PREFERENCES_PATH, { method: "DELETE" });
  const meta = readSyncMeta();
  meta.account = response?.account ?? meta.account;
  meta.off = true;
  meta.synced = {};
  writeSyncMeta(meta);
  setState({ status: "off", error: "" });
}

export async function turnOnSettingsSync() {
  await running;
  await syncSettingsNow({ enable: true });
  if (state.status === "error") {
    throw new Error(state.error);
  }
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// { status: "idle" | "syncing" | "ready" | "off" | "error", error }
export function useSettingsSync() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
