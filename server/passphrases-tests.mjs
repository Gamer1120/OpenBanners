import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase, PENDING_DAYS } from "./passphrases.mjs";

const DAY = 24 * 60 * 60 * 1000;
const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;

// Bannergress stand-in: two users, one of them the verified author "Maker";
// mission authors are only sent with a login, as on Bannergress.
function setup({ verified = { alice: null, maker: "Maker" } } = {}) {
  let clock = Date.UTC(2026, 9, 22);
  const banner = (auth) => ({
    id: "b1",
    title: "Banner One",
    missions: {
      0: { id: "m1", author: auth ? { name: "Maker" } : undefined, steps: [{ objective: "hack", poi: { id: "p1" } }, { objective: "enterPassphrase", poi: { id: "p2" } }] },
      1: { id: "m2", author: auth ? { name: "Maker" } : undefined, steps: [{ objective: "enterPassphrase", poi: { id: "p3" } }] },
    },
  });
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const sub = headers.Authorization ? JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url")).sub : null;
    if (url.endsWith("/user")) {
      return sub ? { ok: true, status: 200, json: async () => (verified[sub] ? { agent: { name: verified[sub] } } : {}) } : { ok: false, status: 401 };
    }
    if (url.endsWith("/bnrs/b1")) {
      return { ok: true, status: 200, json: async () => banner(Boolean(sub)) };
    }
    return { ok: false, status: 404 };
  };
  const service = createPassphraseService({ db: openDatabase(":memory:"), fetchImpl, now: () => clock });
  const as = (sub) => ({ authorization: `Bearer ${token(sub)}` });
  return { service, as, advance: (ms) => (clock += ms) };
}

test("reading is public, writing needs a login", async () => {
  const { service } = setup();
  assert.deepEqual((await service.handle("GET", "/banners/b1", {}, null)).answers, []);
  await assert.rejects(service.handle("POST", "/banners/b1/answers", {}, { answers: [] }), { status: 401 });
});

test("mission-number answers show as soon as a moderator approves, and can be confirmed", async () => {
  const { service, as } = setup();
  const result = await service.handle("POST", "/banners/b1/answers", as("alice"), {
    answers: [{ missionId: "m2", stepIndex: 0, kind: "number" }],
  });
  assert.equal(result.answers[0].answer, "2");
  assert.equal(result.answers[0].status, "pending");
  assert.equal((await service.handle("GET", "/banners/b1", {}, null)).answers[0].answer, null);
  assert.equal(service.moderation.decide(result.answers[0].id, "approve").status, "live");
  const voted = await service.handle("POST", `/answers/${result.answers[0].id}/vote`, as("bob"), { vote: "confirm" });
  assert.equal(voted.answers[0].confirms, 1);
  assert.equal(voted.answers[0].myVote, "confirm");
});

test("other answers stay hidden for 30 days, then go live", async () => {
  const { service, as, advance } = setup();
  await service.handle("POST", "/banners/b1/answers", as("alice"), {
    answers: [{ missionId: "m1", stepIndex: 1, kind: "text", text: "Blue door" }],
  });
  const anon = await service.handle("GET", "/banners/b1", {}, null);
  assert.equal(anon.answers[0].status, "pending");
  assert.equal(anon.answers[0].answer, null);
  assert.equal((await service.handle("GET", "/banners/b1", as("alice"), null)).answers[0].answer, "Blue door");
  advance(PENDING_DAYS * DAY);
  // 30 days alone isn't enough: a moderator has to approve it too.
  assert.equal((await service.handle("GET", "/banners/b1", {}, null)).answers[0].status, "pending");
  const [waiting] = service.moderation.awaitingReview();
  assert.equal(waiting.answer, "Blue door");
  service.moderation.decide(waiting.id, "approve");
  const later = await service.handle("GET", "/banners/b1", {}, null);
  assert.equal(later.answers[0].status, "live");
  assert.equal(later.answers[0].answer, "Blue door");
});

test("moderation: approve waits out the 30 days, publish shows now, reject deletes", async () => {
  const { service, as, advance } = setup();
  let notified = 0;
  const text = (stepIndex, missionId, value) => ({ missionId, stepIndex, kind: "text", text: value });
  await service.handle("POST", "/banners/b1/answers", as("alice"), { answers: [text(1, "m1", "Blue"), text(0, "m2", "Red")] });
  const [first, second] = service.moderation.unnotified();
  assert.equal(service.moderation.unnotified().length, 2);
  service.moderation.markNotified(first.id);
  assert.equal(service.moderation.unnotified().length, 1);

  assert.equal(service.moderation.decide(first.id, "approve").status, "pending");
  assert.equal(service.moderation.decide(second.id, "publish").status, "live");
  advance(PENDING_DAYS * DAY);
  assert.equal(service.moderation.get(first.id).status, "pending");
  await service.handle("GET", "/banners/b1", {}, null);
  assert.equal(service.moderation.get(first.id).status, "live");

  await service.handle("POST", "/banners/b1/answers", as("bob"), { answers: [text(1, "m1", "Green")] });
  const [third] = service.moderation.awaitingReview();
  assert.equal(service.moderation.decide(third.id, "reject").decided, "reject");
  assert.equal(service.moderation.get(third.id), null);
  assert.equal(notified, 0);
});

test("authors' answers need no moderation, mission numbers do", async () => {
  const { service, as } = setup();
  await service.handle("POST", "/banners/b1/answers", as("maker"), { answers: [{ missionId: "m1", stepIndex: 1, kind: "text", text: "x" }] });
  assert.deepEqual(service.moderation.awaitingReview(), []);
  await service.handle("POST", "/banners/b1/answers", as("alice"), { answers: [{ missionId: "m2", stepIndex: 0, kind: "number" }] });
  assert.deepEqual(service.moderation.awaitingReview().map((row) => row.kind), ["number"]);
});

test("only steps that ask for a passphrase are accepted", async () => {
  const { service, as } = setup();
  await assert.rejects(
    service.handle("POST", "/banners/b1/answers", as("alice"), { answers: [{ missionId: "m1", stepIndex: 0, kind: "number" }] }),
    { code: "not_a_passphrase" }
  );
});

test("the same answer again counts as a confirmation", async () => {
  const { service, as } = setup();
  const answer = { missionId: "m1", stepIndex: 1, kind: "text", text: "Blue door" };
  await service.handle("POST", "/banners/b1/answers", as("alice"), { answers: [answer] });
  const again = await service.handle("POST", "/banners/b1/answers", as("bob"), { answers: [{ ...answer, text: " blue  DOOR " }] });
  assert.equal(again.answers.length, 1);
  assert.equal(again.answers[0].confirms, 1);
});

test("a verified author sees pending answers and can approve them", async () => {
  const { service, as } = setup();
  const { answers } = await service.handle("POST", "/banners/b1/answers", as("alice"), {
    answers: [{ missionId: "m1", stepIndex: 1, kind: "text", text: "Blue door" }],
  });
  const view = await service.handle("GET", "/banners/b1", as("maker"), null);
  assert.equal(view.viewer.isAuthor, true);
  assert.equal(view.answers[0].answer, "Blue door");
  const me = await service.handle("GET", "/me", as("maker"), null);
  assert.equal(me.pending[0].bannerId, "b1");
  const approved = await service.handle("POST", "/banners/b1/author", as("maker"), { action: "approve", answerId: answers[0].id });
  assert.equal(approved.answers[0].status, "live");
  assert.equal((await service.handle("GET", "/banners/b1", {}, null)).answers[0].answer, "Blue door");
});

test("an author's own answers go live at once", async () => {
  const { service, as } = setup();
  const result = await service.handle("POST", "/banners/b1/answers", as("maker"), {
    answers: [{ missionId: "m1", stepIndex: 1, kind: "text", text: "Red" }],
  });
  assert.equal(result.answers[0].status, "live");
  assert.equal(result.answers[0].source, "author");
});

test("someone who isn't a verified author can't act as one", async () => {
  const { service, as } = setup({ verified: { alice: "Somebody", maker: "Maker" } });
  await assert.rejects(service.handle("POST", "/banners/b1/author", as("alice"), { action: "object", scope: "banner" }), { status: 403 });
});

test("an objection deletes the answers and blocks new ones", async () => {
  const { service, as } = setup();
  await service.handle("POST", "/banners/b1/answers", as("alice"), {
    answers: [{ missionId: "m2", stepIndex: 0, kind: "number" }, { missionId: "m1", stepIndex: 1, kind: "text", text: "x" }],
  });
  const after = await service.handle("POST", "/banners/b1/author", as("maker"), { action: "object", scope: "banner" });
  assert.deepEqual(after.answers, []);
  assert.equal(after.blocked, "banner");
  await assert.rejects(
    service.handle("POST", "/banners/b1/answers", as("alice"), { answers: [{ missionId: "m2", stepIndex: 0, kind: "number" }] }),
    { code: "blocked" }
  );
});

test("objecting for all banners blocks by author", async () => {
  const { service, as } = setup();
  await service.handle("POST", "/banners/b1/author", as("maker"), { action: "object", scope: "all" });
  assert.equal((await service.handle("GET", "/banners/b1", {}, null)).blocked, "author");
  assert.equal((await service.handle("GET", "/me", as("maker"), null)).blockedAll, true);
});

test("settings: ask after done, and never allow for my banners", async () => {
  const { service, as } = setup({ verified: { alice: null, maker: "Maker" } });
  assert.equal((await service.handle("GET", "/settings", as("alice"), null)).askAfterDone, true);
  assert.equal((await service.handle("POST", "/settings", as("alice"), { askAfterDone: false })).askAfterDone, false);
  assert.equal((await service.handle("GET", "/settings", as("alice"), null)).canBlockMyBanners, false);
  await assert.rejects(service.handle("POST", "/settings", as("alice"), { blockMyBanners: true }), { code: "not_verified" });

  await service.handle("POST", "/banners/b1/answers", as("alice"), { answers: [{ missionId: "m2", stepIndex: 0, kind: "number" }] });
  const blocked = await service.handle("POST", "/settings", as("maker"), { blockMyBanners: true });
  assert.equal(blocked.blockMyBanners, true);
  const banner = await service.handle("GET", "/banners/b1", {}, null);
  assert.deepEqual(banner.answers, []);
  assert.equal(banner.blocked, "author");
  assert.equal((await service.handle("POST", "/settings", as("maker"), { blockMyBanners: false })).blockMyBanners, false);
});
