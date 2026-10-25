import assert from "node:assert/strict";
import { test } from "node:test";
import { createPassphraseService, openDatabase } from "./passphrases.mjs";
import { createModerationBot } from "./passphrases-telegram.mjs";
import { loadI18nSource, MAX_SUGGESTIONS_PER_DAY } from "./translations.mjs";

const MIN = 60 * 1000;
const token = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;

const source = {
  singular: new Set(["Log in", "Hello {name}", "Map", "&copy; {osm} contributors"]),
  plural: new Map([["{count} missions", { one: "{count} mission", other: "{count} missions" }]]),
  locales: {
    nl: { "Log in": "Inloggen", "{count} missions": { one: "{count} missie", other: "{count} missies" } },
    ru: {},
  },
};

function setup({ unlimitedAgents = [], agents = { alice: "Alice", boss: "M1chaeI" } } = {}) {
  let clock = Date.UTC(2026, 9, 25);
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const sub = headers.Authorization ? JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url")).sub : null;
    if (url.endsWith("/user")) {
      return sub ? { ok: true, status: 200, json: async () => (agents[sub] ? { agent: { name: agents[sub] } } : {}) } : { ok: false, status: 401 };
    }
    return { ok: false, status: 404 };
  };
  let notified = 0;
  const service = createPassphraseService({
    db: openDatabase(":memory:"),
    fetchImpl,
    now: () => clock,
    unlimitedAgents,
    i18nSource: source,
    onTranslationSubmitted: () => (notified += 1),
  });
  const as = (sub) => ({ authorization: `Bearer ${token(sub)}` });
  const suggest = (language, body, sub = "alice") => service.handle("POST", `/translations/${language}/suggestions`, as(sub), body);
  return { service, as, suggest, advance: (ms) => (clock += ms), notified: () => notified };
}

test("approved translations are public; suggesting needs a login", async () => {
  const { service } = setup();
  assert.deepEqual((await service.handle("GET", "/translations/nl/approved", {}, null)).overrides, {});
  await assert.rejects(service.handle("GET", "/translations/en/approved", {}, null), { status: 404, code: "unknown_language" });
  await assert.rejects(service.handle("GET", "/translations/xx/approved", {}, null), { status: 404 });
  await assert.rejects(service.handle("POST", "/translations/nl/suggestions", {}, { key: "Log in", text: "Aanmelden" }), { status: 401 });
  await assert.rejects(service.handle("POST", "/translations/nl/suggestions", {}, { key: "Hello {name}", text: "Hallo" }), { status: 400, code: "placeholders_differ" });
});

test("suggestions keep the placeholders, are sane and are real keys", async () => {
  const { suggest } = setup();
  await assert.rejects(suggest("nl", { key: "Hello {name}", text: "Hallo {naam}" }), { status: 400, code: "placeholders_differ" });
  await assert.rejects(suggest("nl", { key: "Hello {name}", text: "Hallo" }), { status: 400, code: "placeholders_differ" });
  await assert.rejects(suggest("nl", { key: "Log in", text: "Inloggen {x}" }), { status: 400, code: "placeholders_differ" });
  await assert.rejects(suggest("nl", { key: "Not a key", text: "Iets" }), { status: 400, code: "unknown_key" });
  await assert.rejects(suggest("nl", { key: "Map", text: "   " }), { status: 400, code: "invalid_length" });
  await assert.rejects(suggest("nl", { key: "Map", text: "x".repeat(200) }), { status: 400, code: "invalid_length" });
  await assert.rejects(suggest("nl", { key: "Map", text: "<b>Kaart</b>" }), { status: 400, code: "invalid_text" });
  await assert.rejects(suggest("nl", { key: "Log in", text: "Inloggen" }), { status: 409, code: "same_as_current" });
  await assert.rejects(suggest("nl", { key: "{count} missions", text: "{count} missies" }), { status: 400, code: "invalid_form" });
  await assert.rejects(suggest("nl", { key: "{count} missions", form: "few", text: "{count} missies" }), { status: 400, code: "invalid_form" });
  const ok = await suggest("nl", { key: "Hello {name}", text: "  Hallo   {name} " });
  assert.equal(ok.suggestion.text, "Hallo {name}");
  assert.equal(ok.suggestion.status, "pending");
  const few = await suggest("ru", { key: "{count} missions", form: "few", text: "{count} миссии" });
  assert.equal(few.suggestion.form, "few");
});

test("the same suggestion twice is one suggestion; the bot is told", async () => {
  const { suggest, notified, as, service } = setup();
  const a = await suggest("nl", { key: "Map", text: "Kaart" });
  const b = await suggest("nl", { key: "Map", text: "Kaart" });
  assert.equal(a.suggestion.id, b.suggestion.id);
  assert.equal(notified(), 1);
  const mine = await service.handle("GET", "/translations/nl/mine", as("alice"), null);
  assert.deepEqual(mine.suggestions.map((s) => [s.key, s.text, s.status]), [["Map", "Kaart", "pending"]]);
  assert.deepEqual((await service.handle("GET", "/translations/nl/mine", as("bob"), null)).suggestions, []);
});

test("a daily limit per account, except the unlimited agents", async () => {
  const { suggest, advance } = setup({ unlimitedAgents: ["m1chaei"] });
  for (let i = 0; i < MAX_SUGGESTIONS_PER_DAY; i += 1) {
    await suggest("nl", { key: "Map", text: `Kaart ${i}` });
  }
  await assert.rejects(suggest("nl", { key: "Map", text: "Kaart X" }), { status: 429 });
  for (let i = 0; i < MAX_SUGGESTIONS_PER_DAY + 5; i += 1) {
    await suggest("nl", { key: "Map", text: `Plattegrond ${i}` }, "boss");
  }
  advance(25 * 60 * MIN);
  assert.ok(await suggest("nl", { key: "Map", text: "Kaart Y" }));
});

test("approved suggestions become overrides, rejected ones never show", async () => {
  const { suggest, service } = setup();
  const a = await suggest("nl", { key: "Map", text: "Kaart" });
  const b = await suggest("nl", { key: "Log in", text: "Aanmelden" });
  const c = await suggest("ru", { key: "{count} missions", form: "many", text: "{count} миссий" });
  const m = service.translations.moderation;
  assert.equal(m.decide(a.suggestion.id, "approve").decided, "approve");
  assert.equal(m.decide(b.suggestion.id, "reject").decided, "reject");
  m.decide(c.suggestion.id, "approve");
  assert.equal(m.decide(a.suggestion.id, "reject").decided, null, "decided once");
  assert.deepEqual((await service.handle("GET", "/translations/nl/approved", {}, null)).overrides, { Map: "Kaart" });
  assert.deepEqual((await service.handle("GET", "/translations/ru/approved", {}, null)).overrides, { "{count} missions": { many: "{count} миссий" } });
  await assert.rejects(suggest("nl", { key: "Map", text: "Kaart" }), { status: 409 }, "now the current translation");
});

function botSetup() {
  const env = setup();
  let clock = Date.UTC(2026, 9, 25);
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
    moderation: env.service.moderation,
    translations: env.service.translations.moderation,
    quietMs: 15 * MIN,
    now: () => Date.UTC(2026, 9, 25) + (clock - Date.UTC(2026, 9, 25)),
    fetchImpl: telegram,
  });
  const advance = (ms) => {
    clock += ms;
    env.advance(ms);
  };
  const sent = () => calls.filter((call) => call.method === "sendMessage");
  const press = (data, message_id, from = 42) =>
    bot.handleUpdate({ callback_query: { id: "q", from: { id: from }, data, message: { message_id, chat: { id: 42 } } } });
  const buttons = (markup) => (markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
  return { ...env, bot, calls, sent, press, buttons, advance };
}

test("the bot sends one message per language after a quiet period, with per-suggestion and all buttons", async () => {
  const { bot, suggest, sent, buttons, advance, press, service, calls } = botSetup();
  await suggest("nl", { key: "Map", text: "Kaart" });
  advance(5 * MIN);
  await suggest("nl", { key: "Hello {name}", text: "Hoi {name}" });
  await suggest("ru", { key: "Map", text: "Карта" });
  await bot.notifyPending();
  assert.equal(sent().length, 0, "not quiet yet");
  advance(15 * MIN);
  await bot.notifyPending();
  await bot.notifyPending();
  assert.equal(sent().length, 2, "one per language");
  const nl = sent().find((call) => /Dutch/.test(call.body.text)).body;
  assert.match(nl.text, /Translations/);
  assert.match(nl.text, /<code>Map<\/code>/);
  assert.match(nl.text, /Now: <i>not translated<\/i>/);
  assert.match(nl.text, /New: <b>Kaart<\/b>/);
  assert.match(nl.text, /by Alice/);
  assert.deepEqual(buttons(nl.reply_markup).filter((b) => b.startsWith("tr:r:")).length, 2);
  const one = buttons(nl.reply_markup).find((b) => /^tr:i:\d+:\d+:a$/.test(b));
  await press(one, 101, 7);
  assert.deepEqual((await service.handle("GET", "/translations/nl/approved", {}, null)).overrides, {}, "only moderators");
  await press(one, 101);
  const approved = (await service.handle("GET", "/translations/nl/approved", {}, null)).overrides;
  assert.equal(Object.keys(approved).length, 1);
  const all = buttons(nl.reply_markup).find((b) => /^tr:r:\d+:r$/.test(b));
  await press(all, 101);
  assert.equal(Object.keys((await service.handle("GET", "/translations/nl/approved", {}, null)).overrides).length, 1, "reject all leaves the approved one");
  const edit = calls.filter((call) => call.method === "editMessageText").pop().body;
  assert.equal(edit.reply_markup, undefined, "nothing left to decide");
  assert.match(edit.text, /1 approved · 1 rejected/);
});

test("new suggestions for a language replace its old message; /pending re-sends", async () => {
  const { bot, suggest, sent, advance, calls } = botSetup();
  await suggest("nl", { key: "Map", text: "Kaart" });
  advance(16 * MIN);
  await bot.notifyPending();
  await suggest("nl", { key: "Log in", text: "Aanmelden" });
  advance(16 * MIN);
  await bot.notifyPending();
  assert.equal(sent().length, 2);
  assert.ok(calls.some((call) => call.method === "deleteMessage" && call.body.message_id === 101));
  assert.match(sent()[1].body.text, /2 suggestions/);
  await bot.handleUpdate({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/pending" } });
  assert.equal(sent().length, 3);
});

test("the real i18n sources load (keys and locales)", () => {
  const real = loadI18nSource();
  assert.ok(real.singular.size > 100);
  assert.ok(real.plural.size > 10);
  assert.ok(real.locales.nl && real.locales.ja);
});
