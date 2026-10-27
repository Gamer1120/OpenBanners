import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import {
  CODE_TTL_MS,
  INVITE_TTL_S,
  createCodeStore,
  createJoinBot,
  createJoinServer,
  createJoinService,
  parseChats,
} from "./telegram-join.mjs";

const CHATS = parseChats("-1001,-1002", "News");
const TOKEN = "eyJ.verified.sig";

// Bannergress stand-in: "verified" has an agent name, "plain" doesn't.
function bannergress(calls = []) {
  return async (url, { headers = {} } = {}) => {
    calls.push({ url, authorization: headers.Authorization });
    assert.equal(url, "https://api.bannergress.com/user");
    if (headers.Authorization === `Bearer ${TOKEN}`) {
      return { ok: true, status: 200, json: async () => ({ agent: { name: "Agent" } }) };
    }
    if (headers.Authorization === "Bearer plain") {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };
}

function setup({ chats = CHATS } = {}) {
  let clock = Date.UTC(2026, 9, 27, 12);
  const now = () => clock;
  const calls = [];
  const service = createJoinService({ fetchImpl: bannergress(calls), now, chats, store: createCodeStore({ now }) });
  return { service, calls, now, advance: (ms) => (clock += ms) };
}

// Telegram stand-in: records every call, makes invite links.
function telegram(failFor = []) {
  const calls = [];
  const fetchImpl = async (url, { body }) => {
    const method = url.split("/").pop();
    const payload = JSON.parse(body);
    calls.push({ method, payload });
    if (method === "createChatInviteLink") {
      if (failFor.includes(payload.chat_id)) {
        return { json: async () => ({ ok: false, description: "Bad Request: not enough rights" }) };
      }
      return { json: async () => ({ ok: true, result: { invite_link: `https://t.me/+link${payload.chat_id}` } }) };
    }
    return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  return { calls, fetchImpl };
}

const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}` });
const dm = (text, id = 4242) => ({ message: { chat: { id, type: "private" }, from: { id, first_name: "Someone" }, text } });

test("status is public and says whether joining is configured", async () => {
  assert.deepEqual(await setup().service.handle("GET", "/status", {}), { enabled: true, bot: "OpenBannersBot" });
  assert.equal((await setup({ chats: [] }).service.handle("GET", "/status", {})).enabled, false);
});

test("a code needs a Bannergress login of a verified agent", async () => {
  const { service, calls } = setup();
  await assert.rejects(service.handle("POST", "/code", {}), { status: 401, code: "login_required" });
  await assert.rejects(service.handle("POST", "/code", { authorization: "Basic x" }), { status: 401 });
  await assert.rejects(service.handle("POST", "/code", auth("expired")), { status: 401 });
  await assert.rejects(service.handle("POST", "/code", auth("plain")), { status: 403, code: "not_verified" });
  await assert.rejects(service.handle("GET", "/code", auth()), { status: 405 });
  assert.ok(calls.every((call) => call.url === "https://api.bannergress.com/user"));
  assert.equal(service.store.size(), 0);
});

test("unconfigured: 401 without a token, not_configured with one, and Bannergress isn't asked", async () => {
  const { service, calls } = setup({ chats: [] });
  await assert.rejects(service.handle("POST", "/code", {}), { status: 401 });
  await assert.rejects(service.handle("POST", "/code", auth()), { status: 503, code: "not_configured" });
  assert.equal(calls.length, 0);
});

test("codes are random, fit Telegram's start parameter, and only their hash is kept", async () => {
  const { service } = setup();
  const first = await service.handle("POST", "/code", auth());
  const second = await service.handle("POST", "/code", auth());
  assert.match(first.code, /^[A-Za-z0-9_-]{32,64}$/);
  assert.ok(Buffer.from(first.code, "base64url").length * 8 >= 128);
  assert.notEqual(first.code, second.code);
  assert.equal(first.url, `https://t.me/OpenBannersBot?start=${first.code}`);
  const stored = JSON.stringify(service.store.dump());
  for (const secret of [first.code, second.code, TOKEN, "Agent"]) {
    assert.ok(!stored.includes(secret), `store must not contain ${secret}`);
  }
  assert.deepEqual(Object.keys(service.store.dump()[0]).sort(), ["expires", "hash", "used"]);
});

test("a code works once, and not after 10 minutes; expired codes are purged", async () => {
  const { service, advance } = setup();
  const { code } = await service.handle("POST", "/code", auth());
  assert.equal(service.store.consume("nope"), "invalid");
  assert.equal(service.store.consume(code.slice(0, -1) + (code.endsWith("A") ? "B" : "A")), "invalid");
  assert.equal(service.store.consume(code), "ok");
  assert.equal(service.store.consume(code), "used");
  const late = await service.handle("POST", "/code", auth());
  advance(CODE_TTL_MS);
  assert.equal(service.store.consume(late.code), "expired");
  assert.equal(service.store.size(), 0);
  await service.handle("POST", "/code", auth());
  assert.equal(service.store.size(), 1);
});

test("/start <code> sends one-person invite links that expire in 15 minutes, once", async () => {
  const { service, now } = setup();
  const { code } = await service.handle("POST", "/code", auth());
  const tg = telegram();
  const bot = createJoinBot({ token: "T", chats: CHATS, store: service.store, fetchImpl: tg.fetchImpl, now });
  await bot.handleUpdate(dm(`/start ${code}`));
  const invites = tg.calls.filter((call) => call.method === "createChatInviteLink");
  assert.deepEqual(invites.map((call) => call.payload.chat_id), ["-1001", "-1002"]);
  for (const { payload } of invites) {
    assert.equal(payload.member_limit, 1);
    assert.equal(payload.expire_date, Math.floor(now() / 1000) + INVITE_TTL_S);
    assert.equal(payload.creates_join_request, undefined);
  }
  const sent = tg.calls.filter((call) => call.method === "sendMessage");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.chat_id, 4242);
  assert.deepEqual(sent[0].payload.reply_markup.inline_keyboard, [
    [{ text: "News", url: "https://t.me/+link-1001" }],
    [{ text: "OpenBanners chat", url: "https://t.me/+link-1002" }],
  ]);
  // Nothing about the Telegram user ends up in the store.
  const stored = JSON.stringify(service.store.dump());
  assert.ok(!stored.includes("4242") && !stored.includes("Someone"));

  tg.calls.length = 0;
  await bot.handleUpdate(dm(`/start ${code}`));
  assert.equal(tg.calls.filter((call) => call.method === "createChatInviteLink").length, 0);
  assert.match(tg.calls[0].payload.text, /already used/);
  assert.match(tg.calls[0].payload.text, /openbanners\.org/);
});

test("expired, unknown and missing codes get pointed to openbanners.org", async () => {
  const { service, now, advance } = setup();
  const { code } = await service.handle("POST", "/code", auth());
  const tg = telegram();
  const bot = createJoinBot({ token: "T", chats: CHATS, store: service.store, fetchImpl: tg.fetchImpl, now });
  advance(CODE_TTL_MS + 1);
  await bot.handleUpdate(dm(`/start ${code}`));
  await bot.handleUpdate(dm("/start garbage"));
  await bot.handleUpdate(dm("/start"));
  await bot.handleUpdate(dm("hello"));
  assert.equal(tg.calls.filter((call) => call.method === "createChatInviteLink").length, 0);
  const texts = tg.calls.map((call) => call.payload.text);
  assert.match(texts[0], /expired/);
  assert.match(texts[1], /isn’t valid/);
  for (const text of texts) {
    assert.match(text, /openbanners\.org/);
    assert.match(text, /Join on Telegram/);
  }
});

test("group and channel messages are ignored", async () => {
  const { service, now } = setup();
  const { code } = await service.handle("POST", "/code", auth());
  const tg = telegram();
  const bot = createJoinBot({ token: "T", chats: CHATS, store: service.store, fetchImpl: tg.fetchImpl, now });
  await bot.handleUpdate({ message: { chat: { id: -1002, type: "supergroup" }, from: { id: 1 }, text: `/start ${code}` } });
  await bot.handleUpdate({ message: { chat: { id: -1001, type: "channel" }, text: "/start" } });
  assert.equal(tg.calls.length, 0);
  assert.equal(service.store.consume(code), "ok");
});

test("when no link can be made, the code stays usable", async () => {
  const { service, now } = setup();
  const { code } = await service.handle("POST", "/code", auth());
  const tg = telegram(["-1001", "-1002"]);
  const bot = createJoinBot({ token: "T", chats: CHATS, store: service.store, fetchImpl: tg.fetchImpl, now });
  await bot.handleUpdate(dm(`/start ${code}`));
  assert.match(tg.calls.at(-1).payload.text, /couldn’t make/);
  assert.equal(service.store.consume(code), "ok");
});

test("being made admin by a listed admin DMs them the chat id; others are ignored", async () => {
  const { service, now } = setup({ chats: [] });
  const tg = telegram();
  const bot = createJoinBot({ token: "T", chats: [], adminIds: ["164274953"], store: service.store, fetchImpl: tg.fetchImpl, now });
  const promoted = (from, rights) => ({
    my_chat_member: {
      chat: { id: -100123, type: "channel", title: "OpenBanners <News>" },
      from: { id: from },
      new_chat_member: { status: "administrator", ...rights },
    },
  });
  await bot.handleUpdate(promoted(999, { can_invite_users: true }));
  assert.equal(tg.calls.length, 0);
  await bot.handleUpdate(promoted(164274953, { can_invite_users: true }));
  assert.equal(tg.calls.length, 1);
  assert.equal(tg.calls[0].payload.chat_id, 164274953);
  assert.match(tg.calls[0].payload.text, /-100123/);
  assert.match(tg.calls[0].payload.text, /OpenBanners &lt;News&gt;/);
  assert.match(tg.calls[0].payload.text, /can invite users/);
  await bot.handleUpdate(promoted(164274953, { can_invite_users: false }));
  assert.match(tg.calls[1].payload.text, /can’t invite users/);
  await bot.handleUpdate({ my_chat_member: { chat: { id: 5, type: "private" }, from: { id: 164274953 }, new_chat_member: { status: "member" } } });
  assert.equal(tg.calls.length, 2);
});

test("the HTTP server answers under the base path only", async () => {
  const { server } = createJoinServer({ chats: [], fetchImpl: bannergress() });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/_openbanners/telegram/v1/code`, { method: "POST" });
    assert.equal(response.status, 401);
    response = await fetch(`${base}/_openbanners/telegram/v1/code`, { method: "POST", headers: auth() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "not_configured");
    response = await fetch(`${base}/_openbanners/telegram/v1/status`);
    assert.deepEqual(await response.json(), { enabled: false, bot: "OpenBannersBot" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    response = await fetch(`${base}/other`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
