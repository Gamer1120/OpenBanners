import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { createModerationBot } from "./passphrases-telegram.mjs";

const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;

function setup() {
  const bannergress = async (url, { headers = {} } = {}) => {
    if (url.endsWith("/user")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        title: "Banner One",
        missions: { 0: { id: "m1", author: headers.Authorization ? { name: "Maker" } : undefined, steps: [{ objective: "enterPassphrase" }] } },
      }),
    };
  };
  const service = createPassphraseService({ db: openDatabase(":memory:"), fetchImpl: bannergress });
  const calls = [];
  const telegram = async (url, { body }) => {
    calls.push({ method: url.split("/").pop(), body: JSON.parse(body) });
    return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const bot = createModerationBot({ token: "T", moderatorIds: ["42"], siteUrl: "https://test.example", moderation: service.moderation, fetchImpl: telegram });
  const submit = (text) =>
    service.handle("POST", "/banners/b1/answers", { authorization: `Bearer ${token("alice")}` }, { answers: [{ missionId: "m1", stepIndex: 0, kind: "text", text }] });
  return { service, bot, calls, submit };
}

test("new typed answers go to the moderator once, with buttons", async () => {
  const { bot, calls, submit } = setup();
  await submit("Blue door");
  await bot.notifyPending();
  await bot.notifyPending();
  const sent = calls.filter((call) => call.method === "sendMessage");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.chat_id, "42");
  assert.match(sent[0].body.text, /Blue door/);
  assert.match(sent[0].body.text, /Authors: maker/);
  assert.deepEqual(sent[0].body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data.split(":")[1]), ["approve", "publish", "reject"]);
});

test("the moderator's buttons decide, and others can't press them", async () => {
  const { service, bot, calls, submit } = setup();
  await submit("Blue door");
  const [row] = service.moderation.awaitingReview();
  await bot.handleUpdate({ callback_query: { id: "q1", from: { id: 7 }, data: `pp:publish:${row.id}`, message: { message_id: 1, chat: { id: 7 } } } });
  assert.equal(service.moderation.get(row.id).status, "pending");
  await bot.handleUpdate({ callback_query: { id: "q2", from: { id: 42 }, data: `pp:publish:${row.id}`, message: { message_id: 1, chat: { id: 42 } } } });
  assert.equal(service.moderation.get(row.id).status, "live");
  assert.match(calls.find((call) => call.method === "editMessageText").body.text, /Published now/);
});

test("commands: pending, block", async () => {
  const { service, bot, calls, submit } = setup();
  await submit("Blue door");
  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/pending" } });
  assert.match(calls.at(-1).body.text, /Blue door/);
  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/block banner b1" } });
  assert.match(calls.at(-1).body.text, /deleted 1 answers/);
  assert.equal(service.moderation.awaitingReview().length, 0);
});

test("anyone else gets the how-to-object text, and the moderator gets their message", async () => {
  const { bot, calls } = setup();
  await bot.handleUpdate({ message: { chat: { id: 5, type: "private" }, from: { id: 5, first_name: "Ann", username: "ann" }, text: "I'm Maker, please remove b1" } });
  assert.equal(calls[0].body.chat_id, "5");
  assert.match(calls[0].body.text, /log in on https:\/\/openbanners.org/);
  assert.equal(calls[1].body.chat_id, "42");
  assert.match(calls[1].body.text, /please remove b1/);
});

test("after Approve, the message keeps Publish now and Reject", async () => {
  const { service, bot, calls, submit } = setup();
  await submit("Blue door");
  const [row] = service.moderation.awaitingReview();
  await bot.handleUpdate({ callback_query: { id: "q1", from: { id: 42 }, data: `pp:approve:${row.id}`, message: { message_id: 1, chat: { id: 42 } } } });
  const edit = calls.find((call) => call.method === "editMessageText").body;
  assert.match(edit.text, /Approved: visible from/);
  assert.deepEqual(edit.reply_markup.inline_keyboard.flat().map((b) => b.callback_data.split(":")[1]), ["publish", "reject"]);
  assert.equal(service.moderation.approvedWaiting().length, 1);

  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/pending" } });
  assert.deepEqual(calls.at(-1).body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data.split(":")[1]), ["publish", "reject"]);

  await bot.handleUpdate({ callback_query: { id: "q2", from: { id: 42 }, data: `pp:publish:${row.id}`, message: { message_id: 1, chat: { id: 42 } } } });
  assert.equal(service.moderation.get(row.id).status, "live");
  assert.equal(calls.filter((call) => call.method === "editMessageText").at(-1).body.reply_markup, undefined);
});
