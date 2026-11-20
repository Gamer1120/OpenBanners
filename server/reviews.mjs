// Banner reviews: a 1-5 star rating plus tags from a fixed list
// (src/reviewTags.mjs), kept in the passphrase service's SQLite file (so the
// nightly backup covers them). Contract:
// - A review is ONLY stars and tag ids: no text field exists, and a body with
//   any other field is refused. One review per Bannergress account and banner;
//   saving again replaces it, DELETE removes it.
// - Reading a banner's summary is public: average, count, stars histogram and
//   tag counts. Nobody sees who reviewed; with a login you also get your own.
// - Writing needs the Bannergress login (identity from passphrases.mjs) and a
//   banner Bannergress knows; at most MAX_REVIEW_WRITES_PER_DAY reviews saved
//   per account per day.
// - "Suggest a tag": a short plain-text name + positive/negative. It is never
//   shown on the site; it goes to the moderators through the passphrase bot
//   (server/reviews-telegram.mjs) with a prompt Michael pastes to Ember to add
//   the tag (docs/review-tags.md). MAX_TAG_SUGGESTIONS_PER_DAY per account.
import { REVIEW_TAGS, REVIEW_TAG_KINDS } from "../src/reviewTags.mjs";

export const MAX_REVIEW_WRITES_PER_DAY = 100;
export const MAX_TAG_SUGGESTIONS_PER_DAY = 5;
export const TAG_NAME_MIN = 2;
export const TAG_NAME_MAX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_FIELDS = new Set(["stars", "tags"]);
const SUGGESTION_FIELDS = new Set(["name", "kind", "bannerId"]);
// Letters, marks, digits, spaces and a little punctuation. No quotes, markup or backticks
// (the name goes into a prompt between double quotes).
const TAG_NAME_PATTERN = /^[\p{L}\p{M}\p{N} '’&/(),.!?+-]+$/u;
const LINK_PATTERN = /https?:|www\.|\.[a-z]{2,}(\/|$|\s)/i;

export class ReviewError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const REVIEW_SCHEMA = `
-- Banner reviews: stars and tag ids only (src/reviewTags.mjs), one per account and banner.
CREATE TABLE IF NOT EXISTS banner_reviews (
  user_id TEXT NOT NULL,
  banner_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, banner_id)
);
CREATE INDEX IF NOT EXISTS banner_reviews_banner ON banner_reviews (banner_id);
CREATE INDEX IF NOT EXISTS banner_reviews_user ON banner_reviews (user_id, updated_at);
-- Suggested new tags, sent to the moderators by the passphrase bot; never shown on the site.
CREATE TABLE IF NOT EXISTS review_tag_suggestions (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent TEXT,
  banner_id TEXT,
  banner_title TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('positive', 'negative')),
  submitted_at INTEGER NOT NULL,
  notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS review_tag_suggestions_user ON review_tag_suggestions (user_id, submitted_at);
`;

const iso = (time) => (Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null);
const parseTags = (text) => {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
};

export const cleanTagName = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// Throws a 400 for anything that isn't { stars: 1-5, tags: [known ids] }; returns the clean review.
export function validateReview(body, tags = REVIEW_TAGS) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ReviewError(400, "invalid_review", "Send the stars and tags of your review.");
  }
  const extra = Object.keys(body).filter((key) => !REVIEW_FIELDS.has(key));
  if (extra.length) {
    throw new ReviewError(400, "unexpected_field", "A review is only stars and tags.");
  }
  if (!Number.isInteger(body.stars) || body.stars < 1 || body.stars > 5) {
    throw new ReviewError(400, "invalid_stars", "Give 1 to 5 stars.");
  }
  const list = body.tags ?? [];
  if (!Array.isArray(list) || list.length > tags.length) {
    throw new ReviewError(400, "invalid_tags", "Tags must be a list of tag ids.");
  }
  const known = new Set(tags.map((tag) => tag.id));
  const clean = [];
  for (const id of list) {
    if (typeof id !== "string" || !known.has(id)) {
      throw new ReviewError(400, "unknown_tag", "One of the tags doesn't exist.");
    }
    if (!clean.includes(id)) {
      clean.push(id);
    }
  }
  // In the list's order, so the same choice is always stored the same way.
  const order = new Map(tags.map((tag, index) => [tag.id, index]));
  clean.sort((a, b) => order.get(a) - order.get(b));
  return { stars: body.stars, tags: clean };
}

// Throws a 400 for a suggestion that can't be right; returns { name, kind, bannerId }.
export function validateSuggestion(body, tags = REVIEW_TAGS) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ReviewError(400, "invalid_suggestion", "Send the tag name and whether it's positive or negative.");
  }
  if (Object.keys(body).some((key) => !SUGGESTION_FIELDS.has(key))) {
    throw new ReviewError(400, "unexpected_field", "A suggestion is only a tag name, positive or negative, and the banner.");
  }
  if (typeof body.name !== "string") {
    throw new ReviewError(400, "invalid_name", `Tag names are ${TAG_NAME_MIN} to ${TAG_NAME_MAX} characters.`);
  }
  const name = cleanTagName(body.name);
  if (name.length < TAG_NAME_MIN || name.length > TAG_NAME_MAX) {
    throw new ReviewError(400, "invalid_name", `Tag names are ${TAG_NAME_MIN} to ${TAG_NAME_MAX} characters.`);
  }
  if (!TAG_NAME_PATTERN.test(name) || LINK_PATTERN.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
    throw new ReviewError(400, "invalid_name", "Use plain words for the tag name: no links, quotes or symbols.");
  }
  if (!REVIEW_TAG_KINDS.includes(body.kind)) {
    throw new ReviewError(400, "invalid_kind", "Say whether the tag is positive or negative.");
  }
  if (tags.some((tag) => tag.label.toLowerCase() === name.toLowerCase())) {
    throw new ReviewError(409, "tag_exists", "That tag already exists.");
  }
  const bannerId = body.bannerId ?? null;
  if (bannerId !== null && (typeof bannerId !== "string" || !/^[^\s/?#]{1,200}$/u.test(bannerId))) {
    throw new ReviewError(400, "invalid_banner", "Invalid banner id.");
  }
  return { name, kind: body.kind, bannerId };
}

// lookupBanner(bannerId) -> Bannergress banner (throws when it doesn't exist).
export function createReviewService({ db, now = () => Date.now(), tags = REVIEW_TAGS, lookupBanner = async () => ({}), onSuggested = () => {} }) {
  db.exec(REVIEW_SCHEMA);
  const known = new Map(tags.map((tag, index) => [tag.id, { ...tag, index }]));

  function summary(bannerId, identity = null) {
    const totals = db.prepare("SELECT COUNT(*) AS count, AVG(stars) AS average FROM banner_reviews WHERE banner_id = ?").get(bannerId);
    const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of db.prepare("SELECT stars, COUNT(*) AS n FROM banner_reviews WHERE banner_id = ? GROUP BY stars").all(bannerId)) {
      histogram[row.stars] = Number(row.n);
    }
    const tagCounts = db
      .prepare("SELECT j.value AS id, COUNT(*) AS n FROM banner_reviews r, json_each(r.tags) j WHERE r.banner_id = ? GROUP BY j.value")
      .all(bannerId)
      .filter((row) => known.has(row.id))
      .map((row) => ({ id: row.id, kind: known.get(row.id).kind, count: Number(row.n) }))
      .sort((a, b) => b.count - a.count || known.get(a.id).index - known.get(b.id).index);
    const count = Number(totals.count);
    let mine = null;
    if (identity) {
      const row = db.prepare("SELECT stars, tags, updated_at FROM banner_reviews WHERE user_id = ? AND banner_id = ?").get(identity.userId, bannerId);
      mine = row ? { stars: row.stars, tags: parseTags(row.tags).filter((id) => known.has(id)), updatedAt: iso(row.updated_at) } : null;
    }
    return {
      bannerId,
      count,
      average: count ? Math.round(Number(totals.average) * 10) / 10 : null,
      stars: histogram,
      tags: tagCounts,
      ...(identity ? { mine } : {}),
    };
  }

  async function save(bannerId, identity, body) {
    const review = validateReview(body, tags);
    const existing = db.prepare("SELECT 1 FROM banner_reviews WHERE user_id = ? AND banner_id = ?").get(identity.userId, bannerId);
    const recent = Number(
      db.prepare("SELECT COUNT(*) AS n FROM banner_reviews WHERE user_id = ? AND updated_at > ? AND banner_id != ?").get(identity.userId, now() - DAY_MS, bannerId).n
    );
    if (recent >= MAX_REVIEW_WRITES_PER_DAY) {
      throw new ReviewError(429, "too_many", "That's a lot of reviews for one day. Try again tomorrow.");
    }
    if (!existing) {
      // Only banners Bannergress knows (a typo'd id would otherwise collect reviews).
      await lookupBanner(bannerId);
    }
    const at = now();
    db.prepare(`INSERT INTO banner_reviews (user_id, banner_id, stars, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, banner_id) DO UPDATE SET stars = excluded.stars, tags = excluded.tags, updated_at = excluded.updated_at`)
      .run(identity.userId, bannerId, review.stars, JSON.stringify(review.tags), at, at);
    return summary(bannerId, identity);
  }

  function remove(bannerId, identity) {
    db.prepare("DELETE FROM banner_reviews WHERE user_id = ? AND banner_id = ?").run(identity.userId, bannerId);
    return summary(bannerId, identity);
  }

  async function suggest(identity, body) {
    const { name, kind, bannerId } = validateSuggestion(body, tags);
    const since = now() - DAY_MS;
    const recent = Number(db.prepare("SELECT COUNT(*) AS n FROM review_tag_suggestions WHERE user_id = ? AND submitted_at > ?").get(identity.userId, since).n);
    if (recent >= MAX_TAG_SUGGESTIONS_PER_DAY) {
      throw new ReviewError(429, "too_many", `You can suggest ${MAX_TAG_SUGGESTIONS_PER_DAY} tags a day. Try again tomorrow.`);
    }
    const same = db
      .prepare("SELECT id FROM review_tag_suggestions WHERE user_id = ? AND lower(name) = lower(?) AND kind = ?")
      .get(identity.userId, name, kind);
    if (same) {
      throw new ReviewError(409, "already_suggested", "You already suggested this tag.");
    }
    let title = null;
    if (bannerId) {
      const banner = await lookupBanner(bannerId).catch(() => null);
      title = typeof banner?.title === "string" ? banner.title.slice(0, 200) : null;
    }
    const id = Number(
      db.prepare(`INSERT INTO review_tag_suggestions (user_id, agent, banner_id, banner_title, name, kind, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(identity.userId, identity.agent ?? null, bannerId, title, name, kind, now()).lastInsertRowid
    );
    try {
      onSuggested();
    } catch {
      // The bot retries every minute; a notice never fails the suggestion.
    }
    return { suggestion: { id, name, kind }, remainingToday: MAX_TAG_SUGGESTIONS_PER_DAY - recent - 1 };
  }

  // Routes under /reviews (undefined: not a review route).
  // identify(authorization) resolves the Bannergress login; checkBannerId throws for bad ids.
  async function handle(method, path, headers, body, identify, checkBannerId) {
    if (path === "/reviews/tags" && method === "GET") {
      return { tags: tags.map(({ id, kind, label }) => ({ id, kind, label })) };
    }
    if (path === "/reviews/tag-suggestions" && method === "POST") {
      // A suggestion that can't be right is refused before asking Bannergress who you are.
      validateSuggestion(body, tags);
      return suggest(await identify(headers.authorization), body);
    }
    const match = /^\/reviews\/banners\/([^/]+)$/.exec(path);
    if (!match || !["GET", "PUT", "DELETE"].includes(method)) {
      return undefined;
    }
    let bannerId = "";
    try {
      bannerId = decodeURIComponent(match[1]);
    } catch {
      bannerId = "";
    }
    checkBannerId(bannerId);
    if (method === "GET") {
      const identity = headers.authorization ? await identify(headers.authorization).catch(() => null) : null;
      return summary(bannerId, identity);
    }
    if (method === "PUT") {
      validateReview(body, tags);
      return save(bannerId, await identify(headers.authorization), body);
    }
    return remove(bannerId, await identify(headers.authorization));
  }

  const notifications = {
    unnotified: () => db.prepare("SELECT * FROM review_tag_suggestions WHERE notified_at IS NULL ORDER BY submitted_at").all(),
    markNotified: (id) => db.prepare("UPDATE review_tag_suggestions SET notified_at = ? WHERE id = ?").run(now(), id),
    recent: (limit = 20) => db.prepare("SELECT * FROM review_tag_suggestions ORDER BY submitted_at DESC LIMIT ?").all(limit),
  };

  return { handle, summary, save, remove, suggest, notifications };
}
