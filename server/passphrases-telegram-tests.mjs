import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { createModerationBot } from "./passphrases-telegram.mjs";

const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const MIN = 60 * 1000;

function setup() {
  let clock = Date.UTC(2026, 9, 23);
  const bannergress = async (url, { headers = {} } = {}) => {
    if (url.endsWith("/user")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    const mission = (id) => ({ id, author: headers.Authorization ? { name: "Maker" } : undefined, steps: [{ objective: "enterPassphrase" }, { objective: "enterPassphrase" }] });
    return { ok: true, status: 200, json: async () => ({ title: "Banner One", missions: { 0: mission("m1"), 1: mission("m2") } }) };
  };
  const service = createPassphraseService({ db: openDatabase(":memory:"), fetchImpl: bannergress, now: () => clock });
  const calls = [];
  let messageId = 100;
  const telegram = async (url, { body }) => {
    const method = url.split("/").pop();
    calls.push({ method, body: JSON.parse(body) });
    return { json: async () => ({ ok: true, result: method === "sendMessage" ? { message_id: ++messageId } : true }) };
  };
  const bot = createModerationBot({
    token: "T",
    moderatorIds: ["42"],
    siteUrl: "https://test.example",
    moderation: service.moderation,
    quietMs: 15 * MIN,
    now: () => clock,
    fetchImpl: telegram,
  });
  const submit = (missionId, stepIndex, text) =>
    service.handle("POST", "/banners/b1/answers", { authorization: `Bearer ${token("alice")}` }, { answers: [{ missionId, stepIndex, kind: "text", text }] });
  const sent = () => calls.filter((call) => call.method === "sendMessage");
  const press = (data, message_id) =>
    bot.handleUpdate({ callback_query: { id: "q", from: { id: 42 }, data, message: { message_id, chat: { id: 42 } } } });
  const buttons = (markup) => (markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
  return { service, bot, calls, submit, sent, press, buttons, advance: (ms) => (clock += ms) };
}

test("answers for one banner become one message, once the banner is quiet", async () => {
  const { bot, submit, sent, buttons, advance } = setup();
  await submit("m1", 0, "Blue");
  advance(5 * MIN);
  await submit("m1", 1, "Red");
  await bot.notifyPending();
  assert.equal(sent().length, 0, "still walking: wait");
  advance(15 * MIN);
  await bot.notifyPending();
  await bot.notifyPending();
  assert.equal(sent().length, 1);
  const { text, reply_markup } = sent()[0].body;
  assert.match(text, /Banner One/);
  assert.match(text, /⏳ 1\.1 {2}<code>Blue<\/code>/);
  assert.match(text, /⏳ 1\.2 {2}<code>Red<\/code>/);
  assert.match(text, /2 to review/);
  assert.equal(buttons(reply_markup).length, 4);
});

test("Approve all keeps Publish all now; Publish all makes them live", async () => {
  const { service, bot, submit, sent, press, buttons, calls, advance } = setup();
  await submit("m1", 0, "Blue");
  await submit("m2", 0, "Green");
  advance(20 * MIN);
  await bot.notifyPending();
  const message = sent()[0];
  const review = buttons(message.body.reply_markup)[0].split(":")[2];
  await press(`pp:r:${review}:a`, 101);
  let edit = calls.filter((c) => c.method === "editMessageText").at(-1).body;
  assert.match(edit.text, /✅ 1\.1 .*visible 2026-11-22/);
  assert.deepEqual(buttons(edit.reply_markup).map((b) => b.split(":").pop()), ["p", "r", "items"]);
  await press(`pp:r:${review}:p`, 101);
  edit = calls.filter((c) => c.method === "editMessageText").at(-1).body;
  assert.match(edit.text, /🚀 1\.1 .*live/);
  assert.equal(edit.reply_markup, undefined);
  assert.equal(service.moderation.openForBanner("b1").length, 0);
});

test("Per answer decides one at a time", async () => {
  const { service, bot, submit, sent, press, buttons, calls, advance } = setup();
  await submit("m1", 0, "Blue");
  await submit("m1", 1, "Spam");
  advance(20 * MIN);
  await bot.notifyPending();
  const review = buttons(sent()[0].body.reply_markup)[0].split(":")[2];
  await press(`pp:r:${review}:items`, 101);
  const perAnswer = calls.filter((c) => c.method === "editMessageText").at(-1).body.reply_markup;
  const reject = buttons(perAnswer).find((b) => b.endsWith(":r") && b.startsWith("pp:i:"));
  const [rows] = [service.moderation.openForBanner("b1")];
  const spam = rows.find((row) => row.answer === "Spam");
  await press(`pp:i:${review}:${spam.id}:r`, 101);
  assert.ok(reject);
  const edit = calls.filter((c) => c.method === "editMessageText").at(-1).body;
  assert.match(edit.text, /🗑 1\.2 {2}<s>Spam<\/s> · rejected/);
  assert.match(edit.text, /⏳ 1\.1/);
  assert.equal(service.moderation.openForBanner("b1").length, 1);
});

test("new answers for a banner replace its old message", async () => {
  const { bot, submit, sent, calls, advance } = setup();
  await submit("m1", 0, "Blue");
  advance(20 * MIN);
  await bot.notifyPending();
  await submit("m2", 1, "Late");
  advance(20 * MIN);
  await bot.notifyPending();
  assert.equal(sent().length, 2);
  assert.equal(calls.find((c) => c.method === "deleteMessage").body.message_id, 101);
  assert.match(sent()[1].body.text, /Blue[\s\S]*Late/);
});

test("old messages and other people can't moderate", async () => {
  const { service, bot, submit, sent, calls, advance } = setup();
  await submit("m1", 0, "Blue");
  advance(20 * MIN);
  await bot.notifyPending();
  await bot.handleUpdate({ callback_query: { id: "q", from: { id: 7 }, data: "pp:r:1:p", message: { message_id: 101, chat: { id: 7 } } } });
  assert.equal(service.moderation.openForBanner("b1").length, 1);
  await bot.handleUpdate({ callback_query: { id: "q", from: { id: 42 }, data: "pp:approve:1", message: { message_id: 5, chat: { id: 42 } } } });
  assert.match(calls.at(-1).body.text, /outdated/);
  assert.equal(sent().length, 1);
});

test("/pending posts a fresh message per banner, and /block clears it", async () => {
  const { service, bot, submit, sent, calls } = setup();
  await submit("m1", 0, "Blue");
  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/pending" } });
  assert.match(sent().at(-1).body.text, /Blue/);
  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/block banner b1" } });
  assert.match(calls.at(-1).body.text, /deleted 1 answers/);
  assert.equal(service.moderation.openForBanner("b1").length, 0);
});

test("anyone else gets the how-to-object text, and the moderator gets their message", async () => {
  const { bot, calls } = setup();
  await bot.handleUpdate({ message: { chat: { id: 5, type: "private" }, from: { id: 5, first_name: "Ann", username: "ann" }, text: "I'm Maker, please remove b1" } });
  assert.equal(calls[0].body.chat_id, "5");
  assert.match(calls[0].body.text, /log in on https:\/\/openbanners.org/);
  assert.equal(calls[1].body.chat_id, "42");
  assert.match(calls[1].body.text, /please remove b1/);
});
