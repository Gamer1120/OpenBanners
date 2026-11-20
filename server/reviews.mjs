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
// - "Suggest a tag": a short plain-text name + positive/negative. It goes to
//   the moderators through the passphrase bot (server/reviews-telegram.mjs)
//   with a prompt Michael pastes to Ember to add the tag
//   (docs/review-tags.md). MAX_TAG_SUGGESTIONS_PER_DAY per account.
// - A suggestion made on a banner is part of the suggester's review there
//   (in_review = 1): only they see it, as a pending tag ("mine.pending"), and
//   it never counts in the public summary. They can drop it like a tag (PUT
//   with "suggestions" leaving it out) and deleting the review drops it too.
// - Approval: the tag's entry in src/reviewTags.mjs lists the suggestion ids
//   (fromSuggestions: [123]). On start, applyApprovedSuggestions() links each
//   listed suggestion (plus unapplied ones with the same name and kind) to the
//   tag and, if it is still in a saved review, adds the tag id to that
//   review. Each suggestion is applied once (tag_id set), so it's idempotent.
import { REVIEW_TAGS, REVIEW_TAG_KINDS } from "../src/reviewTags.mjs";

export const MAX_REVIEW_WRITES_PER_DAY = 100;
export const MAX_TAG_SUGGESTIONS_PER_DAY = 5;
export const TAG_NAME_MIN = 2;
export const TAG_NAME_MAX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUGGESTION_FIELDS = new Set(["name", "kind", "bannerId"]);
const REVIEW_BODY_FIELDS = new Set(["stars", "tags", "suggestions"]);
const MAX_PENDING_PER_REVIEW = 20;
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

// Added later (ALTER TABLE on existing databases): the link to the suggester's review.
// in_review: 1 while it is a pending tag in the suggester's review of banner_id.
// tag_id / applied_at: set once the tag was added (src/reviewTags.mjs fromSuggestions);
// applied_to_review: 1 if the tag went into their review, 0 if that review/tag was gone.
const SUGGESTION_LINK_COLUMNS = {
  in_review: "INTEGER NOT NULL DEFAULT 0",
  tag_id: "TEXT",
  applied_at: "INTEGER",
  applied_to_review: "INTEGER",
};

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
  const extra = Object.keys(body).filter((key) => !REVIEW_BODY_FIELDS.has(key));
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
  // Optional: ids of your own pending suggestions to keep in the review (missing = keep as they are).
  let suggestions;
  if (body.suggestions !== undefined) {
    if (!Array.isArray(body.suggestions) || body.suggestions.length > MAX_PENDING_PER_REVIEW || !body.suggestions.every((id) => Number.isSafeInteger(id) && id > 0)) {
      throw new ReviewError(400, "invalid_suggestions", "Suggestions must be a list of suggestion ids.");
    }
    suggestions = [...new Set(body.suggestions)];
  }
  return { stars: body.stars, tags: clean, ...(suggestions ? { suggestions } : {}) };
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
  const columns = new Set(db.prepare("PRAGMA table_info(review_tag_suggestions)").all().map((column) => column.name));
  for (const [name, type] of Object.entries(SUGGESTION_LINK_COLUMNS)) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE review_tag_suggestions ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS review_tag_suggestions_review ON review_tag_suggestions (user_id, banner_id) WHERE in_review = 1");
  const known = new Map(tags.map((tag, index) => [tag.id, { ...tag, index }]));
  const sortTags = (list) => [...new Set(list)].filter((id) => known.has(id)).sort((a, b) => known.get(a).index - known.get(b).index);

  // Your suggestions still pending in your review of this banner (only ever shown to you).
  const pendingFor = (userId, bannerId) =>
    db
      .prepare("SELECT id, name, kind FROM review_tag_suggestions WHERE user_id = ? AND banner_id = ? AND in_review = 1 AND tag_id IS NULL ORDER BY id")
      .all(userId, bannerId)
      .map((row) => ({ suggestionId: Number(row.id), name: row.name, kind: row.kind }));

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
    let minePending = [];
    if (identity) {
      const row = db.prepare("SELECT stars, tags, updated_at FROM banner_reviews WHERE user_id = ? AND banner_id = ?").get(identity.userId, bannerId);
      minePending = pendingFor(identity.userId, bannerId);
      mine = row ? { stars: row.stars, tags: parseTags(row.tags).filter((id) => known.has(id)), pending: minePending, updatedAt: iso(row.updated_at) } : null;
    }
    return {
      bannerId,
      count,
      average: count ? Math.round(Number(totals.average) * 10) / 10 : null,
      stars: histogram,
      tags: tagCounts,
      // minePending also when you have no saved review yet (a suggestion sent while writing your first one).
      ...(identity ? { mine, minePending } : {}),
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
    let list = review.tags;
    if (review.suggestions) {
      const keep = new Set(review.suggestions);
      const linked = db
        .prepare("SELECT id, in_review, tag_id FROM review_tag_suggestions WHERE user_id = ? AND banner_id = ? AND (in_review = 1 OR tag_id IS NOT NULL)")
        .all(identity.userId, bannerId);
      const drop = db.prepare("UPDATE review_tag_suggestions SET in_review = 0 WHERE id = ?");
      for (const row of linked) {
        if (row.tag_id !== null) {
          // Approved while the form was open: the kept chip is the real tag now.
          if (keep.has(Number(row.id)) && known.has(row.tag_id)) {
            list = sortTags([...list, row.tag_id]);
          }
        } else if (!keep.has(Number(row.id))) {
          drop.run(row.id);
        }
      }
    }
    db.prepare(`INSERT INTO banner_reviews (user_id, banner_id, stars, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, banner_id) DO UPDATE SET stars = excluded.stars, tags = excluded.tags, updated_at = excluded.updated_at`)
      .run(identity.userId, bannerId, review.stars, JSON.stringify(list), at, at);
    return summary(bannerId, identity);
  }

  function remove(bannerId, identity) {
    db.prepare("DELETE FROM banner_reviews WHERE user_id = ? AND banner_id = ?").run(identity.userId, bannerId);
    // A deleted review takes its pending suggestions with it: they won't be added on approval.
    db.prepare("UPDATE review_tag_suggestions SET in_review = 0 WHERE user_id = ? AND banner_id = ? AND in_review = 1").run(identity.userId, bannerId);
    return summary(bannerId, identity);
  }

  // Tags in src/reviewTags.mjs with fromSuggestions: [ids] were added from those suggestions.
  // Links each one (and unapplied suggestions with the same name and kind, e.g. the same tag
  // suggested by several people) to the tag once, and adds the tag to the suggester's review
  // when the suggestion is still in a saved review. Safe to run on every start.
  function applyApprovedSuggestions() {
    const result = { linked: 0, added: 0, skipped: 0 };
    const byId = db.prepare("SELECT * FROM review_tag_suggestions WHERE id = ?");
    const sameName = db.prepare("SELECT * FROM review_tag_suggestions WHERE tag_id IS NULL AND lower(name) = lower(?) AND kind = ?");
    const reviewOf = db.prepare("SELECT tags FROM banner_reviews WHERE user_id = ? AND banner_id = ?");
    const setTags = db.prepare("UPDATE banner_reviews SET tags = ? WHERE user_id = ? AND banner_id = ?");
    const mark = db.prepare("UPDATE review_tag_suggestions SET tag_id = ?, applied_at = ?, applied_to_review = ?, in_review = 0 WHERE id = ? AND tag_id IS NULL");
    db.exec("BEGIN");
    try {
      for (const tag of tags) {
        const ids = Array.isArray(tag.fromSuggestions) ? tag.fromSuggestions.filter((id) => Number.isSafeInteger(id)) : [];
        if (!ids.length) {
          continue;
        }
        const rows = new Map();
        for (const id of ids) {
          const row = byId.get(id);
          if (!row || row.tag_id !== null) {
            continue;
          }
          rows.set(Number(row.id), row);
          for (const same of sameName.all(row.name, row.kind)) {
            rows.set(Number(same.id), same);
          }
        }
        for (const row of rows.values()) {
          let added = 0;
          if (row.in_review === 1 && row.banner_id) {
            const review = reviewOf.get(row.user_id, row.banner_id);
            if (review) {
              const current = parseTags(review.tags);
              if (!current.includes(tag.id)) {
                // Keeps retired ids as they are; known ids in list order.
                const next = [...sortTags([...current.filter((id) => known.has(id)), tag.id]), ...current.filter((id) => !known.has(id))];
                setTags.run(JSON.stringify(next), row.user_id, row.banner_id);
              }
              added = 1;
            }
          }
          if (mark.run(tag.id, now(), added, row.id).changes) {
            result.linked += 1;
            result[added ? "added" : "skipped"] += 1;
          }
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return result;
  }
  const applied = applyApprovedSuggestions();

  async function suggest(identity, body) {
    const { name, kind, bannerId } = validateSuggestion(body, tags);
    const since = now() - DAY_MS;
    const recent = Number(db.prepare("SELECT COUNT(*) AS n FROM review_tag_suggestions WHERE user_id = ? AND submitted_at > ?").get(identity.userId, since).n);
    if (recent >= MAX_TAG_SUGGESTIONS_PER_DAY) {
      throw new ReviewError(429, "too_many", `You can suggest ${MAX_TAG_SUGGESTIONS_PER_DAY} tags a day. Try again tomorrow.`);
    }
    const same = db
      .prepare("SELECT id, banner_id FROM review_tag_suggestions WHERE user_id = ? AND lower(name) = lower(?) AND kind = ?")
      .all(identity.userId, name, kind);
    // The same tag again is only new for another banner's review (the moderators already have it).
    if (same.length && (!bannerId || same.some((row) => (row.banner_id ?? null) === bannerId))) {
      throw new ReviewError(409, "already_suggested", "You already suggested this tag.");
    }
    let title = null;
    if (bannerId) {
      const banner = await lookupBanner(bannerId).catch(() => null);
      title = typeof banner?.title === "string" ? banner.title.slice(0, 200) : null;
    }
    // On a banner, the suggestion is part of your review there (in_review), pending until approved.
    const at = now();
    const id = Number(
      db.prepare(`INSERT INTO review_tag_suggestions (user_id, agent, banner_id, banner_title, name, kind, submitted_at, notified_at, in_review)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(identity.userId, identity.agent ?? null, bannerId, title, name, kind, at, same.length ? at : null, bannerId ? 1 : 0).lastInsertRowid
    );
    if (!same.length) {
      try {
        onSuggested();
      } catch {
        // The bot retries every minute; a notice never fails the suggestion.
      }
    }
    return { suggestion: { id, name, kind, pending: Boolean(bannerId) }, remainingToday: MAX_TAG_SUGGESTIONS_PER_DAY - recent - 1 };
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
    // Ids of every not-yet-added suggestion with this name and kind (all go into one prompt).
    sameTag: (name, kind) =>
      db.prepare("SELECT id FROM review_tag_suggestions WHERE tag_id IS NULL AND lower(name) = lower(?) AND kind = ? ORDER BY id").all(name, kind).map((row) => Number(row.id)),
  };

  return { handle, summary, save, remove, suggest, notifications, applyApprovedSuggestions, applied };
}
