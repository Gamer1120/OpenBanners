import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { authorMessage, authorMessageBlocks, createModerationBot } from "./passphrases-telegram.mjs";

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
  assert.equal(buttons(reply_markup).length, 5);
  assert.match(buttons(reply_markup).at(-1), /^pp:m:\d+$/);
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
  assert.deepEqual(buttons(edit.reply_markup).map((b) => b.split(":")[3] ?? "m"), ["p", "r", "items", "m"]);
  await press(`pp:r:${review}:p`, 101);
  edit = calls.filter((c) => c.method === "editMessageText").at(-1).body;
  assert.match(edit.text, /🚀 1\.1 .*live/);
  // All decided: only the author-message button stays.
  assert.deepEqual(buttons(edit.reply_markup), [`pp:m:${review}`]);
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

test("a correction shows the answer it replaces, and the old one can be removed", async () => {
  const { service, bot, submit, sent, press, buttons, calls, advance } = setup();
  await submit("m1", 0, "Blue");
  advance(20 * MIN);
  await bot.notifyPending();
  const first = buttons(sent()[0].body.reply_markup)[0].split(":")[2];
  await press(`pp:r:${first}:p`, 101);

  await submit("m1", 0, "Red");
  advance(20 * MIN);
  await bot.notifyPending();
  const message = sent().at(-1).body;
  assert.match(message.text, /⏳ 1\.1 {2}<code>Red<\/code>\n {6}instead of <code>Blue<\/code>/);
  const review = buttons(message.reply_markup)[0].split(":")[2];
  await press(`pp:r:${review}:items`, 102);
  const red = service.moderation.openForBanner("b1").find((row) => row.answer === "Red");
  assert.ok(buttons(calls.filter((c) => c.method === "editMessageText").at(-1).body.reply_markup).includes(`pp:i:${review}:${red.id}:o`));
  await press(`pp:i:${review}:${red.id}:o`, 102);
  await press(`pp:i:${review}:${red.id}:p`, 102);
  const edit = calls.filter((c) => c.method === "editMessageText").at(-1).body;
  assert.match(edit.text, /🚀 1\.1 {2}<code>Red<\/code> · live\n {6}instead of <code>Blue<\/code> \(removed\)/);
  const banner = await service.handle("GET", "/banners/b1", {}, null);
  assert.deepEqual(banner.answers.map((a) => a.answer), ["Red"]);
});

const command = (bot, text, from = 42) => bot.handleUpdate({ message: { chat: { id: from, type: "private" }, from: { id: from }, text } });

test("/pending shows only answers still to decide on", async () => {
  const { service, bot, submit, sent } = setup();
  await submit("m1", 0, "Blue");
  await submit("m1", 1, "Red");
  await submit("m2", 0, "Green");
  const byAnswer = (answer) => service.moderation.openForBanner("b1").find((row) => row.answer === answer);
  service.moderation.decide(byAnswer("Blue").id, "approve");
  service.moderation.decide(byAnswer("Red").id, "publish");
  await command(bot, "/pending");
  const { text, reply_markup } = sent().at(-1).body;
  assert.match(text, /Green/);
  assert.doesNotMatch(text, /Blue|Red/);
  assert.match(text, /1 answer \(mission\.waypoint\) · 1 to review/);
  assert.ok(reply_markup.inline_keyboard.flat().some((b) => b.text === "✅ Approve all"));

  service.moderation.decide(byAnswer("Green").id, "reject");
  await command(bot, "/pending");
  assert.equal(sent().at(-1).body.text, "Nothing to review. 1 approved answer on 1 banner waiting out the 30 days: /approved");

  await submit("m2", 1, "Yellow");
  service.moderation.decide(byAnswer("Yellow").id, "approve");
  await command(bot, "/pending");
  assert.equal(sent().at(-1).body.text, "Nothing to review. 2 approved answers on 1 banner waiting out the 30 days: /approved");
});

test("/approved lists banners with their date; a banner button posts its answers with Publish now", async () => {
  const { service, bot, submit, sent, press, buttons, calls } = setup();
  await command(bot, "/approved");
  assert.match(sent().at(-1).body.text, /Nothing approved/);
  await submit("m1", 0, "Blue");
  await submit("m2", 1, "Pink");
  await command(bot, "/pending");
  const pendingMessage = sent().at(-1).body;
  const reviewId = buttons(pendingMessage.reply_markup)[0].split(":")[2];
  await press(`pp:r:${reviewId}:a`, 102);
  await submit("m1", 1, "Late");

  await command(bot, "/approved");
  const list = sent().at(-1).body;
  assert.match(list.text, /2 answers on 1 banner/);
  assert.match(list.text, /Banner One<\/a> · 2 answers · visible 2026-11-22/);
  assert.doesNotMatch(list.text, /Late/);
  const [open] = buttons(list.reply_markup);
  assert.match(open, /^pp:ab:\d+$/);

  await press(open, 103);
  const detail = sent().at(-1).body;
  assert.equal(detail.chat_id, "42");
  assert.match(detail.text, /✅ 1\.1 {2}<code>Blue<\/code> · visible 2026-11-22/);
  assert.match(detail.text, /✅ 2\.2 {2}<code>Pink<\/code>/);
  assert.doesNotMatch(detail.text, /Late/);
  assert.deepEqual(buttons(detail.reply_markup).map((b) => b.split(":")[3] ?? "m"), ["p", "r", "items", "m"]);
  // The /pending message for the same banner stays; the two kinds don't replace each other.
  assert.equal(calls.filter((c) => c.method === "deleteMessage").length, 0);

  const detailReview = buttons(detail.reply_markup)[0].split(":")[2];
  await press(`pp:r:${detailReview}:p`, Number(calls.filter((c) => c.method === "sendMessage").length + 100));
  assert.deepEqual(service.moderation.approvedBanners(), []);
  assert.deepEqual(service.moderation.openForBanner("b1", "review").map((row) => row.answer), ["Late"]);
  await press(open, 103);
  assert.match(calls.at(-1).body.text, /Nothing approved is waiting/);
});

test("/live lists recently published answers per banner", async () => {
  const { service, bot, submit, sent, advance } = setup();
  await submit("m1", 0, "Blue");
  await submit("m2", 0, "Green");
  await submit("m1", 1, "Waiting");
  const byAnswer = (answer) => service.moderation.openForBanner("b1").find((row) => row.answer === answer);
  service.moderation.decide(byAnswer("Green").id, "publish");
  service.moderation.decide(byAnswer("Blue").id, "publish");
  service.moderation.decide(byAnswer("Waiting").id, "approve");
  await command(bot, "/live");
  const { text } = sent().at(-1).body;
  assert.match(text, /Live in the last 7 days<\/b> · 2 answers on 1 banner/);
  assert.match(text, /Banner One<\/a> · 2 answers · 2026-10-23\n1\.1 <code>Blue<\/code> · 2\.1 <code>Green<\/code>/);
  assert.doesNotMatch(text, /Waiting/);
  advance(8 * 24 * 60 * MIN);
  await command(bot, "/live");
  assert.equal(sent().at(-1).body.text, "Nothing went live in the last 7 days.");
  await command(bot, "/live 30");
  assert.match(sent().at(-1).body.text, /Live in the last 30 days<\/b> · 2 answers/);
});

test("the new commands are for moderators only, and /help lists them", async () => {
  const { bot, sent } = setup();
  await command(bot, "/approved", 5);
  assert.match(sent()[0].body.text, /This bot handles passphrase answers/);
  await command(bot, "/live", 5);
  assert.ok(sent().filter((call) => call.body.chat_id === "5").every((call) => !/Live in|Nothing went live/.test(call.body.text)));
  await command(bot, "/help");
  assert.match(sent().at(-1).body.text, /\/approved:[\s\S]*\/live \[days\]/);
});

test("✉️ Message to author sends the ready-made text as one plain message, without rejected answers", async () => {
  const { service, bot, submit, sent, press, buttons, calls, advance } = setup();
  await submit("m2", 0, '<Green & "x">');
  await submit("m1", 0, "Blue");
  await submit("m1", 1, "Wrong");
  advance(20 * MIN);
  await bot.notifyPending();
  const review = buttons(sent()[0].body.reply_markup)[0].split(":")[2];
  const wrong = service.moderation.openForBanner("b1").find((row) => row.answer === "Wrong");
  await press(`pp:i:${review}:${wrong.id}:r`, 101);
  const blue = service.moderation.openForBanner("b1").find((row) => row.answer === "Blue");
  await press(`pp:i:${review}:${blue.id}:p`, 101);
  const before = sent().length;

  // Not a moderator: nothing is sent.
  await bot.handleUpdate({ callback_query: { id: "q", from: { id: 7 }, data: `pp:m:${review}`, message: { message_id: 101, chat: { id: 7 } } } });
  assert.equal(calls.at(-1).body.text, "Not allowed.");
  assert.equal(sent().length, before);

  await press(`pp:m:${review}`, 101);
  assert.equal(sent().length, before + 1);
  const { text, chat_id, parse_mode, link_preview_options, reply_markup } = sent().at(-1).body;
  assert.equal(chat_id, "42");
  assert.equal(parse_mode, undefined);
  assert.deepEqual(link_preview_options, { is_disabled: true });
  assert.equal(reply_markup, undefined);
  assert.equal(
    text,
    [
      "Hi! Do you play Ingress? I'm asking because I think you made this banner:",
      "https://test.example/banner/b1",
      "",
      "I run OpenBanners, a site where people can view banners from Bannergress, and I'd like to add the answers to its passphrase missions so more people can complete it.",
      "",
      "Is that okay with you? Just reply \"no\" if you'd rather I didn't, and I won't publish them. If I don't hear back within 30 days, I'll assume it's fine. You can always ask me to remove them later or opt out from having passphrases from this or any of your banners added to OpenBanners.",
      "",
      "These passphrases were submitted:",
      "",
      "Mission 1, passphrase 1: Blue",
      'Mission 2, passphrase 1: <Green & "x">',
    ].join("\n")
  );
  assert.ok(calls.some((c) => c.method === "answerCallbackQuery" && /Long-press the message and choose Copy/.test(c.body.text)));

  // Still works once every answer is decided and the message is closed.
  const green = service.moderation.openForBanner("b1").find((row) => row.answer.startsWith("<Green"));
  await press(`pp:i:${review}:${green.id}:p`, 101);
  assert.equal(service.moderation.reviews.get(Number(review)).closed, 1);
  await press(`pp:m:${review}`, 101);
  assert.equal(sent().length, before + 2);
  assert.match(sent().at(-1).body.text, /Mission 2, passphrase 1: <Green & "x">/);
});

test("author message: passphrase numbers count passphrase steps only, banner URL is encoded", () => {
  const rows = [
    { mission_index: 2, step_index: 0, answer: "5", submitted_at: 2 },
    { mission_index: 1, step_index: 2, answer: "late", submitted_at: 3 },
    { mission_index: 1, step_index: 2, answer: "fixed", submitted_at: 4 },
    { mission_index: 1, step_index: 0, answer: "2", submitted_at: 1 },
  ];
  const missions = [
    { steps: [] },
    { steps: [{ passphrase: true }, { passphrase: false }, { passphrase: true }] },
    { steps: [{ passphrase: true }] },
  ];
  const message = authorMessage("中大校训-8c48", rows, "https://openbanners.org", missions);
  assert.match(message.intro, /^Hi! Do you play Ingress\? I'm asking because I think you made this banner:\nhttps:\/\/openbanners\.org\/banner\/%E4%B8%AD%E5%A4%A7%E6%A0%A1%E8%AE%AD-8c48\n\n/);
  assert.deepEqual(message.answers, ["Mission 2, passphrase 1: 2", "Mission 2, passphrase 2: late / fixed", "Mission 3, passphrase 1: 5"]);
  // Bannergress unavailable: the waypoint number stands in.
  assert.equal(authorMessage("b", rows, "https://x", null).answers[1], "Mission 2, passphrase 3: late / fixed");
  // Too long for one Telegram message: more plain messages, split between lines.
  const many = Array.from({ length: 300 }, (_, i) => ({ mission_index: i, step_index: 0, answer: `answer number ${i}` }));
  const blocks = authorMessageBlocks(authorMessage("b", many, "https://x"));
  assert.ok(blocks.length > 1);
  for (const block of blocks) {
    assert.ok(block.length <= 3800 && !block.includes("<pre>"));
  }
  assert.equal(blocks.join("\n"), authorMessage("b", many, "https://x").intro + many.map((_, i) => `Mission ${i + 1}, passphrase 1: answer number ${i}`).join("\n"));
  assert.match(blocks.at(-1), /Mission 300, passphrase 1: answer number 299$/);
});
