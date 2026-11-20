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
function setup() {
  const clock = { now: Date.UTC(2026, 10, 20, 12) };
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
  const db = openDatabase(":memory:");
  const service = createPassphraseService({ db, fetchImpl, now: () => clock.now, onTagSuggested: () => (suggested += 1), i18nSource: { singular: [], plural: [], locales: {} } });
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
  assert.match(text, /<code>Add the OpenBanners review tag &quot;Muddy &amp; wet&quot; \(negative\) to the test website in all languages\.<\/code>/);
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
  assert.match(calls.at(-1).text, /to the website in all languages/);
});

test("the prompt names the tag, its kind and the site", () => {
  assert.equal(tagPrompt("Muddy paths", "negative", "https://test.openbanners.org"), 'Add the OpenBanners review tag "Muddy paths" (negative) to the test website in all languages.');
  assert.equal(tagPrompt("Benches", "positive", "https://openbanners.org"), 'Add the OpenBanners review tag "Benches" (positive) to the website in all languages.');
  const html = renderTagSuggestion({ name: "Benches", kind: "positive", agent: null, banner_id: "a b", banner_title: null }, "https://x.org");
  assert.match(html, /href="https:\/\/x\.org\/banner\/a%20b"/);
});
