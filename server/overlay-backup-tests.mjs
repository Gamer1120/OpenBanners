import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { LINK_CODE_TTL_MS, MAX_BACKUP_BYTES, OVERLAY_TOKEN_TTL_MS, validateBackup } from "./overlay-backup.mjs";

const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const challengeOf = (verifier) => createHash("sha256").update(verifier).digest("base64url");
const VERIFIER = "v".repeat(20) + "erifier-0123456789_abcdefgh";

function setup() {
  let clock = Date.UTC(2026, 9, 31, 12);
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const sub = headers.Authorization ? JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url")).sub : null;
    if (url.endsWith("/user")) {
      return sub && sub !== "expired" ? { ok: true, status: 200, json: async () => ({ agent: { name: sub } }) } : { ok: false, status: 401 };
    }
    return { ok: false, status: 404 };
  };
  const service = createPassphraseService({ db: openDatabase(":memory:"), fetchImpl, now: () => clock, i18nSource: { singular: [], plural: [], locales: {} } });
  const as = (sub) => ({ authorization: `Bearer ${token(sub)}` });
  const overlay = (value) => ({ authorization: `Overlay ${value}` });
  // The whole app flow: site makes a code, app trades it for a token.
  async function connect(sub, verifier = VERIFIER) {
    const { code } = await service.handle("POST", "/overlay/link", as(sub), { challenge: challengeOf(verifier) });
    const { token: value } = await service.handle("POST", "/overlay/token", {}, { code, verifier });
    return value;
  }
  return { service, as, overlay, connect, advance: (ms) => (clock += ms) };
}

const backup = { format: 1, appVersion: 51, settings: { route_orientation: "north", route_strip_enable: true, card_size: "1.25", tags: ["a", "b"], step: 15 } };

test("the app gets in with code + verifier, once, and only for its backup", async () => {
  const { service, as, overlay, connect } = setup();
  const value = await connect("alice");
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await service.handle("GET", "/overlay/backup", overlay(value), null), { backup: null });
  const saved = await service.handle("PUT", "/overlay/backup", overlay(value), backup);
  assert.equal(saved.backup.appVersion, 51);
  assert.deepEqual(saved.backup.settings, backup.settings);
  assert.match(saved.backup.createdAt, /^2026-10-31T12:00:00/);
  // The site sees the same backup with the Bannergress login; others don't.
  assert.deepEqual((await service.handle("GET", "/overlay/backup", as("alice"), null)).backup.settings, backup.settings);
  assert.equal((await service.handle("GET", "/overlay/backup", as("bob"), null)).backup, null);
  // The overlay token opens nothing else.
  await assert.rejects(service.handle("GET", "/preferences", overlay(value), null), { status: 401 });
  await assert.rejects(service.handle("GET", "/export", overlay(value), null), { status: 401 });
  await assert.rejects(service.handle("GET", "/notes/banners/abc", overlay(value), null), { status: 401 });
});

test("codes are single use, bound to the verifier and expire", async () => {
  const { service, as, advance } = setup();
  const { code } = await service.handle("POST", "/overlay/link", as("alice"), { challenge: challengeOf(VERIFIER) });
  // Wrong verifier burns the code.
  await assert.rejects(service.handle("POST", "/overlay/token", {}, { code, verifier: VERIFIER.replace("v", "w") }), { status: 400, code: "invalid_code" });
  await assert.rejects(service.handle("POST", "/overlay/token", {}, { code, verifier: VERIFIER }), { status: 400 });
  const second = await service.handle("POST", "/overlay/link", as("alice"), { challenge: challengeOf(VERIFIER) });
  await service.handle("POST", "/overlay/token", {}, { code: second.code, verifier: VERIFIER });
  await assert.rejects(service.handle("POST", "/overlay/token", {}, { code: second.code, verifier: VERIFIER }), { status: 400 });
  const late = await service.handle("POST", "/overlay/link", as("alice"), { challenge: challengeOf(VERIFIER) });
  advance(LINK_CODE_TTL_MS + 1);
  await assert.rejects(service.handle("POST", "/overlay/token", {}, { code: late.code, verifier: VERIFIER }), { status: 400 });
  // Making a code needs a real login and a proper challenge.
  await assert.rejects(service.handle("POST", "/overlay/link", {}, { challenge: challengeOf(VERIFIER) }), { status: 401 });
  await assert.rejects(service.handle("POST", "/overlay/link", as("alice"), { challenge: "short" }), { status: 400 });
});

test("overlay tokens expire", async () => {
  const { service, overlay, connect, advance } = setup();
  const value = await connect("alice");
  advance(OVERLAY_TOKEN_TTL_MS + 1);
  await assert.rejects(service.handle("GET", "/overlay/backup", overlay(value), null), { status: 401, code: "login_required" });
  await assert.rejects(service.handle("GET", "/overlay/backup", overlay("A".repeat(43)), null), { status: 401 });
});

test("backups are validated and size-limited, newer keys pass through", () => {
  assert.deepEqual(validateBackup(backup).settings, backup.settings);
  assert.deepEqual(validateBackup({ appVersion: 99, settings: { some_future_key: "x" } }).settings, { some_future_key: "x" });
  for (const bad of [
    null,
    [],
    { appVersion: 51 },
    { appVersion: 0, settings: {} },
    { appVersion: 51, settings: [] },
    { appVersion: 51, settings: {}, token: "secret" },
    { format: 2, appVersion: 51, settings: {} },
    { appVersion: 51, settings: { "bad key": true } },
    { appVersion: 51, settings: { nested: { a: 1 } } },
    { appVersion: 51, settings: { n: Number.NaN } },
    { appVersion: 51, settings: { s: "x".repeat(2001) } },
  ]) {
    assert.throws(() => validateBackup(bad), { status: 400 }, JSON.stringify(bad));
  }
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key${i}`, "x".repeat(1500)]));
  assert.ok(JSON.stringify(many).length > MAX_BACKUP_BYTES);
  assert.throws(() => validateBackup({ appVersion: 51, settings: many }), { status: 413 });
});

test("the site can delete the backup", async () => {
  const { service, as, overlay, connect } = setup();
  const value = await connect("alice");
  await service.handle("PUT", "/overlay/backup", overlay(value), backup);
  assert.deepEqual(await service.handle("DELETE", "/overlay/backup", as("alice"), null), { backup: null });
  assert.equal((await service.handle("GET", "/overlay/backup", overlay(value), null)).backup, null);
});
