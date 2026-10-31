// One settings backup per signed-in account for the OpenBanners Overlay
// Android app (org.openbanners.overlay). Part of the passphrase service: same
// SQLite file, and the account is always the verified Bannergress token's
// subject from passphrases.mjs, never an id a client sends.
//
// How the app gets in, without a Bannergress token ever leaving the browser:
// 1. The app makes a random verifier, keeps it, and opens
//    https://openbanners.org/overlay/connect?action=backup|restore&challenge=<S256(verifier)>&state=<random>
// 2. The signed-in site (Bannergress login) asks POST /overlay/link { challenge }
//    and gets a one-time code (LINK_CODE_TTL_MS), which it hands to the app in
//    openbanners-overlay://link?code=…&state=… (the app checks its state).
// 3. The app trades code + verifier for an overlay token: POST /overlay/token.
//    A code works once (a wrong verifier burns it too). The token is good for
//    OVERLAY_TOKEN_TTL_MS and only for GET/PUT/DELETE /overlay/backup.
// Codes and tokens live only in memory, as sha256 hashes, so a restart just
// means "try again". The site itself manages the backup with the normal
// Bannergress login (Settings: last backup date, delete).
import { createHash, randomBytes } from "node:crypto";

export const OVERLAY_BACKUP_SCHEMA = `
-- Overlay app settings backup, one per account (server/overlay-backup.mjs).
CREATE TABLE IF NOT EXISTS overlay_backups (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  app_version INTEGER,
  created_at INTEGER NOT NULL
);
`;

export const MAX_BACKUP_BYTES = 32 * 1024;
export const MAX_BACKUP_SETTINGS = 200;
export const LINK_CODE_TTL_MS = 5 * 60 * 1000;
export const OVERLAY_TOKEN_TTL_MS = 15 * 60 * 1000;
// Per account: backups written and link codes made per hour.
export const MAX_BACKUP_WRITES_PER_HOUR = 30;
export const MAX_LINK_CODES_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const MAX_IN_MEMORY = 20000;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE = /^[A-Za-z0-9_-]{32,64}$/;
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export class OverlayBackupError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const base64urlSha256 = (value) => createHash("sha256").update(value).digest("base64url");

// A setting value the app can store in SharedPreferences: a boolean, a number,
// a short string or a short list of short strings (a string set).
function validValue(value) {
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return value.length <= 2000;
  }
  return Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === "string" && item.length <= 200);
}

// Checks a PUT body and returns what is stored. Throws a 400/413 otherwise.
export function validateBackup(body) {
  const bad = (message) => new OverlayBackupError(400, "invalid_backup", message);
  if (!isPlainObject(body) || !Object.keys(body).every((key) => ["format", "appVersion", "settings"].includes(key))) {
    throw bad("Send { format, appVersion, settings }.");
  }
  if (body.format !== undefined && body.format !== 1) {
    throw bad("Unknown backup format.");
  }
  if (!Number.isInteger(body.appVersion) || body.appVersion < 1 || body.appVersion > 1_000_000) {
    throw bad("appVersion must be the app's version code.");
  }
  if (!isPlainObject(body.settings)) {
    throw bad("settings must be an object.");
  }
  const keys = Object.keys(body.settings);
  if (keys.length > MAX_BACKUP_SETTINGS) {
    throw bad(`At most ${MAX_BACKUP_SETTINGS} settings.`);
  }
  for (const key of keys) {
    if (!SETTING_KEY.test(key) || !validValue(body.settings[key])) {
      throw bad(`Invalid setting ${key.slice(0, 40)}.`);
    }
  }
  const stored = { format: 1, appVersion: body.appVersion, settings: body.settings };
  if (Buffer.byteLength(JSON.stringify(stored)) > MAX_BACKUP_BYTES) {
    throw new OverlayBackupError(413, "too_large", "This backup is too large.");
  }
  return stored;
}

export function createOverlayBackups({ db, now = () => Date.now() }) {
  db.exec(OVERLAY_BACKUP_SCHEMA);
  const codes = new Map(); // sha256(code) -> { userId, challenge, expires }
  const tokens = new Map(); // sha256(token) -> { userId, expires }
  const events = new Map(); // "kind:userId" -> [times]

  function limit(kind, userId, max, message) {
    const at = now();
    const key = `${kind}:${userId}`;
    const recent = (events.get(key) ?? []).filter((time) => at - time < HOUR_MS);
    if (recent.length >= max) {
      throw new OverlayBackupError(429, "too_many_requests", message);
    }
    recent.push(at);
    events.set(key, recent);
    if (events.size > MAX_IN_MEMORY) {
      events.delete(events.keys().next().value);
    }
  }

  function prune(map) {
    const at = now();
    for (const [key, entry] of map) {
      if (entry.expires <= at) {
        map.delete(key);
      }
    }
    while (map.size >= MAX_IN_MEMORY) {
      map.delete(map.keys().next().value);
    }
  }

  // Signed-in site: a one-time code for the app that asked with this challenge.
  function createLink(identity, body) {
    if (!isPlainObject(body) || typeof body.challenge !== "string" || !CHALLENGE.test(body.challenge)) {
      throw new OverlayBackupError(400, "invalid_challenge", "This link from the Overlay is incomplete. Start again in the app.");
    }
    limit("link", identity.userId, MAX_LINK_CODES_PER_HOUR, "Too many attempts. Try again later.");
    prune(codes);
    const code = randomBytes(24).toString("base64url");
    const expires = now() + LINK_CODE_TTL_MS;
    codes.set(sha256(code), { userId: identity.userId, challenge: body.challenge, expires });
    return { code, expiresAt: new Date(expires).toISOString() };
  }

  // App: code + verifier -> a short-lived token for the backup only.
  function exchange(body) {
    const invalid = () => new OverlayBackupError(400, "invalid_code", "This sign-in has expired or was already used. Try again.");
    if (!isPlainObject(body) || typeof body.code !== "string" || !CODE.test(body.code) || typeof body.verifier !== "string" || !VERIFIER.test(body.verifier)) {
      throw invalid();
    }
    const key = sha256(body.code);
    const entry = codes.get(key);
    codes.delete(key); // single use, also when the verifier is wrong
    if (!entry || entry.expires <= now() || base64urlSha256(body.verifier) !== entry.challenge) {
      throw invalid();
    }
    prune(tokens);
    const token = randomBytes(32).toString("base64url");
    const expires = now() + OVERLAY_TOKEN_TTL_MS;
    tokens.set(sha256(token), { userId: entry.userId, expires });
    return { token, tokenType: "Overlay", expiresAt: new Date(expires).toISOString() };
  }

  // "Overlay <token>" -> { userId }, or null when the header isn't one.
  function identifyOverlay(authorization) {
    const match = /^Overlay ([A-Za-z0-9_-]{32,64})$/.exec(authorization ?? "");
    if (!match) {
      return null;
    }
    const entry = tokens.get(sha256(match[1]));
    if (!entry || entry.expires <= now()) {
      throw new OverlayBackupError(401, "login_required", "The Overlay's sign-in has expired. Try again in the app.");
    }
    return { userId: entry.userId, overlay: true };
  }

  function read(userId) {
    const row = db.prepare("SELECT data, app_version, created_at FROM overlay_backups WHERE user_id = ?").get(userId);
    if (!row) {
      return null;
    }
    let data = {};
    try {
      data = JSON.parse(row.data);
    } catch {
      data = {};
    }
    return {
      format: 1,
      appVersion: row.app_version,
      createdAt: new Date(row.created_at).toISOString(),
      settings: isPlainObject(data.settings) ? data.settings : {},
    };
  }

  function get(identity) {
    return { backup: read(identity.userId) };
  }

  function put(identity, body) {
    const stored = validateBackup(body);
    limit("write", identity.userId, MAX_BACKUP_WRITES_PER_HOUR, "Too many backups. Try again later.");
    const at = now();
    db.prepare(`INSERT INTO overlay_backups (user_id, data, app_version, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, app_version = excluded.app_version, created_at = excluded.created_at`)
      .run(identity.userId, JSON.stringify({ settings: stored.settings }), stored.appVersion, at);
    return get(identity);
  }

  function remove(identity) {
    db.prepare("DELETE FROM overlay_backups WHERE user_id = ?").run(identity.userId);
    return { backup: null };
  }

  return { createLink, exchange, identifyOverlay, get, put, remove, read };
}
