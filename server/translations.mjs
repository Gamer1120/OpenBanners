// Crowd-sourced translation suggestions for the OpenBanners UI, kept in the
// passphrase service's SQLite file (so the nightly backup covers them).
// Contract:
// - The English text is the key (src/i18n/keys.json lists every key; plural
//   keys are the English plural, with one suggestion per plural form).
// - Reading the approved translations is public: the site merges them over the
//   bundled locale (src/i18n/index.js), so they work without a redeploy.
// - Suggesting needs a Bannergress login (the caller passes the identity from
//   passphrases.mjs). A suggestion must keep the English text's {placeholders},
//   have a sane length and no markup; each account may send
//   MAX_SUGGESTIONS_PER_DAY a day, except the unlimited agents.
// - A moderator approves or rejects every suggestion (Telegram bot, one message
//   per language, server/translations-telegram.mjs). Approved ones override the
//   bundled translation; `node scripts/i18n-apply-overrides.mjs` writes them into
//   src/i18n/locales/*.json so they can be committed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_SUGGESTIONS_PER_DAY = 200;
export const MAX_TRANSLATION_LENGTH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

export class TranslationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const placeholdersOf = (text) => [...String(text ?? "").matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

export const TRANSLATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS translation_suggestions (
  id INTEGER PRIMARY KEY,
  language TEXT NOT NULL,
  key TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  previous TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by TEXT NOT NULL,
  submitter_agent TEXT,
  submitted_at INTEGER NOT NULL,
  decided_at INTEGER,
  notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS translation_suggestions_open ON translation_suggestions (status, language);
CREATE INDEX IF NOT EXISTS translation_suggestions_user ON translation_suggestions (submitted_by, submitted_at);
CREATE TABLE IF NOT EXISTS translation_overrides (
  language TEXT NOT NULL,
  key TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  suggestion_id INTEGER,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (language, key, form)
);
-- One Telegram review message per language and moderator (more when it's long).
CREATE TABLE IF NOT EXISTS translation_reviews (
  id INTEGER PRIMARY KEY,
  language TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  items TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

// Where keys.json and locales/ live: next to this file in the Docker image
// (server/i18n), or the repository's src/i18n.
export function findI18nDir(explicit = process.env.OPENBANNERS_I18N_DIR) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, join(here, "i18n"), resolve(here, "../src/i18n")].filter(Boolean);
  return candidates.find((dir) => existsSync(join(dir, "keys.json"))) ?? null;
}

// { singular: Set, plural: Map(other -> { one, other }), locales: { code: entries } }
export function loadI18nSource(dir = findI18nDir()) {
  if (!dir) {
    return { singular: new Set(), plural: new Map(), locales: {} };
  }
  const keys = JSON.parse(readFileSync(join(dir, "keys.json"), "utf8"));
  const locales = {};
  const localeDir = join(dir, "locales");
  if (existsSync(localeDir)) {
    for (const name of readdirSync(localeDir).filter((file) => file.endsWith(".json"))) {
      locales[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(localeDir, name), "utf8"));
    }
  }
  return {
    singular: new Set(keys.singular ?? []),
    plural: new Map((keys.plural ?? []).map((entry) => [entry.other, entry])),
    locales,
  };
}

export function pluralFormsOf(language) {
  try {
    return new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  } catch {
    return ["one", "other"];
  }
}

// Overrides of one language the way the locale files store them:
// { key: "text" } and { pluralKey: { one: "…", other: "…" } }.
export function overridesAsLocale(rows) {
  const out = {};
  for (const row of rows) {
    if (row.form) {
      out[row.key] = { ...(out[row.key] && typeof out[row.key] === "object" ? out[row.key] : {}), [row.form]: row.text };
    } else {
      out[row.key] = row.text;
    }
  }
  return out;
}

export function createTranslationService({ db, source = loadI18nSource(), now = () => Date.now(), unlimitedAgents = [], onSubmitted = () => {} }) {
  db.exec(TRANSLATION_SCHEMA);
  const agentKey = (name) => (typeof name === "string" && name.trim() ? name.trim().toLowerCase() : "");
  const unlimited = new Set(unlimitedAgents.map(agentKey).filter(Boolean));
  const languages = new Set(Object.keys(source.locales).filter((code) => code !== "en"));

  function checkLanguage(language) {
    if (typeof language !== "string" || !LANGUAGE_PATTERN.test(language) || !languages.has(language)) {
      throw new TranslationError(404, "unknown_language", "OpenBanners isn't translated into this language.");
    }
  }

  // The English text a suggestion translates (singular, or one plural form).
  function englishOf(key, form) {
    if (!form) {
      return source.singular.has(key) ? key : null;
    }
    const plural = source.plural.get(key);
    if (!plural) {
      return null;
    }
    return form === "one" ? plural.one : plural.other;
  }

  // What the site shows now: the approved override, else the bundled translation.
  function currentOf(language, key, form) {
    const override = db.prepare("SELECT text FROM translation_overrides WHERE language = ? AND key = ? AND form = ?").get(language, key, form);
    if (override) {
      return override.text;
    }
    const bundled = source.locales[language]?.[key];
    if (form) {
      return bundled && typeof bundled === "object" ? bundled[form] ?? null : null;
    }
    return typeof bundled === "string" && bundled ? bundled : null;
  }

  function approved(language) {
    checkLanguage(language);
    const rows = db.prepare("SELECT key, form, text, approved_at FROM translation_overrides WHERE language = ? ORDER BY key, form").all(language);
    const updated = rows.reduce((max, row) => Math.max(max, row.approved_at), 0);
    return {
      language,
      overrides: overridesAsLocale(rows),
      updatedAt: updated ? new Date(updated).toISOString() : null,
    };
  }

  function mine(language, identity) {
    checkLanguage(language);
    const rows = db.prepare(`SELECT id, key, form, text, status, submitted_at FROM translation_suggestions
      WHERE language = ? AND submitted_by = ? ORDER BY submitted_at DESC LIMIT 500`).all(language, identity.userId);
    return {
      language,
      suggestions: rows.map((row) => ({
        id: row.id,
        key: row.key,
        form: row.form || null,
        text: row.text,
        status: row.status,
        submittedAt: new Date(row.submitted_at).toISOString(),
      })),
    };
  }

  // Throws a 400 when the suggestion can't be right; returns the clean text.
  function validate(language, key, form, text) {
    if (typeof key !== "string" || !key || key.length > 2000) {
      throw new TranslationError(400, "unknown_key", "That text isn't part of OpenBanners.");
    }
    const plural = source.plural.has(key);
    if (plural && !pluralFormsOf(language).includes(form)) {
      throw new TranslationError(400, "invalid_form", "Say which plural form of this language it is.");
    }
    const english = englishOf(key, plural ? form : "");
    if (!english) {
      throw new TranslationError(400, "unknown_key", "That text isn't part of OpenBanners.");
    }
    if (typeof text !== "string") {
      throw new TranslationError(400, "invalid_length", "Send the translation.");
    }
    const clean = text.normalize("NFC").replace(/\s+/g, " ").trim();
    const limit = Math.min(MAX_TRANSLATION_LENGTH, Math.max(60, english.length * 4 + 40));
    if (!clean || clean.length > limit) {
      throw new TranslationError(400, "invalid_length", `Translations must be 1 to ${limit} characters.`);
    }
    if (/[\u0000-\u001f\u007f]/.test(clean) || (/[<>]/.test(clean) && !/[<>]/.test(key))) {
      throw new TranslationError(400, "invalid_text", "Translations can't contain markup.");
    }
    const want = placeholdersOf(key);
    if (placeholdersOf(clean).join() !== want.join()) {
      throw new TranslationError(
        400,
        "placeholders_differ",
        want.length ? `Keep the placeholders exactly as in English: ${want.map((name) => `{${name}}`).join(" ")}` : "This text has no {placeholders}."
      );
    }
    return clean;
  }

  function suggest(language, identity, body) {
    checkLanguage(language);
    const key = body?.key;
    const form = typeof key === "string" && source.plural.has(key) ? String(body?.form ?? "") : "";
    const clean = validate(language, key, form, body?.text);
    const since = now() - DAY_MS;
    const recent = Number(db.prepare("SELECT COUNT(*) AS n FROM translation_suggestions WHERE submitted_by = ? AND submitted_at > ?").get(identity.userId, since).n);
    if (recent >= MAX_SUGGESTIONS_PER_DAY && !unlimited.has(agentKey(identity.agent))) {
      throw new TranslationError(429, "too_many", "That's a lot of suggestions for one day. Try again tomorrow.");
    }
    const current = currentOf(language, key, form);
    if (current === clean) {
      throw new TranslationError(409, "same_as_current", "That's already the translation.");
    }
    const existing = db.prepare("SELECT id FROM translation_suggestions WHERE language = ? AND key = ? AND form = ? AND text = ? AND status = 'pending'").get(language, key, form, clean);
    let id = existing?.id;
    if (!id) {
      id = Number(
        db.prepare(`INSERT INTO translation_suggestions (language, key, form, text, previous, status, submitted_by, submitter_agent, submitted_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(language, key, form, clean, current, identity.userId, identity.agent ?? null, now()).lastInsertRowid
      );
      try {
        onSubmitted();
      } catch {
        // The bot retries on its own; a notice never fails the suggestion.
      }
    }
    return { suggestion: { id, key, form: form || null, text: clean, status: "pending" } };
  }

  // Routes under /translations (undefined: not a translation route).
  // identify(authorization) resolves the Bannergress login.
  async function handle(method, path, headers, body, identify) {
    const match = /^\/translations\/([^/]+)\/(approved|mine|suggestions)$/.exec(path);
    if (!match) {
      return undefined;
    }
    let language = "";
    try {
      language = decodeURIComponent(match[1]);
    } catch {
      language = "";
    }
    if (match[2] === "approved" && method === "GET") {
      return approved(language);
    }
    if (match[2] === "mine" && method === "GET") {
      checkLanguage(language);
      return mine(language, await identify(headers.authorization));
    }
    if (match[2] === "suggestions" && method === "POST") {
      checkLanguage(language);
      return suggest(language, await identify(headers.authorization), body);
    }
    return undefined;
  }

  const ROW_SQL = "SELECT * FROM translation_suggestions";
  const moderation = {
    get: (id) => db.prepare(`${ROW_SQL} WHERE id = ?`).get(id) ?? null,
    english: (row) => englishOf(row.key, row.form),
    current: (row) => currentOf(row.language, row.key, row.form),
    openForLanguage: (language) => db.prepare(`${ROW_SQL} WHERE language = ? AND status = 'pending' ORDER BY key, form, submitted_at`).all(language),
    unnotifiedLanguages: () =>
      db.prepare("SELECT language, MAX(submitted_at) AS lastAt, COUNT(*) AS count FROM translation_suggestions WHERE status = 'pending' AND notified_at IS NULL GROUP BY language").all(),
    languagesWithOpen: () => db.prepare("SELECT DISTINCT language FROM translation_suggestions WHERE status = 'pending' ORDER BY language").all().map((row) => row.language),
    markNotified: (id) => db.prepare("UPDATE translation_suggestions SET notified_at = ? WHERE id = ?").run(now(), id),
    // approve: the site shows it from now on; reject: kept as rejected, never shown.
    decide(id, action) {
      const row = moderation.get(id);
      if (!row) {
        return null;
      }
      if (row.status !== "pending") {
        return { ...row, decided: null };
      }
      const at = now();
      if (action === "approve") {
        db.exec("BEGIN");
        try {
          db.prepare(`INSERT INTO translation_overrides (language, key, form, text, suggestion_id, approved_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (language, key, form) DO UPDATE SET text = excluded.text, suggestion_id = excluded.suggestion_id, approved_at = excluded.approved_at`)
            .run(row.language, row.key, row.form, row.text, row.id, at);
          db.prepare("UPDATE translation_suggestions SET status = 'approved', decided_at = ? WHERE id = ?").run(at, id);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } else if (action === "reject") {
        db.prepare("UPDATE translation_suggestions SET status = 'rejected', decided_at = ? WHERE id = ?").run(at, id);
      } else {
        throw new Error(`Unknown moderation action ${action}`);
      }
      return { ...moderation.get(id), decided: action };
    },
    allOverrides: () => db.prepare("SELECT language, key, form, text FROM translation_overrides ORDER BY language, key, form").all(),
    reviews: {
      create: (language, chatId, items) =>
        Number(db.prepare("INSERT INTO translation_reviews (language, chat_id, items, created_at) VALUES (?, ?, ?, ?)").run(language, chatId, JSON.stringify(items), now()).lastInsertRowid),
      setMessage: (id, messageId) => db.prepare("UPDATE translation_reviews SET message_id = ? WHERE id = ?").run(messageId, id),
      close: (id) => db.prepare("UPDATE translation_reviews SET closed = 1 WHERE id = ?").run(id),
      get(id) {
        const row = db.prepare("SELECT * FROM translation_reviews WHERE id = ?").get(id);
        return row ? { ...row, items: JSON.parse(row.items) } : null;
      },
      openFor: (language, chatId) =>
        db.prepare("SELECT * FROM translation_reviews WHERE language = ? AND chat_id = ? AND closed = 0").all(language, chatId).map((row) => ({ ...row, items: JSON.parse(row.items) })),
    },
  };

  return { handle, approved, suggest, mine, moderation, languages: [...languages].sort() };
}
