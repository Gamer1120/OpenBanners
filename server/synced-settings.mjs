// Settings that follow a signed-in Bannergress account between devices
// (client: src/settingsSync.js). Part of the passphrase service: same login
// check (the account is the verified Bannergress token's subject, never an id
// the browser sends), same SQLite file.
// - Only the keys in VALIDATORS are accepted, each with a strict shape, and an
//   account's settings are at most MAX_SETTINGS_BYTES of JSON.
// - Each key keeps the value with the newest changedAt (last change wins);
//   changedAt is the browser's time corrected to the server clock, never later
//   than the server's own now.
// - DELETE removes them and turns syncing off for the account (only that off
//   switch stays) until the account turns it on again with `enable: true`.
import { createHash } from "node:crypto";

export const SYNCED_SETTINGS_SCHEMA = `
-- Settings that follow a signed-in account between devices (server/synced-settings.mjs).
CREATE TABLE IF NOT EXISTS synced_settings (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
`;

export const MAX_SETTINGS_BYTES = 16 * 1024;
// Writes per account per window (the browser sends at most one every few seconds).
export const MAX_WRITES_PER_WINDOW = 60;
export const WRITE_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECENT_PLANS = 20;

export class SyncedSettingsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (key) => new SyncedSettingsError(400, "invalid_settings", `Invalid value for ${key}.`);
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const shortString = (value, max) => typeof value === "string" && value.length <= max;

function onlyKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

const OPTION_ID = /^[A-Za-z0-9+]{1,16}$/;
const distance = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000);

// null = "not set" for every key.
const VALIDATORS = {
  language: (value) => typeof value === "string" && /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/.test(value),
  mapFilters: (value) =>
    onlyKeys(value, ["missions", "status", "distance", "distMin", "distMax"]) &&
    ["missions", "status", "distance"].every((key) => value[key] === undefined || (typeof value[key] === "string" && OPTION_ID.test(value[key]))) &&
    ["distMin", "distMax"].every((key) => value[key] === undefined || distance(value[key])),
  mapRowFolded: (value) => typeof value === "boolean",
  viewMode: (value) => value === "visual" || value === "compact",
  city: (value) =>
    onlyKeys(value, ["id", "longName", "shortName", "formattedAddress", "numberOfBanners", "type"]) &&
    shortString(value.id, 200) &&
    value.id.length > 0 &&
    ["longName", "shortName", "formattedAddress", "type"].every((key) => value[key] == null || shortString(value[key], 300)) &&
    (value.numberOfBanners == null || (Number.isInteger(value.numberOfBanners) && value.numberOfBanners >= 0)),
  introDismissed: (value) => value === true,
  recentPlans: (value) =>
    Array.isArray(value) &&
    value.length <= MAX_RECENT_PLANS &&
    value.every(
      (entry) =>
        onlyKeys(entry, ["id", "title", "missions", "readOnly", "openedAt"]) &&
        typeof entry.id === "string" &&
        /^[A-Za-z0-9_-]{8,64}$/.test(entry.id) &&
        (entry.title == null || shortString(entry.title, 300)) &&
        (entry.missions === undefined || (Number.isInteger(entry.missions) && entry.missions >= 0 && entry.missions <= 100000)) &&
        (entry.readOnly === undefined || typeof entry.readOnly === "boolean") &&
        (entry.openedAt === undefined || (Number.isFinite(entry.openedAt) && entry.openedAt >= 0))
    ),
};

export const SYNCED_SETTING_KEYS = Object.freeze(Object.keys(VALIDATORS));

export function validateSetting(key, value) {
  if (!Object.hasOwn(VALIDATORS, key)) {
    throw new SyncedSettingsError(400, "unknown_setting", `Unknown setting ${String(key).slice(0, 40)}.`);
  }
  if (value !== null && !VALIDATORS[key](value)) {
    throw invalid(key);
  }
}

export function createSyncedSettings({ db, now = () => Date.now() }) {
  db.exec(SYNCED_SETTINGS_SCHEMA);
  const writes = new Map();

  const account = (userId) => createHash("sha256").update(`openbanners-settings:${userId}`).digest("hex").slice(0, 16);

  function load(userId) {
    const row = db.prepare("SELECT data, enabled FROM synced_settings WHERE user_id = ?").get(userId);
    let data = {};
    try {
      data = row ? JSON.parse(row.data) : {};
    } catch {
      data = {};
    }
    return { enabled: row ? Boolean(row.enabled) : true, data: isPlainObject(data) ? data : {} };
  }

  function out(userId) {
    const { enabled, data } = load(userId);
    return { account: account(userId), enabled, now: now(), settings: enabled ? data : {} };
  }

  function countWrite(userId) {
    const at = now();
    const recent = (writes.get(userId) ?? []).filter((time) => at - time < WRITE_WINDOW_MS);
    if (recent.length >= MAX_WRITES_PER_WINDOW) {
      throw new SyncedSettingsError(429, "too_many_requests", "Too many changes. Try again in a few minutes.");
    }
    recent.push(at);
    writes.set(userId, recent);
    if (writes.size > 5000) {
      writes.delete(writes.keys().next().value);
    }
  }

  function put(identity, body) {
    if (!isPlainObject(body) || !onlyKeys(body, ["settings", "enable"]) || (body.enable !== undefined && body.enable !== true)) {
      throw new SyncedSettingsError(400, "invalid_settings", "Send { settings: { key: { value, changedAt } } }.");
    }
    const incoming = body.settings ?? {};
    if (!isPlainObject(incoming)) {
      throw new SyncedSettingsError(400, "invalid_settings", "Send { settings: { key: { value, changedAt } } }.");
    }
    for (const [key, entry] of Object.entries(incoming)) {
      validateSetting(key, null);
      if (!onlyKeys(entry, ["value", "changedAt"]) || !Object.hasOwn(entry, "value") || !Number.isFinite(entry.changedAt) || entry.changedAt < 0) {
        throw invalid(key);
      }
      validateSetting(key, entry.value);
    }
    const { userId } = identity;
    const current = load(userId);
    if (!current.enabled && !body.enable) {
      throw new SyncedSettingsError(409, "sync_off", "Settings sync is off for this account.");
    }
    countWrite(userId);
    const at = now();
    const data = current.enabled ? { ...current.data } : {};
    for (const [key, entry] of Object.entries(incoming)) {
      const changedAt = Math.min(entry.changedAt, at);
      if (!data[key] || !(data[key].changedAt > changedAt)) {
        data[key] = { value: entry.value, changedAt };
      }
    }
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > MAX_SETTINGS_BYTES) {
      throw new SyncedSettingsError(413, "too_large", "These settings are too large.");
    }
    db.prepare(`INSERT INTO synced_settings (user_id, data, enabled, updated_at) VALUES (?, ?, 1, ?)
      ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, enabled = 1, updated_at = excluded.updated_at`).run(userId, json, at);
    return out(userId);
  }

  // Deletes the settings; only "sync is off" stays, so other signed-in
  // devices don't upload them again.
  function remove(identity) {
    db.prepare(`INSERT INTO synced_settings (user_id, data, enabled, updated_at) VALUES (?, '{}', 0, ?)
      ON CONFLICT (user_id) DO UPDATE SET data = '{}', enabled = 0, updated_at = excluded.updated_at`).run(identity.userId, now());
    return out(identity.userId);
  }

  return {
    get: (identity) => out(identity.userId),
    put,
    remove,
  };
}
