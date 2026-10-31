import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { MAX_WRITES_PER_WINDOW, WRITE_WINDOW_MS } from "./synced-settings.mjs";

const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;

// Bannergress stand-in: any token whose subject isn't "expired" is a valid login.
function setup() {
  let clock = Date.UTC(2026, 9, 31, 12);
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const sub = headers.Authorization ? JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url")).sub : null;
    if (url.endsWith("/user")) {
      return sub && sub !== "expired" ? { ok: true, status: 200, json: async () => ({}) } : { ok: false, status: 401 };
    }
    return { ok: false, status: 404 };
  };
  const service = createPassphraseService({ db: openDatabase(":memory:"), fetchImpl, now: () => clock, i18nSource: { singular: [], plural: [], locales: {} } });
  const as = (sub) => ({ authorization: `Bearer ${token(sub)}` });
  const get = (sub) => service.handle("GET", "/preferences", as(sub), null);
  const put = (sub, body) => service.handle("PUT", "/preferences", as(sub), body);
  return { service, as, get, put, now: () => clock, advance: (ms) => (clock += ms) };
}

test("synced settings need a Bannergress login", async () => {
  const { service } = setup();
  for (const method of ["GET", "PUT", "DELETE"]) {
    await assert.rejects(service.handle(method, "/preferences", {}, { settings: {} }), { status: 401, code: "login_required" });
    await assert.rejects(service.handle(method, "/preferences", { authorization: "Bearer " + token("expired") }, { settings: {} }), { status: 401 });
    await assert.rejects(service.handle(method, "/preferences", { authorization: "Basic abc" }, { settings: {} }), { status: 401 });
  }
});

test("each account gets only its own settings, keyed by the verified login", async () => {
  const { get, put, now } = setup();
  const empty = await get("alice");
  assert.equal(empty.enabled, true);
  assert.deepEqual(empty.settings, {});
  assert.match(empty.account, /^[0-9a-f]{16}$/);
  const saved = await put("alice", { settings: { language: { value: "nl", changedAt: now() - 1000 }, viewMode: { value: "compact", changedAt: now() } } });
  assert.deepEqual(saved.settings.language, { value: "nl", changedAt: now() - 1000 });
  assert.equal(saved.settings.viewMode.value, "compact");
  assert.deepEqual((await get("bob")).settings, {});
  assert.notEqual((await get("bob")).account, saved.account);
  assert.equal((await get("alice")).settings.language.value, "nl");
});

test("the newest change wins per key, and times from the future count as now", async () => {
  const { get, put, now } = setup();
  await put("alice", { settings: { language: { value: "de", changedAt: now() - 10 } } });
  // An older change from another device doesn't replace it.
  const older = await put("alice", { settings: { language: { value: "fr", changedAt: now() - 500 }, viewMode: { value: "visual", changedAt: 0 } } });
  assert.equal(older.settings.language.value, "de");
  assert.equal(older.settings.viewMode.value, "visual");
  const future = await put("alice", { settings: { language: { value: "ja", changedAt: now() + 10 ** 9 } } });
  assert.deepEqual(future.settings.language, { value: "ja", changedAt: now() });
  // null clears a value (e.g. no picked city any more).
  await put("alice", { settings: { city: { value: { id: "ChIJ1", shortName: "Enschede", numberOfBanners: 12 }, changedAt: now() } } });
  assert.equal((await put("alice", { settings: { city: { value: null, changedAt: now() } } })).settings.city.value, null);
  assert.equal((await get("alice")).now, now());
});

test("only known keys with the right shape are accepted", async () => {
  const { put, now } = setup();
  const bad = [
    null,
    [],
    { settings: [] },
    { other: 1 },
    { enable: false },
    { settings: { token: { value: "x", changedAt: 1 } } },
    { settings: { language: { value: "<script>", changedAt: 1 } } },
    { settings: { language: { value: "nl" } } },
    { settings: { language: { value: "nl", changedAt: -1 } } },
    { settings: { language: { value: "nl", changedAt: 1, extra: true } } },
    { settings: { viewMode: { value: "grid", changedAt: 1 } } },
    { settings: { mapRowFolded: { value: "1", changedAt: 1 } } },
    { settings: { introDismissed: { value: false, changedAt: 1 } } },
    { settings: { mapFilters: { value: { missions: "any", lat: 52 }, changedAt: 1 } } },
    { settings: { mapFilters: { value: { distMax: -5 }, changedAt: 1 } } },
    { settings: { city: { value: { id: "x", latitude: 52.2 }, changedAt: 1 } } },
    { settings: { city: { value: { shortName: "No id" }, changedAt: 1 } } },
    { settings: { recentPlans: { value: [{ id: "short" }], changedAt: 1 } } },
    { settings: { recentPlans: { value: [{ id: "abcdefghij", secret: "x" }], changedAt: 1 } } },
    { settings: { recentPlans: { value: Array.from({ length: 21 }, (_, i) => ({ id: `plan-${String(i).padStart(8, "0")}` })), changedAt: 1 } } },
  ];
  for (const body of bad) {
    await assert.rejects(put("alice", body), { status: 400 }, JSON.stringify(body));
  }
  const ok = await put("alice", {
    settings: {
      language: { value: "zh-Hant", changedAt: now() },
      mapFilters: { value: { missions: "12+", status: "hideDone", distance: "custom", distMin: 1, distMax: null }, changedAt: now() },
      mapRowFolded: { value: true, changedAt: now() },
      introDismissed: { value: true, changedAt: now() },
      recentPlans: { value: [{ id: "AbCdEfGhIjKlMnOpQrStUv", title: "Mission Day", missions: 18, readOnly: false, openedAt: now() }], changedAt: now() },
    },
  });
  assert.deepEqual(Object.keys(ok.settings).sort(), ["introDismissed", "language", "mapFilters", "mapRowFolded", "recentPlans"]);
});

test("an account's settings have a size limit", async () => {
  const { get, put, now } = setup();
  const plans = Array.from({ length: 20 }, (_, i) => ({ id: `plan-${String(i).padStart(8, "0")}`, title: "x".repeat(300), missions: 1, openedAt: now() }));
  // 20 plans with 300-character titles still fit...
  await put("alice", { settings: { recentPlans: { value: plans, changedAt: now() } } });
  // ...but in a 3-byte script they're over 16 KB, and nothing is saved.
  const fat = plans.map((plan) => ({ ...plan, title: "漢".repeat(300) }));
  await assert.rejects(put("alice", { settings: { recentPlans: { value: fat, changedAt: now() + 1 } } }), { status: 413, code: "too_large" });
  assert.equal((await get("alice")).settings.recentPlans.value[0].title, "x".repeat(300));
});

test("writes are rate-limited per account", async () => {
  const { put, now, advance } = setup();
  for (let i = 0; i < MAX_WRITES_PER_WINDOW; i += 1) {
    await put("alice", { settings: { mapRowFolded: { value: i % 2 === 0, changedAt: now() } } });
  }
  await assert.rejects(put("alice", { settings: {} }), { status: 429 });
  await put("bob", { settings: {} });
  advance(WRITE_WINDOW_MS);
  await put("alice", { settings: {} });
});

test("delete removes them and turns syncing off until it's turned on again", async () => {
  const { service, as, get, put, now } = setup();
  await put("alice", { settings: { language: { value: "nl", changedAt: now() } } });
  await put("bob", { settings: { language: { value: "de", changedAt: now() } } });
  const removed = await service.handle("DELETE", "/preferences", as("alice"), null);
  assert.equal(removed.enabled, false);
  assert.deepEqual(removed.settings, {});
  assert.deepEqual((await get("alice")).settings, {});
  // Another signed-in device can't upload them again by accident.
  await assert.rejects(put("alice", { settings: { language: { value: "nl", changedAt: now() } } }), { status: 409, code: "sync_off" });
  assert.equal((await get("bob")).settings.language.value, "de");
  const again = await put("alice", { enable: true, settings: { viewMode: { value: "compact", changedAt: now() } } });
  assert.equal(again.enabled, true);
  assert.deepEqual(Object.keys(again.settings), ["viewMode"]);
});
