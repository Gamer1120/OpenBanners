import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { createModerationBot } from "./passphrases-telegram.mjs";
import { MAX_REVIEW_WRITES_PER_DAY, MAX_TAG_SUGGESTIONS_PER_DAY, TAG_NAME_MAX, validateReview } from "./reviews.mjs";
import { renderTagSuggestion, tagPrompt } from "./reviews-telegram.mjs";
import { REVIEW_TAGS } from "../src/reviewTags.mjs";

const DAY = 24 * 60 * 60 * 1000;
const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const as = (sub) => ({ authorization: `Bearer ${token(sub)}` });

// Bannergress stand-in: banners b1..b999 exist, "nope" doesn't; alice is the verified agent "Alice".
function setup({ db: existing = null, reviewTags = undefined, clock = { now: Date.UTC(2026, 10, 20, 12) } } = {}) {
  let lookups = 0;
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const sub = headers.Authorization ? JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url")).sub : null;
    if (url.endsWith("/user")) {
      return sub ? { ok: true, status: 200, json: async () => (sub === "alice" ? { agent: { name: "Alice" } } : {}) } : { ok: false, status: 401 };
    }
    const match = /\/bnrs\/(b\d+)$/.exec(url);
    if (match) {
      lookups += 1;
      return { ok: true, status: 200, json: async () => ({ id: match[1], title: `Banner ${match[1]}`, missions: {} }) };
    }
    return { ok: false, status: 404 };
  };
  let suggested = 0;
  const db = existing ?? openDatabase(":memory:");
  const service = createPassphraseService({ db, fetchImpl, now: () => clock.now, reviewTags, onTagSuggested: () => (suggested += 1), i18nSource: { singular: [], plural: [], locales: {} } });
  return { db, service, clock, lookups: () => lookups, suggested: () => suggested };
}

const put = (service, who, bannerId, body) => service.handle("PUT", `/reviews/banners/${bannerId}`, as(who), body);

test("the tag list: unique ids, positive and negative, English labels", () => {
  const ids = REVIEW_TAGS.map((tag) => tag.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const tag of REVIEW_TAGS) {
    assert.match(tag.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(tag.kind === "positive" || tag.kind === "negative", tag.id);
    assert.ok(tag.label && tag.label.length <= 40, tag.id);
  }
  assert.ok(REVIEW_TAGS.some((tag) => tag.kind === "positive"));
  assert.ok(REVIEW_TAGS.some((tag) => tag.kind === "negative"));
});

test("reading is public and shows no reviews at first; writing needs a login", async () => {
  const { service } = setup();
  const empty = await service.handle("GET", "/reviews/banners/b1", {}, null);
  assert.deepEqual(empty, { bannerId: "b1", count: 0, average: null, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, tags: [] });
  await assert.rejects(service.handle("PUT", "/reviews/banners/b1", {}, { stars: 4, tags: [] }), { status: 401 });
  await assert.rejects(service.handle("DELETE", "/reviews/banners/b1", {}, null), { status: 401 });
  await assert.rejects(service.handle("POST", "/reviews/tag-suggestions", {}, { name: "Muddy paths", kind: "negative" }), { status: 401 });
  const tags = await service.handle("GET", "/reviews/tags", {}, null);
  assert.equal(tags.tags.length, REVIEW_TAGS.length);
});

test("stars must be a whole number from 1 to 5", async () => {
  const { service } = setup();
  for (const stars of [0, 6, -1, 3.5, "4", null, undefined, true]) {
    await assert.rejects(put(service, "alice", "b1", { stars, tags: [] }), { status: 400, code: "invalid_stars" }, String(stars));
  }
  for (const stars of [1, 2, 3, 4, 5]) {
    assert.equal((await put(service, "alice", "b1", { stars, tags: [] })).mine.stars, stars);
  }
});

test("unknown tag ids are refused; duplicates count once, in list order", async () => {
  const { service } = setup();
  await assert.rejects(put(service, "alice", "b1", { stars: 4, tags: ["scenic-route", "made-up"] }), { status: 400, code: "unknown_tag" });
  await assert.rejects(put(service, "alice", "b1", { stars: 4, tags: [42] }), { status: 400, code: "unknown_tag" });
  await assert.rejects(put(service, "alice", "b1", { stars: 4, tags: "scenic-route" }), { status: 400, code: "invalid_tags" });
  await assert.rejects(put(service, "alice", "b1", { stars: 4, tags: Array(REVIEW_TAGS.length + 1).fill("scenic-route") }), { status: 400 });
  const saved = await put(service, "alice", "b1", { stars: 4, tags: ["no-shade", "scenic-route", "no-shade"] });
  assert.deepEqual(saved.mine.tags, ["scenic-route", "no-shade"]);
});

test("no text is accepted: any field besides stars and tags is refused", async () => {
  const { service, db } = setup();
  for (const extra of [{ text: "Lovely walk" }, { comment: "x" }, { review: "x" }, { title: "x" }]) {
    await assert.rejects(put(service, "alice", "b1", { stars: 5, tags: [], ...extra }), { status: 400, code: "unexpected_field" });
  }
  await assert.rejects(put(service, "alice", "b1", "Great banner"), { status: 400 });
  await assert.rejects(put(service, "alice", "b1", ["scenic-route"]), { status: 400 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM banner_reviews").get().n, 0);
  // The table has no column that could hold text.
  const columns = db.prepare("PRAGMA table_info(banner_reviews)").all().map((column) => column.name);
  assert.deepEqual(columns, ["user_id", "banner_id", "stars", "tags", "created_at", "updated_at"]);
  assert.throws(() => validateReview({ stars: 3, tags: [], note: "" }), { code: "unexpected_field" });
});

test("one review per account and banner: saving again replaces it, delete removes it", async () => {
  const { service, db } = setup();
  await put(service, "alice", "b1", { stars: 2, tags: ["busy-traffic"] });
  const second = await put(service, "alice", "b1", { stars: 5, tags: ["scenic-route"] });
  assert.equal(second.count, 1);
  assert.equal(second.average, 5);
  assert.deepEqual(second.mine.tags, ["scenic-route"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM banner_reviews WHERE user_id = 'alice'").get().n, 1);
  const removed = await service.handle("DELETE", "/reviews/banners/b1", as("alice"), null);
  assert.equal(removed.count, 0);
  assert.equal(removed.mine, null);
});

test("the summary: average, count, stars and tag counts, most used first; only your own review", async () => {
  const { service } = setup();
  await put(service, "alice", "b1", { stars: 5, tags: ["scenic-route", "nice-landmarks"] });
  await put(service, "bob", "b1", { stars: 4, tags: ["scenic-route", "no-shade"] });
  await put(service, "carol", "b1", { stars: 2, tags: ["no-shade", "scenic-route"] });
  await put(service, "carol", "b2", { stars: 1, tags: ["busy-traffic"] });
  const anonymous = await service.handle("GET", "/reviews/banners/b1", {}, null);
  assert.equal(anonymous.count, 3);
  assert.equal(anonymous.average, 3.7);
  assert.deepEqual(anonymous.stars, { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 });
  assert.deepEqual(anonymous.tags, [
    { id: "scenic-route", kind: "positive", count: 3 },
    { id: "no-shade", kind: "negative", count: 2 },
    { id: "nice-landmarks", kind: "positive", count: 1 },
  ]);
  assert.equal("mine" in anonymous, false);
  assert.ok(!JSON.stringify(anonymous).includes("alice"));
  const bob = await service.handle("GET", "/reviews/banners/b1", as("bob"), null);
  assert.deepEqual(bob.mine.tags, ["scenic-route", "no-shade"]);
  assert.equal(bob.mine.stars, 4);
  // A refused login still gets the public summary.
  const broken = await service.handle("GET", "/reviews/banners/b1", { authorization: "Bearer bad" }, null);
  assert.equal(broken.count, 3);
});

test("retired tags (no longer in the list) aren't counted or shown", async () => {
  const { service, db } = setup();
  await put(service, "alice", "b1", { stars: 3, tags: ["scenic-route"] });
  db.prepare("UPDATE banner_reviews SET tags = '[\"scenic-route\",\"old-tag\"]'").run();
  const summary = await service.handle("GET", "/reviews/banners/b1", as("alice"), null);
  assert.deepEqual(summary.tags.map((tag) => tag.id), ["scenic-route"]);
  assert.deepEqual(summary.mine.tags, ["scenic-route"]);
});

test("only banners Bannergress knows, and valid banner ids", async () => {
  const { service } = setup();
  await assert.rejects(put(service, "alice", "nope", { stars: 3, tags: [] }), { status: 404 });
  await assert.rejects(service.handle("GET", "/reviews/banners/%20bad%20id", {}, null), { status: 400 });
});

test("a review that can't be right is refused before asking Bannergress who you are", async () => {
  const { service } = setup();
  await assert.rejects(service.handle("PUT", "/reviews/banners/b1", {}, { stars: 9 }), { status: 400 });
});

test("reviews are rate-limited per account per day; editing a review doesn't count again", async () => {
  const { service, clock } = setup();
  for (let index = 0; index < MAX_REVIEW_WRITES_PER_DAY; index += 1) {
    await put(service, "alice", `b${index + 1}`, { stars: 3, tags: [] });
  }
  await assert.rejects(put(service, "alice", "b900", { stars: 3, tags: [] }), { status: 429, code: "too_many" });
  // Changing one you already wrote today still works.
  assert.equal((await put(service, "alice", "b1", { stars: 4, tags: [] })).mine.stars, 4);
  // Others aren't affected, and the next day it works again.
  await put(service, "bob", "b900", { stars: 3, tags: [] });
  clock.now += DAY + 1;
  await put(service, "alice", "b900", { stars: 3, tags: [] });
});

test("tag suggestions: name length, plain text, positive/negative, not an existing tag", async () => {
  const { service, suggested } = setup();
  const suggest = (body, who = "alice") => service.handle("POST", "/reviews/tag-suggestions", as(who), body);
  await assert.rejects(suggest({ name: "x", kind: "negative" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: "a".repeat(TAG_NAME_MAX + 1), kind: "negative" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: "   ", kind: "negative" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: 42, kind: "negative" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: "<b>bold</b>", kind: "negative" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: 'Say "hi"', kind: "negative" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: "visit spam.com now", kind: "positive" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: "https://x.y", kind: "positive" }), { status: 400, code: "invalid_name" });
  await assert.rejects(suggest({ name: "Muddy paths", kind: "neutral" }), { status: 400, code: "invalid_kind" });
  await assert.rejects(suggest({ name: "Muddy paths", kind: "negative", text: "more" }), { status: 400, code: "unexpected_field" });
  await assert.rejects(suggest({ name: "scenic ROUTE", kind: "positive" }), { status: 409, code: "tag_exists" });
  assert.equal(suggested(), 0);
  const ok = await suggest({ name: "  Muddy   paths ", kind: "negative", bannerId: "b7" });
  assert.deepEqual(ok.suggestion.name, "Muddy paths");
  assert.equal(ok.suggestion.kind, "negative");
  assert.equal(suggested(), 1);
  assert.ok((await suggest({ name: "a".repeat(TAG_NAME_MAX), kind: "positive" })).suggestion);
  assert.ok((await suggest({ name: "Café-terrassen", kind: "positive" })).suggestion);
  await assert.rejects(suggest({ name: "muddy paths", kind: "negative" }), { status: 409, code: "already_suggested" });
  // Suggestions never show on the site.
  const summary = await service.handle("GET", "/reviews/banners/b7", {}, null);
  assert.ok(!JSON.stringify(summary).includes("Muddy"));
  const tags = await service.handle("GET", "/reviews/tags", {}, null);
  assert.ok(!JSON.stringify(tags).includes("Muddy"));
  // Stored with who and where, for the bot.
  const [row] = service.reviews.notifications.unnotified();
  assert.equal(row.agent, "Alice");
  assert.equal(row.banner_id, "b7");
  assert.equal(row.banner_title, "Banner b7");
});

test("tag suggestions are rate-limited per account per day", async () => {
  const { service, clock } = setup();
  const suggest = (name, who = "bob") => service.handle("POST", "/reviews/tag-suggestions", as(who), { name, kind: "positive" });
  for (let index = 0; index < MAX_TAG_SUGGESTIONS_PER_DAY; index += 1) {
    await suggest(`Tag number ${index}`);
  }
  await assert.rejects(suggest("One too many"), { status: 429, code: "too_many" });
  await suggest("One too many", "alice");
  clock.now += DAY + 1;
  await suggest("One too many");
});

test("the bot sends each suggestion to the moderators with a prompt to copy, once", async () => {
  const { service } = setup();
  const calls = [];
  const telegram = async (url, { body }) => {
    calls.push({ method: url.split("/").pop(), body: JSON.parse(body) });
    return { json: async () => ({ ok: true, result: { message_id: calls.length } }) };
  };
  const bot = createModerationBot({
    token: "T",
    moderatorIds: ["42"],
    siteUrl: "https://test.openbanners.org",
    moderation: service.moderation,
    tagSuggestions: service.reviews.notifications,
    fetchImpl: telegram,
  });
  await service.handle("POST", "/reviews/tag-suggestions", as("alice"), { name: "Muddy & wet", kind: "negative", bannerId: "b3" });
  await bot.notifyPending();
  const sent = calls.filter((call) => call.method === "sendMessage");
  assert.equal(sent.length, 1);
  const { chat_id, text, parse_mode } = sent[0].body;
  assert.equal(chat_id, "42");
  assert.equal(parse_mode, "HTML");
  assert.match(text, /Review tag suggestion/);
  assert.match(text, /Tag: <b>Muddy &amp; wet<\/b> \(👎 negative\)/);
  assert.match(text, /From: Alice/);
  assert.match(text, /<a href="https:\/\/test\.openbanners\.org\/banner\/b3">Banner b3<\/a>/);
  assert.match(text, /Review tag suggestion #1/);
  assert.match(text, /<code>Add the OpenBanners review tag &quot;Muddy &amp; wet&quot; \(negative\) to the test website in all languages\. Suggestion #1\.<\/code>/);
  await bot.notifyPending();
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  // /tags sends them again.
  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/tags" } });
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 2);
});

test("a failed send is retried on the next round", async () => {
  const { service } = setup();
  let fail = true;
  const calls = [];
  const telegram = async (url, { body }) => {
    calls.push(JSON.parse(body));
    return { json: async () => (fail ? { ok: false, description: "chat not found" } : { ok: true, result: { message_id: 1 } }) };
  };
  const bot = createModerationBot({ token: "T", moderatorIds: ["42"], siteUrl: "https://openbanners.org", moderation: service.moderation, tagSuggestions: service.reviews.notifications, fetchImpl: telegram });
  await service.handle("POST", "/reviews/tag-suggestions", as("bob"), { name: "Lots of benches", kind: "positive" });
  await bot.notifyPending();
  assert.equal(service.reviews.notifications.unnotified().length, 1);
  fail = false;
  await bot.notifyPending();
  assert.equal(service.reviews.notifications.unnotified().length, 0);
  assert.match(calls.at(-1).text, /From: unverified agent/);
  assert.match(calls.at(-1).text, /Banner: none/);
  assert.match(calls.at(-1).text, /to the website in all languages\. Suggestion #1\./);
});

test("the prompt names the tag, its kind and the site", () => {
  assert.equal(tagPrompt("Muddy paths", "negative", "https://test.openbanners.org"), 'Add the OpenBanners review tag "Muddy paths" (negative) to the test website in all languages.');
  assert.equal(tagPrompt("Benches", "positive", "https://openbanners.org"), 'Add the OpenBanners review tag "Benches" (positive) to the website in all languages.');
  assert.equal(
    tagPrompt("Muddy paths", "negative", "https://test.openbanners.org", [123]),
    'Add the OpenBanners review tag "Muddy paths" (negative) to the test website in all languages. Suggestion #123.'
  );
  assert.equal(tagPrompt("Benches", "positive", "https://openbanners.org", [4, 9, 4]).endsWith("in all languages. Suggestions #4, #9."), true);
  const html = renderTagSuggestion({ name: "Benches", kind: "positive", agent: null, banner_id: "a b", banner_title: null }, "https://x.org");
  assert.match(html, /href="https:\/\/x\.org\/banner\/a%20b"/);
});

// --- Suggested tags in the suggester's review -------------------------------------------

const suggestOn = (service, who, bannerId, name, kind = "negative") =>
  service.handle("POST", "/reviews/tag-suggestions", as(who), { name, kind, bannerId });
// A restart with the tag added to src/reviewTags.mjs from these suggestions.
const approve = (db, clock, ids, extra = {}) =>
  setup({ db, clock, reviewTags: [...REVIEW_TAGS, { id: "muddy-paths", kind: "negative", label: "Muddy paths", fromSuggestions: ids, ...extra }] });

test("a suggestion made on a banner is a pending tag in your review there, only for you", async () => {
  const { service, db } = setup();
  await put(service, "alice", "b1", { stars: 4, tags: ["scenic-route"] });
  await put(service, "bob", "b1", { stars: 2, tags: [] });
  const { suggestion } = await suggestOn(service, "alice", "b1", "Muddy paths");
  assert.equal(suggestion.pending, true);
  const link = db.prepare("SELECT user_id, banner_id, kind, in_review, tag_id FROM review_tag_suggestions WHERE id = ?").get(suggestion.id);
  assert.deepEqual({ ...link }, { user_id: "alice", banner_id: "b1", kind: "negative", in_review: 1, tag_id: null });
  const alice = await service.handle("GET", "/reviews/banners/b1", as("alice"), null);
  assert.deepEqual(alice.mine.pending, [{ suggestionId: suggestion.id, name: "Muddy paths", kind: "negative" }]);
  assert.deepEqual(alice.minePending, alice.mine.pending);
  assert.deepEqual(alice.mine.tags, ["scenic-route"]);
  // Never in the public counts, never to others.
  for (const view of [await service.handle("GET", "/reviews/banners/b1", {}, null), await service.handle("GET", "/reviews/banners/b1", as("bob"), null)]) {
    assert.ok(!JSON.stringify(view).includes("Muddy"));
    assert.deepEqual(view.tags.map((tag) => tag.id), ["scenic-route"]);
  }
  // Also before you saved a review at all.
  await suggestOn(service, "bob", "b2", "Lots of benches", "positive");
  const bob = await service.handle("GET", "/reviews/banners/b2", as("bob"), null);
  assert.equal(bob.mine, null);
  assert.deepEqual(bob.minePending.map((p) => p.name), ["Lots of benches"]);
});

test("saving your review keeps or drops your pending tags; deleting the review drops them", async () => {
  const { service } = setup();
  await put(service, "alice", "b1", { stars: 4, tags: [] });
  const a = (await suggestOn(service, "alice", "b1", "Muddy paths")).suggestion.id;
  const b = (await suggestOn(service, "alice", "b1", "Lots of benches", "positive")).suggestion.id;
  // Without "suggestions" they stay as they are.
  assert.equal((await put(service, "alice", "b1", { stars: 3, tags: [] })).mine.pending.length, 2);
  // Someone else's or an unknown id changes nothing and adds nothing.
  const kept = await put(service, "alice", "b1", { stars: 3, tags: [], suggestions: [a, 999] });
  assert.deepEqual(kept.mine.pending.map((p) => p.suggestionId), [a]);
  await assert.rejects(put(service, "alice", "b1", { stars: 3, tags: [], suggestions: ["x"] }), { status: 400, code: "invalid_suggestions" });
  assert.equal((await put(service, "bob", "b1", { stars: 3, tags: [], suggestions: [a] })).mine.pending.length, 0);
  assert.ok(b);
  const removed = await service.handle("DELETE", "/reviews/banners/b1", as("alice"), null);
  assert.deepEqual(removed.minePending, []);
  // A new review later doesn't bring it back.
  assert.deepEqual((await put(service, "alice", "b1", { stars: 5, tags: [] })).mine.pending, []);
});

test("approval adds the tag to the suggester's review once, and it counts publicly", async () => {
  const { service, db, clock } = setup();
  await put(service, "alice", "b1", { stars: 4, tags: ["scenic-route", "no-shade"] });
  const id = (await suggestOn(service, "alice", "b1", "Muddy paths")).suggestion.id;
  const updatedAt = db.prepare("SELECT updated_at FROM banner_reviews WHERE user_id = 'alice'").get().updated_at;
  clock.now += 1000;
  const first = approve(db, clock, [id]);
  assert.deepEqual(first.service.reviews.applied, { linked: 1, added: 1, skipped: 0 });
  const mine = await first.service.handle("GET", "/reviews/banners/b1", as("alice"), null);
  assert.deepEqual(mine.mine.tags, ["scenic-route", "no-shade", "muddy-paths"]);
  assert.deepEqual(mine.mine.pending, []);
  const anonymous = await first.service.handle("GET", "/reviews/banners/b1", {}, null);
  assert.ok(anonymous.tags.some((tag) => tag.id === "muddy-paths" && tag.count === 1));
  // Applying doesn't count as a new review write.
  assert.equal(db.prepare("SELECT updated_at FROM banner_reviews WHERE user_id = 'alice'").get().updated_at, updatedAt);
  const row = db.prepare("SELECT tag_id, applied_to_review, in_review FROM review_tag_suggestions WHERE id = ?").get(id);
  assert.deepEqual({ ...row }, { tag_id: "muddy-paths", applied_to_review: 1, in_review: 0 });
  // Idempotent: later starts change nothing, even if alice removed the tag meanwhile.
  await put(first.service, "alice", "b1", { stars: 4, tags: ["scenic-route"] });
  const again = approve(db, clock, [id]);
  assert.deepEqual(again.service.reviews.applied, { linked: 0, added: 0, skipped: 0 });
  assert.deepEqual((await again.service.handle("GET", "/reviews/banners/b1", as("alice"), null)).mine.tags, ["scenic-route"]);
});

test("approval skips a suggestion whose review was deleted or whose pending tag was removed", async () => {
  const { service, db, clock } = setup();
  await put(service, "alice", "b1", { stars: 4, tags: [] });
  await put(service, "bob", "b2", { stars: 3, tags: [] });
  const fromAlice = (await suggestOn(service, "alice", "b1", "Muddy paths")).suggestion.id;
  const fromBob = (await suggestOn(service, "bob", "b2", "Muddy paths")).suggestion.id;
  const fromCarol = (await suggestOn(service, "carol", "b3", "Muddy paths")).suggestion.id; // never saved a review
  await service.handle("DELETE", "/reviews/banners/b1", as("alice"), null);
  await put(service, "alice", "b1", { stars: 2, tags: [] });
  await put(service, "bob", "b2", { stars: 3, tags: [], suggestions: [] });
  const { service: after } = approve(db, clock, [fromAlice, fromBob, fromCarol]);
  assert.deepEqual(after.reviews.applied, { linked: 3, added: 0, skipped: 3 });
  assert.deepEqual((await after.handle("GET", "/reviews/banners/b1", as("alice"), null)).mine.tags, []);
  assert.deepEqual((await after.handle("GET", "/reviews/banners/b2", as("bob"), null)).mine.tags, []);
  assert.equal((await after.handle("GET", "/reviews/banners/b3", {}, null)).count, 0);
});

test("several people suggested the same tag: one approval applies it for each of them", async () => {
  const { service, db, clock } = setup();
  for (const [who, banner] of [["alice", "b1"], ["bob", "b1"], ["carol", "b2"]]) {
    await put(service, who, banner, { stars: 4, tags: [] });
  }
  const a = (await suggestOn(service, "alice", "b1", "Muddy paths")).suggestion.id;
  await suggestOn(service, "bob", "b1", "muddy  PATHS");
  await suggestOn(service, "carol", "b2", "Muddy paths");
  await suggestOn(service, "dave", "b2", "Muddy paths", "positive"); // other kind: not this tag
  assert.deepEqual(service.reviews.notifications.sameTag("Muddy paths", "negative"), [1, 2, 3]);
  // Even a prompt that only named the first suggestion covers the others.
  const { service: after } = approve(db, clock, [a]);
  assert.deepEqual(after.reviews.applied, { linked: 3, added: 3, skipped: 0 });
  const b1 = await after.handle("GET", "/reviews/banners/b1", {}, null);
  assert.deepEqual(b1.tags, [{ id: "muddy-paths", kind: "negative", count: 2 }]);
  assert.deepEqual((await after.handle("GET", "/reviews/banners/b2", {}, null)).tags, [{ id: "muddy-paths", kind: "negative", count: 1 }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_tag_suggestions WHERE tag_id IS NULL").get().n, 1);
});

test("without approval nothing public changes; the same tag on another banner is linked there too, without a second notice", async () => {
  const { service, db, suggested } = setup();
  await put(service, "alice", "b1", { stars: 4, tags: [] });
  await put(service, "alice", "b2", { stars: 4, tags: [] });
  await suggestOn(service, "alice", "b1", "Muddy paths");
  await assert.rejects(suggestOn(service, "alice", "b1", "Muddy paths"), { status: 409, code: "already_suggested" });
  await suggestOn(service, "alice", "b2", "Muddy paths");
  assert.equal(suggested(), 1);
  assert.equal(service.reviews.notifications.unnotified().length, 1);
  // A restart without the tag in the list: nothing applied.
  const { service: later } = setup({ db });
  assert.deepEqual(later.reviews.applied, { linked: 0, added: 0, skipped: 0 });
  assert.deepEqual((await later.handle("GET", "/reviews/banners/b2", as("alice"), null)).mine.pending.map((p) => p.name), ["Muddy paths"]);
  assert.deepEqual((await later.handle("GET", "/reviews/banners/b2", {}, null)).tags, []);
});

test("approved while the form was open: keeping the pending chip keeps the real tag", async () => {
  const { service, db, clock } = setup();
  await put(service, "alice", "b1", { stars: 4, tags: [] });
  const id = (await suggestOn(service, "alice", "b1", "Muddy paths")).suggestion.id;
  const { service: after } = approve(db, clock, [id]);
  const saved = await put(after, "alice", "b1", { stars: 5, tags: [], suggestions: [id] });
  assert.deepEqual(saved.mine.tags, ["muddy-paths"]);
});

test("the bot's prompt lists every suggestion of the same tag, and /tags shows added ones as added", async () => {
  const { service, db, clock } = setup();
  const calls = [];
  const telegram = async (url, { body }) => {
    calls.push(JSON.parse(body));
    return { json: async () => ({ ok: true, result: { message_id: calls.length } }) };
  };
  const bot = createModerationBot({ token: "T", moderatorIds: ["42"], siteUrl: "https://test.openbanners.org", moderation: service.moderation, tagSuggestions: service.reviews.notifications, fetchImpl: telegram });
  await put(service, "alice", "b1", { stars: 4, tags: [] });
  await suggestOn(service, "alice", "b1", "Muddy paths");
  await bot.notifyPending();
  await suggestOn(service, "bob", "b1", "Muddy paths");
  await bot.notifyPending();
  assert.match(calls.at(-1).text, /Review tag suggestion #2/);
  assert.match(calls.at(-1).text, /\(negative\) to the test website in all languages\. Suggestions #1, #2\.<\/code>/);
  const { service: after } = approve(db, clock, [1, 2]);
  const bot2 = createModerationBot({ token: "T", moderatorIds: ["42"], siteUrl: "https://test.openbanners.org", moderation: after.moderation, tagSuggestions: after.reviews.notifications, fetchImpl: telegram });
  await bot2.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/tags" } });
  assert.match(calls.at(-1).text, /✅ Added as <code>muddy-paths<\/code>/);
});
