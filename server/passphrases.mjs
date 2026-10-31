// Crowd-sourced passphrase answers, in one small SQLite file (node:sqlite, no
// dependencies). Contract:
// - Reading is public. Submitting, voting and author actions need a Bannergress
//   login: the browser sends its Bannergress access token, which is checked by
//   asking Bannergress `GET /user` and is never stored or logged.
// - "Mission number" answers go live once a moderator approves them. Other
//   answers stay pending and hidden for PENDING_DAYS (and need a moderator's
//   approval too), unless a banner author approves them sooner.
// - Authors are verified agents (`/user` -> `agent`, set only after Bannergress
//   verification) who authored a mission of the banner. They can add answers
//   (live at once), approve or delete suggestions, and object for one banner or
//   all their banners: that deletes the answers permanently and blocks new ones.
// - Typed crowd answers also need a moderator's approval (Telegram bot,
//   server/passphrases-telegram.mjs, one message per banner): approved ones
//   still wait out the 30 days, "publish now" skips the wait, rejected ones are
//   deleted.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createDataExport, DataExportError } from "./data-export.mjs";
import { createOverlayBackups, OverlayBackupError } from "./overlay-backup.mjs";
import { createSyncedSettings, SyncedSettingsError } from "./synced-settings.mjs";
import { createTranslationService, loadI18nSource, TranslationError } from "./translations.mjs";

export const BASE_PATH = "/_openbanners/passphrases/v1";
export const PENDING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const BANNERGRESS_API = "https://api.bannergress.com";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ANSWER_LENGTH = 200;
const MAX_ANSWERS_PER_USER_PER_DAY = 500;
const IDENTITY_TTL_MS = 10 * 60 * 1000;
const BANNER_TTL_MS = 5 * 60 * 1000;
const BANNER_ID_PATTERN = /^[^\s/?#]{1,200}$/u;

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    // More fields for the JSON error body (e.g. nextExportAt).
    this.extra = extra;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  banner_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  mission_index INTEGER NOT NULL,
  step_index INTEGER NOT NULL,
  poi_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('number', 'text')),
  answer TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('crowd', 'author')),
  status TEXT NOT NULL CHECK (status IN ('live', 'pending')),
  submitted_by TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  visible_at INTEGER NOT NULL,
  UNIQUE (banner_id, mission_id, step_index, normalized)
);
CREATE INDEX IF NOT EXISTS answers_banner ON answers (banner_id);
CREATE TABLE IF NOT EXISTS votes (
  answer_id INTEGER NOT NULL REFERENCES answers (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('confirm', 'wrong')),
  at INTEGER NOT NULL,
  PRIMARY KEY (answer_id, user_id)
);
CREATE TABLE IF NOT EXISTS banner_authors (
  banner_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  PRIMARY KEY (banner_id, agent)
);
CREATE INDEX IF NOT EXISTS banner_authors_agent ON banner_authors (agent);
CREATE TABLE IF NOT EXISTS banners (
  banner_id TEXT PRIMARY KEY,
  title TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  scope TEXT NOT NULL CHECK (scope IN ('banner', 'author')),
  key TEXT NOT NULL,
  via TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  ask_after_done INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
-- Personal banner notes, readable only through the owner's login.
CREATE TABLE IF NOT EXISTS banner_notes (
  user_id TEXT NOT NULL,
  banner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, banner_id)
);
-- Mission Day plans: the random id in the link is what lets anyone view and edit one.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_attempts (
  id INTEGER PRIMARY KEY,
  agent TEXT NOT NULL,
  banner_id TEXT,
  channel TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL
);
`;

export function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function agentKey(name) {
  return typeof name === "string" && name.trim() ? name.trim().toLowerCase() : "";
}

export function openDatabase(path) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;");
  db.exec(SCHEMA);
  const columns = new Set(db.prepare("PRAGMA table_info(answers)").all().map((column) => column.name));
  for (const [name, type] of [["approved_at", "INTEGER"], ["notified_at", "INTEGER"], ["submitter_agent", "TEXT"]]) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE answers ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)");
  // Mission Day plans: a second, read-only link per plan.
  if (!new Set(db.prepare("PRAGMA table_info(plans)").all().map((column) => column.name)).has("view_id")) {
    db.exec("ALTER TABLE plans ADD COLUMN view_id TEXT");
  }
  for (const { id } of db.prepare("SELECT id FROM plans WHERE view_id IS NULL").all()) {
    db.prepare("UPDATE plans SET view_id = ? WHERE id = ?").run(randomBytes(16).toString("base64url").slice(0, 22), id);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS plans_view_id ON plans (view_id)");
  // Encrypted notes (24 Oct 2026, never used) were replaced by banner_notes.
  db.exec("DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS note_keys;");
  // One Telegram review message per banner and moderator; items = the answers it shows.
  db.exec(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    banner_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id INTEGER,
    items TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'banner',
    closed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
  return db;
}

// Missions of a Bannergress banner DTO in banner order, with their passphrase steps.
export function passphraseStepsOf(banner) {
  const missions = Object.entries(banner?.missions ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, mission]) => mission);
  return missions.map((mission, index) => ({
    index,
    id: mission?.id ?? null,
    author: agentKey(mission?.author?.name),
    steps: Object.values(mission?.steps ?? {}).map((step) => ({
      passphrase: step?.objective === "enterPassphrase",
      poiId: step?.poi?.id ?? null,
    })),
  }));
}

// unlimitedAgents: verified agent names that skip the daily answer limit (they still need review).
// Translation suggestions (server/translations.mjs) share the login, the DB and the bot.
export function createPassphraseService({
  db,
  fetchImpl = fetch,
  now = () => Date.now(),
  onSubmitted = () => {},
  onTranslationSubmitted = () => {},
  unlimitedAgents = [],
  i18nSource = null,
} = {}) {
  const unlimited = new Set(unlimitedAgents.map(agentKey).filter(Boolean));
  const translations = createTranslationService({
    db,
    source: i18nSource ?? loadI18nSource(),
    now,
    unlimitedAgents,
    onSubmitted: onTranslationSubmitted,
  });
  const syncedSettings = createSyncedSettings({ db, now });
  const overlayBackups = createOverlayBackups({ db, now });
  const dataExport = createDataExport({ db, now, overlayBackups });
  const identityCache = new Map();
  const bannerCache = new Map();

  async function identify(authorization) {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "");
    if (!match) {
      throw new ApiError(401, "login_required", "Log in with Bannergress first.");
    }
    const token = match[1];
    const key = createHash("sha256").update(token).digest("hex");
    const cached = identityCache.get(key);
    if (cached && cached.expires > now()) {
      return { ...cached.identity, token };
    }
    const response = await fetchImpl(`${BANNERGRESS_API}/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(401, "login_required", "Your Bannergress login has expired. Log in again.");
    }
    if (!response.ok) {
      throw new ApiError(502, "bannergress_unavailable", "Bannergress didn't answer. Try again later.");
    }
    const user = await response.json();
    let userId = "";
    try {
      userId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub ?? "";
    } catch {
      userId = "";
    }
    // The token was accepted by Bannergress, so its subject identifies the account.
    const identity = {
      userId: userId || `token:${key.slice(0, 16)}`,
      agent: typeof user?.agent?.name === "string" ? user.agent.name : null,
    };
    identityCache.set(key, { identity, expires: now() + IDENTITY_TTL_MS });
    if (identityCache.size > 5000) {
      identityCache.delete(identityCache.keys().next().value);
    }
    return { ...identity, token };
  }

  async function loadBanner(bannerId, token) {
    const cacheKey = `${token ? "auth" : "anon"}:${bannerId}`;
    const cached = bannerCache.get(cacheKey);
    if (cached && cached.expires > now() && !token) {
      return cached.banner;
    }
    const response = await fetchImpl(`${BANNERGRESS_API}/bnrs/${encodeURIComponent(bannerId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (response.status === 404) {
      throw new ApiError(404, "unknown_banner", "Bannergress doesn't know this banner.");
    }
    if (!response.ok) {
      throw new ApiError(502, "bannergress_unavailable", "Bannergress didn't answer. Try again later.");
    }
    const banner = await response.json();
    if (!token) {
      bannerCache.set(cacheKey, { banner, expires: now() + BANNER_TTL_MS });
    }
    return banner;
  }

  function rememberAuthors(bannerId, banner, missions) {
    db.prepare("INSERT INTO banners (banner_id, title) VALUES (?, ?) ON CONFLICT (banner_id) DO UPDATE SET title = excluded.title")
      .run(bannerId, typeof banner?.title === "string" ? banner.title : null);
    const insert = db.prepare("INSERT OR IGNORE INTO banner_authors (banner_id, agent) VALUES (?, ?)");
    for (const mission of missions) {
      if (mission.author) {
        insert.run(bannerId, mission.author);
      }
    }
  }

  function blockFor(bannerId, authors = null) {
    if (db.prepare("SELECT 1 FROM blocks WHERE scope = 'banner' AND key = ?").get(bannerId)) {
      return "banner";
    }
    const known = authors ?? db.prepare("SELECT agent FROM banner_authors WHERE banner_id = ?").all(bannerId).map((row) => row.agent);
    const check = db.prepare("SELECT 1 FROM blocks WHERE scope = 'author' AND key = ?");
    return known.some((agent) => check.get(agent)) ? "author" : null;
  }

  function isAuthor(identity, bannerId) {
    const agent = agentKey(identity?.agent);
    return Boolean(agent && db.prepare("SELECT 1 FROM banner_authors WHERE banner_id = ? AND agent = ?").get(bannerId, agent));
  }

  // Pending answers whose 30 days are over become live.
  function promote() {
    db.prepare("UPDATE answers SET status = 'live' WHERE status = 'pending' AND approved_at IS NOT NULL AND visible_at <= ?").run(now());
  }


  function deleteBanner(bannerId) {
    db.prepare("DELETE FROM answers WHERE banner_id = ?").run(bannerId);
  }

  function listAnswers(bannerId, identity) {
    promote();
    const author = identity ? isAuthor(identity, bannerId) : false;
    const rows = db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM votes v WHERE v.answer_id = a.id AND v.vote = 'confirm') AS confirms,
        (SELECT COUNT(*) FROM votes v WHERE v.answer_id = a.id AND v.vote = 'wrong') AS wrongs,
        (SELECT vote FROM votes v WHERE v.answer_id = a.id AND v.user_id = ?) AS my_vote,
        (SELECT COUNT(*) FROM votes v WHERE v.answer_id = a.id AND v.user_id != a.submitted_by) AS others_votes
      FROM answers a WHERE a.banner_id = ?
      ORDER BY a.mission_index, a.step_index, a.status, confirms DESC, a.submitted_at`).all(identity?.userId ?? "", bannerId);
    return {
      bannerId,
      blocked: blockFor(bannerId),
      pendingDays: PENDING_DAYS,
      viewer: identity ? { agent: identity.agent, isAuthor: author } : null,
      answers: rows.map((row) => {
        const visible = row.status === "live" || author || row.submitted_by === identity?.userId;
        return {
          id: row.id,
          missionId: row.mission_id,
          missionIndex: row.mission_index,
          stepIndex: row.step_index,
          poiId: row.poi_id,
          kind: row.kind,
          source: row.source,
          status: row.status,
          answer: visible ? row.answer : null,
          submittedAt: new Date(row.submitted_at).toISOString(),
          visibleAt: new Date(row.visible_at).toISOString(),
          confirms: row.confirms,
          wrongs: row.wrongs,
          myVote: row.my_vote ?? null,
          mine: Boolean(identity && row.submitted_by === identity.userId),
          reviewed: row.approved_at !== null,
          withdrawable: Boolean(identity && row.submitted_by === identity.userId && !row.others_votes),
        };
      }),
    };
  }

  async function submit(bannerId, identity, body) {
    const items = Array.isArray(body?.answers) ? body.answers : null;
    if (!items || !items.length || items.length > 400) {
      throw new ApiError(400, "invalid_answers", "Send between 1 and 400 answers.");
    }
    const since = now() - DAY_MS;
    const recent = db.prepare("SELECT COUNT(*) AS n FROM answers WHERE submitted_by = ? AND submitted_at > ?").get(identity.userId, since).n;
    if (recent + items.length > MAX_ANSWERS_PER_USER_PER_DAY && !unlimited.has(agentKey(identity.agent))) {
      throw new ApiError(429, "too_many", "That's a lot of answers for one day. Try again tomorrow.");
    }
    const banner = await loadBanner(bannerId, identity.token);
    const missions = passphraseStepsOf(banner);
    rememberAuthors(bannerId, banner, missions);
    const blocked = blockFor(bannerId, missions.map((mission) => mission.author).filter(Boolean));
    if (blocked) {
      throw new ApiError(403, "blocked", "The author asked not to publish passphrases for this banner.");
    }
    const author = isAuthor(identity, bannerId);
    const at = now();
    const insert = db.prepare(`INSERT INTO answers
      (banner_id, mission_id, mission_index, step_index, poi_id, kind, answer, normalized, source, status, submitted_by, submitted_at, visible_at, approved_at, submitter_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (banner_id, mission_id, step_index, normalized) DO NOTHING RETURNING id`);
    const existing = db.prepare("SELECT id, status FROM answers WHERE banner_id = ? AND mission_id = ? AND step_index = ? AND normalized = ?");
    const vote = db.prepare("INSERT INTO votes (answer_id, user_id, vote, at) VALUES (?, ?, 'confirm', ?) ON CONFLICT (answer_id, user_id) DO UPDATE SET vote = 'confirm', at = excluded.at");
    const makeLive = db.prepare("UPDATE answers SET status = 'live', source = 'author', visible_at = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?");
    const prepared = items.map((item) => {
      const mission = missions.find((entry) => entry.id && entry.id === item?.missionId);
      const step = mission?.steps[item?.stepIndex];
      if (!mission || !Number.isInteger(item?.stepIndex) || !step?.passphrase) {
        throw new ApiError(400, "not_a_passphrase", "One of the answers isn't for a passphrase waypoint of this banner.");
      }
      const kind = item.kind === "number" ? "number" : item.kind === "text" ? "text" : null;
      const answer = kind === "number" ? String(mission.index + 1) : String(item.text ?? "").trim();
      if (!kind || !answer || answer.length > MAX_ANSWER_LENGTH) {
        throw new ApiError(400, "invalid_answer", `Answers must be 1 to ${MAX_ANSWER_LENGTH} characters.`);
      }
      return { mission, step, kind, answer, stepIndex: item.stepIndex };
    });
    const results = [];
    db.exec("BEGIN");
    try {
      for (const { mission, step, kind, answer, stepIndex } of prepared) {
        const normalized = normalizeAnswer(answer);
        // Authors' answers are live at once. Everything else waits for a moderator;
        // mission numbers show as soon as one approves, typed answers after the 30 days.
        const live = author;
        const row = insert.get(
          bannerId, mission.id, mission.index, stepIndex, step.poiId, kind, answer, normalized,
          author ? "author" : "crowd", live ? "live" : "pending", identity.userId, at,
          live || kind === "number" ? at : at + PENDING_DAYS * DAY_MS,
          live ? at : null,
          identity.agent
        );
        const id = row?.id ?? existing.get(bannerId, mission.id, stepIndex, normalized).id;
        if (!row) {
          // Same answer again: it counts as a confirmation, and an author's makes it live.
          vote.run(id, identity.userId, at);
          if (author) {
            makeLive.run(at, at, id);
          }
        }
        results.push(id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    try {
      onSubmitted();
    } catch {
      // Moderation notices retry on their own; a failure never fails the submit.
    }
    return { ids: results, ...listAnswers(bannerId, identity) };
  }

  // Take back your own answers (e.g. "they're all the mission number" by mistake),
  // as long as nobody else has voted on them yet.
  function withdraw(bannerId, identity, body) {
    const ids = Array.isArray(body?.answerIds) ? body.answerIds.filter(Number.isInteger) : [];
    if (!ids.length || ids.length > 400) {
      throw new ApiError(400, "invalid_answers", "Say which answers to take back.");
    }
    const remove = db.prepare(`DELETE FROM answers WHERE id = ? AND banner_id = ? AND submitted_by = ?
      AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.answer_id = answers.id AND v.user_id != ?)`);
    let removed = 0;
    db.exec("BEGIN");
    try {
      for (const id of ids) {
        removed += Number(remove.run(id, bannerId, identity.userId, identity.userId).changes);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { removed, ...listAnswers(bannerId, identity) };
  }

  function voteOn(answerId, identity, body) {
    const row = db.prepare("SELECT banner_id, status, submitted_by FROM answers WHERE id = ?").get(answerId);
    if (!row) {
      throw new ApiError(404, "unknown_answer", "That answer doesn't exist any more.");
    }
    promote();
    const current = db.prepare("SELECT status FROM answers WHERE id = ?").get(answerId);
    if (current.status !== "live") {
      throw new ApiError(409, "not_live", "You can vote once the answer is visible.");
    }
    if (body?.vote === null) {
      db.prepare("DELETE FROM votes WHERE answer_id = ? AND user_id = ?").run(answerId, identity.userId);
    } else if (body?.vote === "confirm" || body?.vote === "wrong") {
      db.prepare("INSERT INTO votes (answer_id, user_id, vote, at) VALUES (?, ?, ?, ?) ON CONFLICT (answer_id, user_id) DO UPDATE SET vote = excluded.vote, at = excluded.at")
        .run(answerId, identity.userId, body.vote, now());
    } else {
      throw new ApiError(400, "invalid_vote", "Vote confirm, wrong or null.");
    }
    return listAnswers(row.banner_id, identity);
  }

  async function authorAction(bannerId, identity, body) {
    // Refresh the authors with the author's own login, so a new verified author
    // is recognised even before anyone submitted answers.
    const banner = await loadBanner(bannerId, identity.token);
    rememberAuthors(bannerId, banner, passphraseStepsOf(banner));
    if (!isAuthor(identity, bannerId)) {
      throw new ApiError(403, "not_author", "Only a verified author of this banner can do that.");
    }
    const at = now();
    const agent = agentKey(identity.agent);
    if (body?.action === "approve" || body?.action === "delete") {
      const row = db.prepare("SELECT id FROM answers WHERE id = ? AND banner_id = ?").get(body.answerId, bannerId);
      if (!row) {
        throw new ApiError(404, "unknown_answer", "That answer doesn't exist any more.");
      }
      if (body.action === "approve") {
        db.prepare("UPDATE answers SET status = 'live', visible_at = MIN(visible_at, ?), approved_at = COALESCE(approved_at, ?) WHERE id = ?").run(at, at, row.id);
      } else {
        db.prepare("DELETE FROM answers WHERE id = ?").run(row.id);
      }
    } else if (body?.action === "object" && (body.scope === "banner" || body.scope === "all")) {
      db.exec("BEGIN");
      try {
        if (body.scope === "banner") {
          db.prepare("INSERT OR REPLACE INTO blocks (scope, key, via, at) VALUES ('banner', ?, 'login', ?)").run(bannerId, at);
          deleteBanner(bannerId);
        } else {
          db.prepare("INSERT OR REPLACE INTO blocks (scope, key, via, at) VALUES ('author', ?, 'login', ?)").run(agent, at);
          for (const { banner_id: id } of db.prepare("SELECT banner_id FROM banner_authors WHERE agent = ?").all(agent)) {
            deleteBanner(id);
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } else if (body?.action === "unblock" && (body.scope === "banner" || body.scope === "all")) {
      db.prepare("DELETE FROM blocks WHERE scope = ? AND key = ?").run(body.scope === "banner" ? "banner" : "author", body.scope === "banner" ? bannerId : agent);
    } else {
      throw new ApiError(400, "invalid_action", "Unknown author action.");
    }
    return listAnswers(bannerId, identity);
  }

  // The banners of a verified agent that have answers waiting for them.
  function me(identity) {
    promote();
    const agent = agentKey(identity.agent);
    const blockedAll = Boolean(agent && db.prepare("SELECT 1 FROM blocks WHERE scope = 'author' AND key = ?").get(agent));
    const pending = agent
      ? db.prepare(`SELECT a.banner_id AS bannerId, b.title, COUNT(*) AS count, MIN(a.visible_at) AS visibleAt
          FROM answers a JOIN banner_authors ba ON ba.banner_id = a.banner_id AND ba.agent = ?
          LEFT JOIN banners b ON b.banner_id = a.banner_id
          WHERE a.status = 'pending' GROUP BY a.banner_id ORDER BY visibleAt`).all(agent)
      : [];
    // Seeing the notice counts as reaching the author; the admin tool lists it.
    const seen = db.prepare("SELECT 1 FROM contact_attempts WHERE agent = ? AND banner_id = ? AND channel = 'openbanners'");
    const log = db.prepare("INSERT INTO contact_attempts (agent, banner_id, channel, note, at) VALUES (?, ?, 'openbanners', 'saw the notice after logging in', ?)");
    for (const row of pending) {
      if (!seen.get(agent, row.bannerId)) {
        log.run(agent, row.bannerId, now());
      }
    }
    return {
      agent: identity.agent,
      blockedAll,
      pending: pending.map((row) => ({ ...row, visibleAt: new Date(row.visibleAt).toISOString() })),
    };
  }

  // Per-account settings. "Never allow passphrases for my banners" is the
  // author-wide block itself, so it needs a verified agent.
  function settings(identity) {
    const agent = agentKey(identity.agent);
    const row = db.prepare("SELECT ask_after_done FROM user_settings WHERE user_id = ?").get(identity.userId);
    return {
      agent: identity.agent,
      askAfterDone: row ? Boolean(row.ask_after_done) : true,
      blockMyBanners: Boolean(agent && db.prepare("SELECT 1 FROM blocks WHERE scope = 'author' AND key = ?").get(agent)),
      canBlockMyBanners: Boolean(agent),
    };
  }

  function updateSettings(identity, body) {
    if (!body || typeof body !== "object") {
      throw new ApiError(400, "invalid_settings", "Send the settings to change.");
    }
    const at = now();
    if (typeof body.askAfterDone === "boolean") {
      db.prepare(`INSERT INTO user_settings (user_id, ask_after_done, updated_at) VALUES (?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET ask_after_done = excluded.ask_after_done, updated_at = excluded.updated_at`)
        .run(identity.userId, body.askAfterDone ? 1 : 0, at);
    }
    if (typeof body.blockMyBanners === "boolean") {
      const agent = agentKey(identity.agent);
      if (!agent) {
        throw new ApiError(403, "not_verified", "Verify your agent name on Bannergress first.");
      }
      if (body.blockMyBanners) {
        db.exec("BEGIN");
        try {
          db.prepare("INSERT OR REPLACE INTO blocks (scope, key, via, at) VALUES ('author', ?, 'settings', ?)").run(agent, at);
          for (const { banner_id: id } of db.prepare("SELECT banner_id FROM banner_authors WHERE agent = ?").all(agent)) {
            deleteBanner(id);
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } else {
        db.prepare("DELETE FROM blocks WHERE scope = 'author' AND key = ?").run(agent);
      }
    }
    return settings(identity);
  }

  // Personal notes: each account sees only its own.
  const MAX_NOTE_LENGTH = 10000;
  const MAX_NOTES = 20000;

  function getNote(identity, bannerId) {
    const row = db.prepare("SELECT text, updated_at FROM banner_notes WHERE user_id = ? AND banner_id = ?").get(identity.userId, bannerId);
    return { note: row ? { text: row.text, updatedAt: new Date(row.updated_at).toISOString() } : null };
  }

  function saveNote(identity, bannerId, body) {
    if (!body || typeof body !== "object" || (typeof body.text !== "string" && body.text !== null)) {
      throw new ApiError(400, "invalid_note", "Send the note text.");
    }
    const text = (body.text ?? "").trim() ? body.text : "";
    if (!text) {
      db.prepare("DELETE FROM banner_notes WHERE user_id = ? AND banner_id = ?").run(identity.userId, bannerId);
      return getNote(identity, bannerId);
    }
    if (text.length > MAX_NOTE_LENGTH) {
      throw new ApiError(400, "invalid_note", `Notes can be ${MAX_NOTE_LENGTH} characters at most.`);
    }
    const exists = db.prepare("SELECT 1 FROM banner_notes WHERE user_id = ? AND banner_id = ?").get(identity.userId, bannerId);
    if (!exists && Number(db.prepare("SELECT COUNT(*) AS n FROM banner_notes WHERE user_id = ?").get(identity.userId).n) >= MAX_NOTES) {
      throw new ApiError(429, "too_many_notes", "You have the maximum number of notes.");
    }
    db.prepare(`INSERT INTO banner_notes (user_id, banner_id, text, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, banner_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`)
      .run(identity.userId, bannerId, text, now());
    return getNote(identity, bannerId);
  }

  // Mission Day plans. Creating one needs a login (so it can't be spammed); anyone
  // with the link edits it. Edits are small operations applied here one at a time,
  // so two people changing the plan at once never overwrite each other.
  const PLAN_ID = /^[A-Za-z0-9_-]{22}$/;
  const MISSION_ID = /^[A-Za-z0-9._-]{1,100}$/;
  const MAX_PLAN_ITEMS = 500;
  const MAX_PLAN_BANNERS = 30;
  const MAX_PLANS_PER_ACCOUNT = 200;

  // Opened with the read-only link, the plan comes back under that link's id and
  // without the edit id, so nobody can get from one to the other.
  function planOut(row, readOnly = false) {
    return {
      id: readOnly ? row.view_id : row.id,
      viewId: row.view_id,
      readOnly,
      ...JSON.parse(row.data),
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // { row, readOnly }: the id is either the edit link's or the read-only link's.
  function findPlan(id) {
    if (!PLAN_ID.test(id)) {
      throw new ApiError(404, "plan_not_found", "This plan doesn't exist.");
    }
    const row = db.prepare("SELECT * FROM plans WHERE id = ? OR view_id = ?").get(id, id);
    if (!row) {
      throw new ApiError(404, "plan_not_found", "This plan doesn't exist.");
    }
    return { row, readOnly: row.id !== id };
  }

  function loadPlan(id) {
    const { row, readOnly } = findPlan(id);
    if (readOnly) {
      throw new ApiError(403, "read_only", "This is a read-only link to the plan.");
    }
    return row;
  }

  const cleanTitle = (title) => String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

  function checkBanner(bannerId) {
    if (typeof bannerId !== "string" || !BANNER_ID_PATTERN.test(bannerId)) {
      throw new ApiError(400, "invalid_banner", "Invalid banner id.");
    }
  }

  function createPlan(identity, body) {
    const count = Number(db.prepare("SELECT COUNT(*) AS n FROM plans WHERE owner = ?").get(identity.userId).n);
    if (count >= MAX_PLANS_PER_ACCOUNT) {
      throw new ApiError(429, "too_many_plans", "You have made the maximum number of plans.");
    }
    const banners = Array.isArray(body?.banners) ? body.banners : [];
    banners.forEach(checkBanner);
    const data = { title: cleanTitle(body?.title) || "Mission Day plan", banners: [...new Set(banners)].slice(0, MAX_PLAN_BANNERS), items: [] };
    const id = randomBytes(16).toString("base64url").slice(0, 22);
    const at = now();
    db.prepare("INSERT INTO plans (id, view_id, owner, data, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .run(id, randomBytes(16).toString("base64url").slice(0, 22), identity.userId, JSON.stringify(data), at, at);
    return planOut(loadPlan(id));
  }

  // Only the person who made the plan can delete it, with the edit link's id.
  // The row is really removed (the privacy page says so).
  function deletePlan(identity, id) {
    const row = loadPlan(id);
    if (row.owner !== identity.userId) {
      throw new ApiError(403, "not_owner", "Only the person who made this plan can delete it.");
    }
    db.prepare("DELETE FROM plans WHERE id = ?").run(row.id);
    return { deleted: true };
  }

  // ops: [{ op: "title", title } | { op: "addBanner", bannerId } | { op: "removeBanner", bannerId }
  //   | { op: "add", bannerId, missionId, index? } | { op: "remove", missionId } | { op: "move", missionId, index }
  //   | { op: "done", missionId, done } | { op: "reverse", missionId, reversed }]
  function editPlan(id, body) {
    const ops = Array.isArray(body?.ops) ? body.ops : null;
    if (!ops || !ops.length || ops.length > MAX_PLAN_ITEMS) {
      throw new ApiError(400, "invalid_ops", "Send the changes to make.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = loadPlan(id);
      const data = JSON.parse(row.data);
      const at = (missionId) => data.items.findIndex((item) => item.missionId === missionId);
      const clampIndex = (index, length) => (Number.isInteger(index) ? Math.max(0, Math.min(index, length)) : length);
      for (const change of ops) {
        switch (change?.op) {
          case "title":
            data.title = cleanTitle(change.title) || data.title;
            break;
          case "addBanner":
            checkBanner(change.bannerId);
            if (!data.banners.includes(change.bannerId)) {
              if (data.banners.length >= MAX_PLAN_BANNERS) {
                throw new ApiError(400, "too_many_banners", `A plan can have ${MAX_PLAN_BANNERS} banners at most.`);
              }
              data.banners.push(change.bannerId);
            }
            break;
          case "removeBanner":
            data.banners = data.banners.filter((bannerId) => bannerId !== change.bannerId);
            data.items = data.items.filter((item) => item.bannerId !== change.bannerId);
            break;
          case "add": {
            checkBanner(change.bannerId);
            if (typeof change.missionId !== "string" || !MISSION_ID.test(change.missionId)) {
              throw new ApiError(400, "invalid_mission", "Invalid mission id.");
            }
            if (at(change.missionId) !== -1) {
              break;
            }
            if (data.items.length >= MAX_PLAN_ITEMS) {
              throw new ApiError(400, "too_many_missions", `A plan can have ${MAX_PLAN_ITEMS} missions at most.`);
            }
            if (!data.banners.includes(change.bannerId)) {
              data.banners.push(change.bannerId);
            }
            data.items.splice(clampIndex(change.index, data.items.length), 0, { bannerId: change.bannerId, missionId: change.missionId, done: false });
            break;
          }
          case "remove": {
            const index = at(change.missionId);
            if (index !== -1) {
              data.items.splice(index, 1);
            }
            break;
          }
          case "move": {
            const index = at(change.missionId);
            if (index !== -1) {
              const [item] = data.items.splice(index, 1);
              data.items.splice(clampIndex(change.index, data.items.length), 0, item);
            }
            break;
          }
          case "done": {
            const index = at(change.missionId);
            if (index !== -1) {
              data.items[index].done = Boolean(change.done);
            }
            break;
          }
          // Walk an any-order mission from its last portal to its first.
          case "reverse": {
            const index = at(change.missionId);
            if (index !== -1) {
              if (change.reversed) {
                data.items[index].reversed = true;
              } else {
                delete data.items[index].reversed;
              }
            }
            break;
          }
          default:
            throw new ApiError(400, "invalid_ops", "Unknown change.");
        }
      }
      db.prepare("UPDATE plans SET data = ?, version = version + 1, updated_at = ? WHERE id = ?").run(JSON.stringify(data), now(), id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return planOut(loadPlan(id));
  }

  async function handle(method, path, headers, body) {
    if (path.startsWith("/translations/")) {
      try {
        const result = await translations.handle(method, path, headers, body, identify);
        if (result !== undefined) {
          return result;
        }
      } catch (error) {
        throw error instanceof TranslationError ? new ApiError(error.status, error.code, error.message) : error;
      }
    }
    // Settings that follow the account between devices (server/synced-settings.mjs).
    if (path === "/preferences" && ["GET", "PUT", "DELETE"].includes(method)) {
      const identity = await identify(headers.authorization);
      try {
        if (method === "GET") {
          return syncedSettings.get(identity);
        }
        return method === "PUT" ? syncedSettings.put(identity, body) : syncedSettings.remove(identity);
      } catch (error) {
        throw error instanceof SyncedSettingsError ? new ApiError(error.status, error.code, error.message) : error;
      }
    }
    // OpenBanners Overlay settings backup (server/overlay-backup.mjs): the app
    // with its short-lived overlay token, the site with the Bannergress login.
    if (path.startsWith("/overlay/")) {
      try {
        if (path === "/overlay/link" && method === "POST") {
          return overlayBackups.createLink(await identify(headers.authorization), body);
        }
        if (path === "/overlay/token" && method === "POST") {
          return overlayBackups.exchange(body);
        }
        if (path === "/overlay/backup" && ["GET", "PUT", "DELETE"].includes(method)) {
          const identity = overlayBackups.identifyOverlay(headers.authorization) ?? (await identify(headers.authorization));
          if (method === "GET") {
            return overlayBackups.get(identity);
          }
          return method === "PUT" ? overlayBackups.put(identity, body) : overlayBackups.remove(identity);
        }
      } catch (error) {
        throw error instanceof OverlayBackupError ? new ApiError(error.status, error.code, error.message) : error;
      }
    }
    // "Download my data" (server/data-export.mjs): GET = when it's possible, POST = the file.
    if (path === "/export" && (method === "GET" || method === "POST")) {
      const identity = await identify(headers.authorization);
      try {
        return method === "GET" ? dataExport.status(identity) : dataExport.run(identity);
      } catch (error) {
        throw error instanceof DataExportError ? new ApiError(error.status, error.code, error.message, error.extra) : error;
      }
    }
    if (path === "/settings" && (method === "GET" || method === "POST")) {
      const identity = await identify(headers.authorization);
      return method === "GET" ? settings(identity) : updateSettings(identity, body);
    }
    const noteMatch = /^\/notes\/banners\/([^/]+)$/.exec(path);
    if (noteMatch && (method === "GET" || method === "POST")) {
      const bannerId = decodeURIComponent(noteMatch[1]);
      if (!BANNER_ID_PATTERN.test(bannerId)) {
        throw new ApiError(400, "invalid_banner", "Invalid banner id.");
      }
      const identity = await identify(headers.authorization);
      return method === "GET" ? getNote(identity, bannerId) : saveNote(identity, bannerId, body);
    }
    if (path === "/plans" && method === "POST") {
      return createPlan(await identify(headers.authorization), body);
    }
    const planMatch = /^\/plans\/([^/]+)$/.exec(path);
    if (planMatch && method === "GET") {
      const { row, readOnly } = findPlan(planMatch[1]);
      return planOut(row, readOnly);
    }
    if (planMatch && method === "POST") {
      return editPlan(planMatch[1], body);
    }
    if (planMatch && method === "DELETE") {
      return deletePlan(await identify(headers.authorization), planMatch[1]);
    }
    if (path === "/health" && method === "GET") {
      return { ok: true };
    }
    if (path === "/me" && method === "GET") {
      return me(await identify(headers.authorization));
    }
    let match = /^\/banners\/([^/]+)$/.exec(path);
    if (match && method === "GET") {
      const bannerId = decodeURIComponent(match[1]);
      if (!BANNER_ID_PATTERN.test(bannerId)) {
        throw new ApiError(400, "invalid_banner", "Invalid banner id.");
      }
      const identity = headers.authorization ? await identify(headers.authorization).catch(() => null) : null;
      if (identity?.agent) {
        // Only verified agents can be authors; learn the banner's authors with their login.
        const banner = await loadBanner(bannerId, identity.token).catch(() => null);
        if (banner) {
          rememberAuthors(bannerId, banner, passphraseStepsOf(banner));
        }
      }
      return listAnswers(bannerId, identity);
    }
    match = /^\/banners\/([^/]+)\/(answers|author|withdraw)$/.exec(path);
    if (match && method === "POST") {
      const bannerId = decodeURIComponent(match[1]);
      if (!BANNER_ID_PATTERN.test(bannerId)) {
        throw new ApiError(400, "invalid_banner", "Invalid banner id.");
      }
      const identity = await identify(headers.authorization);
      if (match[2] === "withdraw") {
        return withdraw(bannerId, identity, body);
      }
      return match[2] === "answers" ? submit(bannerId, identity, body) : authorAction(bannerId, identity, body);
    }
    match = /^\/answers\/(\d+)\/vote$/.exec(path);
    if (match && method === "POST") {
      return voteOn(Number(match[1]), await identify(headers.authorization), body);
    }
    throw new ApiError(404, "not_found", "Not found.");
  }

  // Moderation (Telegram bot, admin tool). Only typed crowd answers wait for it.
  const REVIEW_SQL = `SELECT a.*, b.title,
      (SELECT group_concat(agent, ', ') FROM banner_authors ba WHERE ba.banner_id = a.banner_id) AS authors
    FROM answers a LEFT JOIN banners b ON b.banner_id = a.banner_id`;

  const moderation = {
    awaitingReview: () => db.prepare(`${REVIEW_SQL} WHERE a.approved_at IS NULL ORDER BY a.submitted_at`).all(),
    approvedWaiting: () => db.prepare(`${REVIEW_SQL} WHERE a.approved_at IS NOT NULL AND a.status = 'pending' ORDER BY a.visible_at`).all(),
    unnotified: () => db.prepare(`${REVIEW_SQL} WHERE a.approved_at IS NULL AND a.notified_at IS NULL ORDER BY a.submitted_at`).all(),
    markNotified: (id) => db.prepare("UPDATE answers SET notified_at = ? WHERE id = ?").run(now(), id),
    get: (id) => db.prepare(`${REVIEW_SQL} WHERE a.id = ?`).get(id) ?? null,
    // Answers still open for moderation (to review, or approved and in their 30 days) on one banner.
    // `others`: the live answers on the same waypoint, when this one is a correction.
    openForBanner: (bannerId) =>
      db.prepare(`SELECT x.*, (SELECT group_concat(o.answer, ' / ') FROM answers o
          WHERE o.banner_id = x.banner_id AND o.mission_id = x.mission_id AND o.step_index = x.step_index
            AND o.status = 'live' AND o.id != x.id) AS others
        FROM (${REVIEW_SQL} WHERE a.banner_id = ? AND (a.approved_at IS NULL OR a.status = 'pending')) x
        ORDER BY x.mission_index, x.step_index, x.submitted_at`).all(bannerId),
    // Deletes the other live answers on this answer's waypoint (the ones it corrects).
    removeOthers(id) {
      const row = moderation.get(id);
      if (!row) {
        return 0;
      }
      return Number(
        db.prepare("DELETE FROM answers WHERE banner_id = ? AND mission_id = ? AND step_index = ? AND status = 'live' AND id != ?")
          .run(row.banner_id, row.mission_id, row.step_index, id).changes
      );
    },
    // Banners with answers nobody was told about yet, with when the last one came in.
    unnotifiedBanners: () =>
      db.prepare("SELECT banner_id AS bannerId, MAX(submitted_at) AS lastAt, COUNT(*) AS count FROM answers WHERE approved_at IS NULL AND notified_at IS NULL GROUP BY banner_id").all(),
    bannersWithOpenAnswers: () =>
      db.prepare("SELECT DISTINCT banner_id AS bannerId FROM answers WHERE approved_at IS NULL OR status = 'pending' ORDER BY banner_id").all().map((row) => row.bannerId),
    // approve: visible once its 30 days are over; publish: visible now; reject: deleted.
    decide(id, action) {
      const row = moderation.get(id);
      if (!row) {
        return null;
      }
      const at = now();
      if (action === "approve") {
        db.prepare("UPDATE answers SET approved_at = COALESCE(approved_at, ?) WHERE id = ?").run(at, id);
      } else if (action === "publish") {
        db.prepare("UPDATE answers SET approved_at = COALESCE(approved_at, ?), status = 'live', visible_at = MIN(visible_at, ?) WHERE id = ?").run(at, at, id);
      } else if (action === "reject") {
        db.prepare("DELETE FROM answers WHERE id = ?").run(id);
        return { ...row, decided: "reject" };
      } else {
        throw new Error(`Unknown moderation action ${action}`);
      }
      promote();
      return { ...moderation.get(id), decided: action };
    },
    block(scope, key, via) {
      const normalizedKey = scope === "author" ? agentKey(key) : key;
      db.exec("BEGIN");
      try {
        db.prepare("INSERT OR REPLACE INTO blocks (scope, key, via, at) VALUES (?, ?, ?, ?)").run(scope, normalizedKey, via, now());
        const banners = scope === "banner"
          ? [normalizedKey]
          : db.prepare("SELECT banner_id FROM banner_authors WHERE agent = ?").all(normalizedKey).map((row) => row.banner_id);
        let deleted = 0;
        for (const bannerId of banners) {
          deleted += Number(db.prepare("DELETE FROM answers WHERE banner_id = ?").run(bannerId).changes);
        }
        db.exec("COMMIT");
        return { banners: banners.length, deleted };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    unblock(scope, key) {
      return Number(db.prepare("DELETE FROM blocks WHERE scope = ? AND key = ?").run(scope, scope === "author" ? agentKey(key) : key).changes);
    },
    blocks: () => db.prepare("SELECT scope, key, via, at FROM blocks ORDER BY at").all(),
    logContact(agent, channel, bannerId, note) {
      db.prepare("INSERT INTO contact_attempts (agent, banner_id, channel, note, at) VALUES (?, ?, ?, ?, ?)").run(agentKey(agent), bannerId, channel, note, now());
    },
    reviews: {
      create: (bannerId, chatId, items) =>
        Number(db.prepare("INSERT INTO reviews (banner_id, chat_id, items, created_at) VALUES (?, ?, ?, ?)").run(bannerId, chatId, JSON.stringify(items), now()).lastInsertRowid),
      setMessage: (id, messageId) => db.prepare("UPDATE reviews SET message_id = ? WHERE id = ?").run(messageId, id),
      setMode: (id, mode) => db.prepare("UPDATE reviews SET mode = ? WHERE id = ?").run(mode, id),
      markAltRemoved(id, answerId) {
        const review = moderation.reviews.get(id);
        const items = review.items.map((item) => (item.id === answerId ? { ...item, altRemoved: true } : item));
        db.prepare("UPDATE reviews SET items = ? WHERE id = ?").run(JSON.stringify(items), id);
      },
      close: (id) => db.prepare("UPDATE reviews SET closed = 1 WHERE id = ?").run(id),
      get(id) {
        const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id);
        return row ? { ...row, items: JSON.parse(row.items) } : null;
      },
      openFor: (bannerId, chatId) =>
        db.prepare("SELECT * FROM reviews WHERE banner_id = ? AND chat_id = ? AND closed = 0").all(bannerId, chatId).map((row) => ({ ...row, items: JSON.parse(row.items) })),
    },
    getValue: (key) => db.prepare("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? null,
    setValue: (key, value) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, String(value)),
  };

  return { handle, listAnswers, promote, moderation, translations };
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, "too_large", "Request too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export function createPassphraseServer(options = {}) {
  const service = createPassphraseService(options);
  const server = createServer(async (request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith(BASE_PATH)) {
        throw new ApiError(404, "not_found", "Not found.");
      }
      let body = null;
      if (request.method === "POST" || request.method === "PUT") {
        const raw = await readBody(request);
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          throw new ApiError(400, "invalid_json", "Invalid JSON.");
        }
      }
      send(200, await service.handle(request.method, url.pathname.slice(BASE_PATH.length) || "/", request.headers, body));
    } catch (error) {
      if (error instanceof ApiError) {
        send(error.status, { ...error.extra, error: error.code, message: error.message });
      } else {
        process.stderr.write(`passphrases: ${error?.stack ?? error}\n`);
        send(500, { error: "internal", message: "Something went wrong." });
      }
    }
  });
  return { server, service };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.OPENBANNERS_PASSPHRASES_PORT) || 8789;
  const db = openDatabase(process.env.OPENBANNERS_PASSPHRASES_DB || "/var/lib/openbanners/passphrases.sqlite");
  let bot = null;
  const { server, service } = createPassphraseServer({
    db,
    onSubmitted: () => bot?.notifyPending(),
    onTranslationSubmitted: () => bot?.notifyPending(),
    // Comma-separated verified agent names that skip the daily answer limit.
    unlimitedAgents: String(process.env.OPENBANNERS_UNLIMITED_AGENTS ?? "").split(",").map((name) => name.trim()).filter(Boolean),
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`OpenBanners passphrases listening on 127.0.0.1:${port}\n`);
  });
  if (process.env.OPENBANNERS_TELEGRAM_BOT_TOKEN) {
    const { startModerationBot } = await import("./passphrases-telegram.mjs");
    bot = startModerationBot({
      token: process.env.OPENBANNERS_TELEGRAM_BOT_TOKEN,
      moderatorIds: String(process.env.OPENBANNERS_TELEGRAM_MODERATORS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
      siteUrl: process.env.OPENBANNERS_SITE_URL || "https://openbanners.org",
      // Answers for a banner are sent together once it has been quiet this long.
      quietMs: (Number(process.env.OPENBANNERS_TELEGRAM_QUIET_MINUTES) || 15) * 60 * 1000,
      moderation: service.moderation,
      translations: service.translations.moderation,
    });
  }
}
