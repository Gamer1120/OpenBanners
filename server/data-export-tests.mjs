import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { EXPORT_INTERVAL_MS } from "./data-export.mjs";

const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const as = (sub) => ({ authorization: `Bearer ${token(sub)}` });

function service(db, clock) {
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const sub = headers.Authorization ? JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url")).sub : null;
    if (url.endsWith("/user")) {
      return sub ? { ok: true, status: 200, json: async () => ({ agent: { name: sub === "alice" ? "AliceAgent" : null } }) } : { ok: false, status: 401 };
    }
    return { ok: false, status: 404 };
  };
  return createPassphraseService({ db, fetchImpl, now: () => clock.now, i18nSource: { singular: [], plural: [], locales: {} } });
}

// Something of every kind for alice, and a little for bob (must not leak).
async function seed(db, svc, clock) {
  await svc.handle("PUT", "/preferences", as("alice"), { settings: { language: { value: "nl", changedAt: clock.now } } });
  await svc.handle("POST", "/settings", as("alice"), { askAfterDone: false });
  await svc.handle("POST", "/notes/banners/banner-1", as("alice"), { text: "Park at the church" });
  await svc.handle("POST", "/notes/banners/banner-1", as("bob"), { text: "bob's note" });
  const plan = await svc.handle("POST", "/plans", as("alice"), { title: "Sunday", banners: ["banner-1"] });
  await svc.handle("POST", "/plans", as("bob"), { title: "Bob's plan" });
  const { createHash } = await import("node:crypto");
  const verifier = "a".repeat(50);
  const { code } = await svc.handle("POST", "/overlay/link", as("alice"), { challenge: createHash("sha256").update(verifier).digest("base64url") });
  const { token: overlayToken } = await svc.handle("POST", "/overlay/token", {}, { code, verifier });
  await svc.handle("PUT", "/overlay/backup", { authorization: `Overlay ${overlayToken}` }, { appVersion: 51, settings: { route_orientation: "north" } });
  const t = clock.now;
  db.prepare("INSERT INTO banners (banner_id, title) VALUES ('banner-1', 'Church walk')").run();
  db.prepare(`INSERT INTO answers (banner_id, mission_id, mission_index, step_index, kind, answer, normalized, source, status, submitted_by, submitted_at, visible_at, submitter_agent)
    VALUES ('banner-1', 'm1', 0, 2, 'text', 'Bell', 'bell', 'crowd', 'pending', 'alice', ?, ?, 'AliceAgent')`).run(t, t);
  db.prepare(`INSERT INTO answers (banner_id, mission_id, mission_index, step_index, kind, answer, normalized, source, status, submitted_by, submitted_at, visible_at)
    VALUES ('banner-1', 'm2', 1, 0, 'number', '2', '2', 'crowd', 'live', 'bob', ?, ?)`).run(t, t);
  const bobAnswer = db.prepare("SELECT id FROM answers WHERE submitted_by = 'bob'").get().id;
  db.prepare("INSERT INTO votes (answer_id, user_id, vote, at) VALUES (?, 'alice', 'confirm', ?)").run(bobAnswer, t);
  db.prepare(`INSERT INTO translation_suggestions (language, key, form, text, status, submitted_by, submitter_agent, submitted_at)
    VALUES ('nl', 'Settings', '', 'Instellingen', 'pending', 'alice', 'AliceAgent', ?)`).run(t);
  db.prepare("INSERT INTO banner_authors (banner_id, agent) VALUES ('banner-1', 'aliceagent')").run();
  db.prepare("INSERT INTO blocks (scope, key, via, at) VALUES ('author', 'aliceagent', 'settings', ?)").run(t);
  db.prepare("INSERT INTO contact_attempts (agent, banner_id, channel, note, at) VALUES ('aliceagent', 'banner-1', 'openbanners', 'saw the notice', ?)").run(t);
  return plan;
}

test("the export has every kind of data, only the account's own, with a README", async () => {
  const clock = { now: Date.UTC(2026, 9, 31, 12) };
  const db = openDatabase(":memory:");
  const svc = service(db, clock);
  const plan = await seed(db, svc, clock);
  const data = await svc.handle("POST", "/export", as("alice"), null);
  assert.equal(data.format, "openbanners-data-export");
  assert.equal(data.account.agent, "AliceAgent");
  assert.equal(data.account.bannergressAccountId, "alice");
  for (const section of ["account", "syncedSettings", "overlayBackup", "passphraseSettings", "notes", "plans", "passphraseAnswers", "passphraseVotes", "translationSuggestions", "author", "dataExports"]) {
    assert.ok(data.readme[section], `README explains ${section}`);
    assert.ok(data[section] !== undefined, `section ${section}`);
  }
  assert.ok(Array.isArray(data.readme.notStoredByOpenBanners));
  assert.equal(data.syncedSettings.settings.language.value, "nl");
  assert.deepEqual(data.overlayBackup.settings, { route_orientation: "north" });
  assert.equal(data.overlayBackup.appVersion, 51);
  assert.equal(data.passphraseSettings.askAfterDone, false);
  assert.deepEqual(data.notes.map((note) => note.text), ["Park at the church"]);
  assert.deepEqual(data.plans.map((p) => [p.editId, p.viewId, p.title]), [[plan.id, plan.viewId, "Sunday"]]);
  assert.deepEqual(data.passphraseAnswers.map((a) => [a.answer, a.bannerTitle, a.missionNumber, a.waypoint]), [["Bell", "Church walk", 1, 3]]);
  assert.equal(data.passphraseVotes.length, 1);
  assert.equal(data.passphraseVotes[0].vote, "confirm");
  assert.deepEqual(data.translationSuggestions.map((s) => [s.language, s.english, s.text]), [["nl", "Settings", "Instellingen"]]);
  assert.deepEqual(data.author.bannersAsAuthor.map((b) => b.bannerId), ["banner-1"]);
  assert.equal(data.author.neverAllowPassphrases.via, "settings");
  assert.equal(data.author.noticesSeen.length, 1);
  assert.equal(data.dataExports.previousExportAt, null);
  assert.ok(!JSON.stringify(data).includes("bob's note"));
  assert.ok(!JSON.stringify(data).includes("Bob's plan"));
  // bob: no agent, so no author section, and none of alice's data.
  const bob = await svc.handle("POST", "/export", as("bob"), null);
  assert.equal(bob.author, null);
  assert.equal(bob.overlayBackup, null);
  assert.deepEqual(bob.notes.map((note) => note.text), ["bob's note"]);
});

test("once an hour per account, and the limit survives a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ob-export-"));
  try {
    const clock = { now: Date.UTC(2026, 9, 31, 12) };
    const path = join(dir, "db.sqlite");
    let svc = service(openDatabase(path), clock);
    assert.deepEqual(await svc.handle("GET", "/export", as("alice"), null), { lastExportAt: null, nextExportAt: null, intervalMinutes: 60 });
    await svc.handle("POST", "/export", as("alice"), null);
    clock.now += 10 * 60 * 1000;
    // A new service on the same file, as after a restart.
    svc = service(openDatabase(path), clock);
    await assert.rejects(svc.handle("POST", "/export", as("alice"), null), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "export_limit");
      assert.equal(error.extra.nextExportAt, new Date(Date.UTC(2026, 9, 31, 13)).toISOString());
      return true;
    });
    assert.equal((await svc.handle("GET", "/export", as("alice"), null)).nextExportAt, "2026-10-31T13:00:00.000Z");
    // Other accounts aren't affected.
    await svc.handle("POST", "/export", as("bob"), null);
    clock.now = Date.UTC(2026, 9, 31, 13);
    const again = await svc.handle("POST", "/export", as("alice"), null);
    assert.equal(again.dataExports.previousExportAt, "2026-10-31T12:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exports need a login", async () => {
  const svc = service(openDatabase(":memory:"), { now: Date.now() });
  await assert.rejects(svc.handle("POST", "/export", {}, null), { status: 401 });
  await assert.rejects(svc.handle("GET", "/export", {}, null), { status: 401 });
});

// A new table with per-account data must be added to the export (or here, with a reason).
test("every table that holds per-account data is covered", () => {
  const db = openDatabase(":memory:");
  service(db, { now: Date.now() });
  const covered = {
    synced_settings: "syncedSettings",
    overlay_backups: "overlayBackup",
    user_settings: "passphraseSettings",
    banner_notes: "notes",
    plans: "plans",
    answers: "passphraseAnswers",
    votes: "passphraseVotes",
    translation_suggestions: "translationSuggestions",
    banner_authors: "author.bannersAsAuthor",
    blocks: "author.neverAllowPassphrases",
    contact_attempts: "author.noticesSeen",
    data_exports: "dataExports",
    // Not per account: banner titles, approved translations (public), moderator
    // review messages (Telegram message ids + answer ids), key/value state.
    banners: null,
    translation_overrides: null,
    translation_reviews: null,
    reviews: null,
    kv: null,
  };
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  for (const table of tables) {
    assert.ok(Object.hasOwn(covered, table), `table ${table} is new: add it to server/data-export.mjs`);
  }
});
