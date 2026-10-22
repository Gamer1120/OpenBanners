// Crowd-sourced passphrase answers, in one small SQLite file (node:sqlite, no
// dependencies). Contract:
// - Reading is public. Submitting, voting and author actions need a Bannergress
//   login: the browser sends its Bannergress access token, which is checked by
//   asking Bannergress `GET /user` and is never stored or logged.
// - "Mission number" answers go live at once. Other answers stay pending and
//   hidden for PENDING_DAYS, unless a banner author approves them sooner.
// - Authors are verified agents (`/user` -> `agent`, set only after Bannergress
//   verification) who authored a mission of the banner. They can add answers
//   (live at once), approve or delete suggestions, and object for one banner or
//   all their banners: that deletes the answers permanently and blocks new ones.
// - Typed crowd answers also need a moderator's approval (Telegram bot,
//   server/passphrases-telegram.mjs): approved ones still wait out the 30 days,
//   "publish now" skips the wait, rejected ones are deleted.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

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
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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

export function createPassphraseService({ db, fetchImpl = fetch, now = () => Date.now(), onSubmitted = () => {} } = {}) {
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
        (SELECT vote FROM votes v WHERE v.answer_id = a.id AND v.user_id = ?) AS my_vote
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
    if (recent + items.length > MAX_ANSWERS_PER_USER_PER_DAY) {
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
        const live = kind === "number" || author;
        const row = insert.get(
          bannerId, mission.id, mission.index, stepIndex, step.poiId, kind, answer, normalized,
          author ? "author" : "crowd", live ? "live" : "pending", identity.userId, at,
          live ? at : at + PENDING_DAYS * DAY_MS,
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

  async function handle(method, path, headers, body) {
    if (path === "/settings" && (method === "GET" || method === "POST")) {
      const identity = await identify(headers.authorization);
      return method === "GET" ? settings(identity) : updateSettings(identity, body);
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
    match = /^\/banners\/([^/]+)\/(answers|author)$/.exec(path);
    if (match && method === "POST") {
      const bannerId = decodeURIComponent(match[1]);
      if (!BANNER_ID_PATTERN.test(bannerId)) {
        throw new ApiError(400, "invalid_banner", "Invalid banner id.");
      }
      const identity = await identify(headers.authorization);
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
    getValue: (key) => db.prepare("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? null,
    setValue: (key, value) => db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, String(value)),
  };

  return { handle, listAnswers, promote, moderation };
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
      if (request.method === "POST") {
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
        send(error.status, { error: error.code, message: error.message });
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
  const { server, service } = createPassphraseServer({ db, onSubmitted: () => bot?.notifyPending() });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`OpenBanners passphrases listening on 127.0.0.1:${port}\n`);
  });
  if (process.env.OPENBANNERS_TELEGRAM_BOT_TOKEN) {
    const { startModerationBot } = await import("./passphrases-telegram.mjs");
    bot = startModerationBot({
      token: process.env.OPENBANNERS_TELEGRAM_BOT_TOKEN,
      moderatorIds: String(process.env.OPENBANNERS_TELEGRAM_MODERATORS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
      siteUrl: process.env.OPENBANNERS_SITE_URL || "https://openbanners.org",
      moderation: service.moderation,
    });
  }
}
