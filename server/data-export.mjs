// "Download my data" (⋮ → Settings): everything the passphrase service keeps
// for one signed-in account, as one JSON file. At most one export per account
// per EXPORT_INTERVAL_MS; the time of the last one is kept in the database, so
// the limit survives restarts. Keep SECTIONS in step with every table that
// holds per-account data (server/passphrases.mjs, synced-settings.mjs,
// overlay-backup.mjs, translations.mjs); data-export-tests.mjs checks it.
export const EXPORT_INTERVAL_MS = 60 * 60 * 1000;
export const EXPORT_FORMAT = "openbanners-data-export";

export const DATA_EXPORT_SCHEMA = `
-- When each account last downloaded its data (server/data-export.mjs).
CREATE TABLE IF NOT EXISTS data_exports (
  user_id TEXT PRIMARY KEY,
  last_at INTEGER NOT NULL
);
`;

export class DataExportError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const iso = (time) => (Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null);
const json = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
const agentKey = (name) => (typeof name === "string" && name.trim() ? name.trim().toLowerCase() : "");

// What each section is, for the file's README.
export const README = {
  about:
    "Everything the OpenBanners server (openbanners.org) stores for your Bannergress account, exported at exportedAt. Times are UTC (ISO 8601). Empty lists mean nothing is stored.",
  account: "Your Bannergress account ID (from your sign-in) and your agent name as Bannergress reported it. OpenBanners stores your data under this account ID.",
  syncedSettings:
    "Settings that follow you between devices while you're signed in: language, map filters, Wall/List view, chosen city, closed welcome note and recent plans, each with when it was last changed. Remove them in ⋮ → Settings.",
  overlayBackup:
    "The last settings backup made with \"Back up to OpenBanners\" in the OpenBanners Overlay Android app (overlay, card, route map and compass options), or null. Delete it in ⋮ → Settings.",
  passphraseSettings: "Your passphrase settings (\"Ask after I mark a banner done\"), or null if you never changed them.",
  notes: "Your private banner notes. Only you can read them.",
  plans:
    "Mission Day plans you created. editId is the edit link (openbanners.org/planner/<editId>), viewId the read-only link. Anyone with the edit link can change a plan, so it may contain changes by others.",
  passphraseAnswers:
    "Passphrase answers you sent, with their review status. Live answers are visible to everyone; typed answers were shown to the moderators in a Telegram chat for review.",
  passphraseVotes: "Your confirm/wrong votes on passphrase answers.",
  translationSuggestions: "Translation suggestions you sent in the translation editor, with their review status.",
  author:
    "Only if your agent name is verified on Bannergress: the banners OpenBanners knows you as an author of, your \"never allow passphrases\" choice, and when you saw the notice about answers waiting for your banners.",
  dataExports: "When you last downloaded your data (before this download). Used for the once-an-hour limit.",
  notStoredByOpenBanners: [
    "Your To do, Done and Hide marks and your lists are kept by Bannergress, not by OpenBanners.",
    "Your Bannergress sign-in token is never stored on the server.",
    "Banner Together rooms only exist in the server's memory for at most 4 hours; the lists you compare there are end-to-end encrypted, so nothing of them is stored.",
    "\"Join on Telegram\" codes are kept in memory for 10 minutes and aren't linked to your account.",
    "The web server's request log (IP address, page, time, browser) is kept for about 15 days and isn't linked to your account, so it isn't part of this file.",
    "Everything kept only in your browser (sign-in, recent searches, map position) stays on your device.",
  ],
};

export function createDataExport({ db, now = () => Date.now(), overlayBackups }) {
  db.exec(DATA_EXPORT_SCHEMA);

  function lastExport(userId) {
    return db.prepare("SELECT last_at FROM data_exports WHERE user_id = ?").get(userId)?.last_at ?? null;
  }

  function status(identity) {
    const last = lastExport(identity.userId);
    const next = last ? last + EXPORT_INTERVAL_MS : null;
    return {
      lastExportAt: iso(last),
      nextExportAt: next && next > now() ? iso(next) : null,
      intervalMinutes: EXPORT_INTERVAL_MS / 60000,
    };
  }

  function build(identity, previous) {
    const { userId } = identity;
    const agent = agentKey(identity.agent);
    const synced = db.prepare("SELECT data, enabled, updated_at FROM synced_settings WHERE user_id = ?").get(userId);
    const passphraseSettings = db.prepare("SELECT ask_after_done, updated_at FROM user_settings WHERE user_id = ?").get(userId);
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: iso(now()),
      readme: README,
      account: { bannergressAccountId: userId, agent: identity.agent ?? null },
      syncedSettings: synced
        ? { enabled: Boolean(synced.enabled), updatedAt: iso(synced.updated_at), settings: json(synced.data, {}) }
        : null,
      overlayBackup: overlayBackups.read(userId),
      passphraseSettings: passphraseSettings
        ? { askAfterDone: Boolean(passphraseSettings.ask_after_done), updatedAt: iso(passphraseSettings.updated_at) }
        : null,
      notes: db
        .prepare("SELECT banner_id, text, updated_at FROM banner_notes WHERE user_id = ? ORDER BY updated_at")
        .all(userId)
        .map((row) => ({ bannerId: row.banner_id, text: row.text, updatedAt: iso(row.updated_at) })),
      plans: db
        .prepare("SELECT id, view_id, data, version, created_at, updated_at FROM plans WHERE owner = ? ORDER BY created_at")
        .all(userId)
        .map((row) => ({
          editId: row.id,
          viewId: row.view_id,
          ...json(row.data, {}),
          version: row.version,
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
        })),
      passphraseAnswers: db
        .prepare(`SELECT a.id, a.banner_id, b.title, a.mission_id, a.mission_index, a.step_index, a.kind, a.answer, a.source, a.status,
            a.submitted_at, a.visible_at, a.approved_at, a.submitter_agent
          FROM answers a LEFT JOIN banners b ON b.banner_id = a.banner_id WHERE a.submitted_by = ? ORDER BY a.submitted_at`)
        .all(userId)
        .map((row) => ({
          id: row.id,
          bannerId: row.banner_id,
          bannerTitle: row.title ?? null,
          missionId: row.mission_id,
          missionNumber: row.mission_index + 1,
          waypoint: row.step_index + 1,
          kind: row.kind,
          answer: row.answer,
          source: row.source,
          status: row.status,
          reviewed: row.approved_at !== null,
          agent: row.submitter_agent ?? null,
          submittedAt: iso(row.submitted_at),
          visibleAt: iso(row.visible_at),
        })),
      passphraseVotes: db
        .prepare("SELECT v.answer_id, a.banner_id, v.vote, v.at FROM votes v LEFT JOIN answers a ON a.id = v.answer_id WHERE v.user_id = ? ORDER BY v.at")
        .all(userId)
        .map((row) => ({ answerId: row.answer_id, bannerId: row.banner_id ?? null, vote: row.vote, at: iso(row.at) })),
      translationSuggestions: db
        .prepare(`SELECT id, language, key, form, text, previous, status, submitter_agent, submitted_at, decided_at
          FROM translation_suggestions WHERE submitted_by = ? ORDER BY submitted_at`)
        .all(userId)
        .map((row) => ({
          id: row.id,
          language: row.language,
          english: row.key,
          pluralForm: row.form || null,
          text: row.text,
          previous: row.previous ?? null,
          status: row.status,
          agent: row.submitter_agent ?? null,
          submittedAt: iso(row.submitted_at),
          decidedAt: iso(row.decided_at),
        })),
      author: agent
        ? {
            agent: identity.agent,
            bannersAsAuthor: db
              .prepare("SELECT ba.banner_id, b.title FROM banner_authors ba LEFT JOIN banners b ON b.banner_id = ba.banner_id WHERE ba.agent = ? ORDER BY ba.banner_id")
              .all(agent)
              .map((row) => ({ bannerId: row.banner_id, title: row.title ?? null })),
            neverAllowPassphrases: db
              .prepare("SELECT via, at FROM blocks WHERE scope = 'author' AND key = ?")
              .all(agent)
              .map((row) => ({ via: row.via, at: iso(row.at) }))[0] ?? null,
            noticesSeen: db
              .prepare("SELECT banner_id, channel, note, at FROM contact_attempts WHERE agent = ? ORDER BY at")
              .all(agent)
              .map((row) => ({ bannerId: row.banner_id, channel: row.channel, note: row.note, at: iso(row.at) })),
          }
        : null,
      dataExports: { previousExportAt: iso(previous) },
    };
  }

  // Builds the export and counts it; a second one within the hour is refused.
  function run(identity) {
    const previous = lastExport(identity.userId);
    if (previous && now() - previous < EXPORT_INTERVAL_MS) {
      const next = previous + EXPORT_INTERVAL_MS;
      throw new DataExportError(429, "export_limit", "You can download your data once an hour.", {
        nextExportAt: iso(next),
        lastExportAt: iso(previous),
      });
    }
    const data = build(identity, previous);
    db.prepare(`INSERT INTO data_exports (user_id, last_at) VALUES (?, ?)
      ON CONFLICT (user_id) DO UPDATE SET last_at = excluded.last_at`).run(identity.userId, now());
    return { ...data, dataExports: { ...data.dataExports, nextExportAt: iso(now() + EXPORT_INTERVAL_MS) } };
  }

  return { status, run };
}
