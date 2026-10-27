// "Join on Telegram": invite links for the OpenBanners Telegram channel and
// group, only for people signed in with Bannergress (a verified agent).
//
// Privacy rules (keep them):
// - The site asks POST /_openbanners/telegram/v1/code with the Bannergress
//   access token. The token is checked once with Bannergress `GET /user`
//   (verified agent required) and is never stored or logged; neither is the
//   agent name.
// - The answer is a random one-time code (192 bits, base64url). Only
//   sha256(code), its expiry (10 minutes) and a used flag are kept, in memory.
//   Nothing links a code to the account that asked for it.
// - The bot (@OpenBannersBot, long polling) takes "/start <code>" in a private
//   chat, marks the code used and answers with one invite link per chat, each
//   for one person (member_limit 1) and valid for 15 minutes. It keeps nothing
//   about the Telegram user: no ids, names or logs of them.
// - Setup helper: when a Telegram user listed in OPENBANNERS_JOIN_ADMIN_IDS
//   makes the bot an admin of a channel or group, the bot DMs them the chat's
//   title and id (for OPENBANNERS_JOIN_CHATS). /status (admins only) checks the
//   configured chats.
//
// Environment: OPENBANNERS_JOIN_BOT_TOKEN, OPENBANNERS_JOIN_CHATS (comma-
// separated chat ids: announcement channel, discussion group),
// OPENBANNERS_JOIN_CHAT_LABELS (optional button labels, same order),
// OPENBANNERS_JOIN_ADMIN_IDS, OPENBANNERS_JOIN_PORT (default 8791). Without
// chats the feature is off: /status says so and /code answers 503.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_PATH = "/_openbanners/telegram/v1";
export const CODE_TTL_MS = 10 * 60 * 1000;
export const INVITE_TTL_S = 15 * 60;
const MAX_CODES = 20000;
const BANNERGRESS_API = "https://api.bannergress.com";
const TELEGRAM_API = "https://api.telegram.org";
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const DEFAULT_LABELS = ["OpenBanners announcements", "OpenBanners chat"];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const hashOf = (code) => createHash("sha256").update(code).digest("hex");

export function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// [{ id, label }] from OPENBANNERS_JOIN_CHATS / OPENBANNERS_JOIN_CHAT_LABELS.
export function parseChats(ids, labels) {
  const names = parseList(labels);
  return parseList(ids).map((id, index) => ({ id, label: names[index] || DEFAULT_LABELS[index] || `OpenBanners chat ${index + 1}` }));
}

// One-time codes: only the hash, the expiry and whether it was used.
export function createCodeStore({ now = () => Date.now(), random = randomBytes, ttlMs = CODE_TTL_MS, maxCodes = MAX_CODES } = {}) {
  const codes = new Map();

  function purge() {
    const at = now();
    for (const [hash, row] of codes) {
      if (row.expires <= at) {
        codes.delete(hash);
      }
    }
  }

  return {
    issue() {
      purge();
      if (codes.size >= maxCodes) {
        throw new ApiError(503, "busy", "Too many people are joining right now. Try again in a few minutes.");
      }
      const code = random(24).toString("base64url");
      const expires = now() + ttlMs;
      codes.set(hashOf(code), { expires, used: false });
      return { code, expires };
    },
    // "ok" | "invalid" | "expired" | "used". "ok" marks the code used.
    consume(code) {
      if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
        return "invalid";
      }
      const row = codes.get(hashOf(code));
      if (!row) {
        purge();
        return "invalid";
      }
      if (row.expires <= now()) {
        purge();
        return "expired";
      }
      if (row.used) {
        return "used";
      }
      row.used = true;
      return "ok";
    },
    // Give a code back when no invite link could be made for it.
    release(code) {
      const row = typeof code === "string" ? codes.get(hashOf(code)) : null;
      if (row && row.expires > now()) {
        row.used = false;
      }
    },
    size: () => codes.size,
    // For tests: everything the store holds.
    dump: () => [...codes].map(([hash, row]) => ({ hash, ...row })),
  };
}

export function createJoinService({
  fetchImpl = fetch,
  now = () => Date.now(),
  chats = [],
  botUsername = () => "OpenBannersBot",
  store = createCodeStore({ now }),
} = {}) {
  const enabled = () => chats.length > 0;

  // Same check as server/passphrases.mjs, without any cache: Bannergress says
  // whose token it is; a verified agent is required. Nothing is kept.
  async function requireVerifiedAgent(authorization) {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "");
    if (!match) {
      throw new ApiError(401, "login_required", "Log in with Bannergress first.");
    }
    let response;
    try {
      response = await fetchImpl(`${BANNERGRESS_API}/user`, { headers: { Authorization: `Bearer ${match[1]}` } });
    } catch {
      throw new ApiError(502, "bannergress_unavailable", "Bannergress didn't answer. Try again later.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(401, "login_required", "Your Bannergress login has expired. Log in again.");
    }
    if (!response.ok) {
      throw new ApiError(502, "bannergress_unavailable", "Bannergress didn't answer. Try again later.");
    }
    const user = await response.json().catch(() => null);
    if (typeof user?.agent?.name !== "string" || !user.agent.name) {
      throw new ApiError(403, "not_verified", "Verify your agent name on Bannergress first.");
    }
  }

  async function handle(method, path, headers = {}) {
    if (method === "GET" && path === "/status") {
      return { enabled: enabled(), bot: botUsername() };
    }
    if (path === "/code") {
      if (method !== "POST") {
        throw new ApiError(405, "method_not_allowed", "Use POST.");
      }
      if (!headers.authorization) {
        throw new ApiError(401, "login_required", "Log in with Bannergress first.");
      }
      if (!enabled()) {
        throw new ApiError(503, "not_configured", "Joining on Telegram isn't available yet.");
      }
      await requireVerifiedAgent(headers.authorization);
      const { code, expires } = store.issue();
      const bot = botUsername();
      return { code, bot, url: `https://t.me/${bot}?start=${code}`, expiresAt: expires };
    }
    throw new ApiError(404, "not_found", "Not found.");
  }

  return { handle, store, enabled };
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

export function createJoinBot({
  token,
  chats = [],
  adminIds = [],
  siteUrl = "https://openbanners.org",
  store,
  fetchImpl = fetch,
  now = () => Date.now(),
  log = () => {},
}) {
  const admins = new Set(adminIds.map(String));
  const site = siteUrl.replace(/\/+$/, "");
  const howTo =
    `Sign in with Bannergress on <a href="${escapeHtml(site)}/">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a>, ` +
    "open the menu (⋮ at the top right) and choose <b>Join on Telegram</b>. Its button brings you back here with your personal invite.";

  async function api(method, body) {
    const response = await fetchImpl(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!result?.ok) {
      throw new Error(`Telegram ${method} failed: ${result?.description ?? response.status}`);
    }
    return result.result;
  }

  const send = (chatId, text, extra = {}) =>
    api("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

  async function invite(chatId, code) {
    if (!chats.length) {
      await send(chatId, "Joining on Telegram isn’t open yet. Please try again later.");
      return;
    }
    const state = store.consume(code);
    if (state !== "ok") {
      const why = {
        invalid: "This invite code isn’t valid.",
        expired: "This invite code has expired (codes last 10 minutes).",
        used: "This invite code was already used.",
      }[state];
      await send(chatId, `${why} To get a new one: ${howTo}`);
      return;
    }
    const expireDate = Math.floor(now() / 1000) + INVITE_TTL_S;
    const links = [];
    for (const chat of chats) {
      try {
        const link = await api("createChatInviteLink", {
          chat_id: chat.id,
          name: "openbanners.org",
          member_limit: 1,
          expire_date: expireDate,
        });
        links.push({ label: chat.label, url: link.invite_link });
      } catch (error) {
        log(`invite link for a configured chat failed: ${error.message}`);
      }
    }
    if (!links.length) {
      store.release(code);
      await send(chatId, "Sorry, I couldn’t make your invite links right now. Try the same button again in a few minutes.");
      return;
    }
    const missing = links.length < chats.length ? "\n\nOne of the links couldn’t be made right now; get a new code later for the rest." : "";
    await send(
      chatId,
      "Welcome to OpenBanners! 🎉 Here are your personal invite links. Each one works once and expires in 15 minutes, " +
        "so tap them now and don’t pass them on." +
        missing,
      { reply_markup: { inline_keyboard: links.map((link) => [{ text: link.label, url: link.url }]) } }
    );
  }

  async function status(chatId) {
    if (!chats.length) {
      await send(chatId, "No chats configured yet (OPENBANNERS_JOIN_CHATS).");
      return;
    }
    const me = await api("getMe", {});
    const lines = [];
    for (const chat of chats) {
      try {
        const info = await api("getChat", { chat_id: chat.id });
        const member = await api("getChatMember", { chat_id: chat.id, user_id: me.id });
        const ok = member.status === "administrator" && Boolean(member.can_invite_users);
        lines.push(
          `${ok ? "✅" : "⚠️"} ${escapeHtml(chat.label)}: ${escapeHtml(info.title)} (<code>${escapeHtml(chat.id)}</code>), ${ok ? "can invite" : "can’t invite users"}`
        );
      } catch (error) {
        lines.push(`⚠️ ${escapeHtml(chat.label)} (<code>${escapeHtml(chat.id)}</code>): ${escapeHtml(error.message)}`);
      }
    }
    await send(chatId, lines.join("\n"));
  }

  async function onMessage(message) {
    // Only private chats; the bot says nothing in the channel or group.
    if (message.chat?.type !== "private" || typeof message.text !== "string") {
      return;
    }
    const text = message.text.trim();
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start?.[1]) {
      await invite(message.chat.id, start[1]);
      return;
    }
    if (/^\/status(?:@\w+)?$/.test(text) && admins.has(String(message.from?.id))) {
      await status(message.chat.id);
      return;
    }
    await send(message.chat.id, `Hi! I hand out invite links for the OpenBanners Telegram channel and group. ${howTo}`);
  }

  // The bot was made admin somewhere by one of the admins: tell them the chat
  // id for OPENBANNERS_JOIN_CHATS. The user id is only compared, never kept.
  async function onMyChatMember(update) {
    const member = update.new_chat_member;
    if (!["channel", "group", "supergroup"].includes(update.chat?.type) || member?.status !== "administrator") {
      return;
    }
    if (!admins.has(String(update.from?.id))) {
      return;
    }
    const canInvite = Boolean(member.can_invite_users);
    const configured = chats.some((chat) => chat.id === String(update.chat.id));
    await send(
      update.from.id,
      [
        `🔧 I’m now an admin of the ${escapeHtml(update.chat.type)} <b>${escapeHtml(update.chat.title)}</b>.`,
        `Chat id: <code>${escapeHtml(update.chat.id)}</code>`,
        canInvite ? "✅ I can invite users via link." : "⚠️ I can’t invite users yet: give me the “Invite users via link” right.",
        configured
          ? "It’s already in OPENBANNERS_JOIN_CHATS."
          : "Add the id to OPENBANNERS_JOIN_CHATS (channel first, then group) and restart the container.",
      ].join("\n")
    ).catch((error) => log(`couldn’t tell the admin about a new chat: ${error.message}`));
  }

  async function handleUpdate(update) {
    if (update.message) {
      await onMessage(update.message);
    } else if (update.my_chat_member) {
      await onMyChatMember(update.my_chat_member);
    }
  }

  let stopped = false;
  async function poll() {
    let offset = 0;
    while (!stopped) {
      try {
        const updates = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "my_chat_member"] });
        for (const update of updates) {
          offset = update.update_id + 1;
          await handleUpdate(update).catch((error) => log(`update: ${error.message}`));
        }
      } catch (error) {
        log(`poll: ${error.message}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
      }
    }
  }

  return {
    api,
    handleUpdate,
    start() {
      poll();
    },
    stop() {
      stopped = true;
    },
  };
}

function reply(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

export function createJoinServer(options = {}) {
  const service = createJoinService(options);
  const server = createServer(async (request, response) => {
    // No request body is used; the token only travels in the header.
    request.resume();
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith(BASE_PATH)) {
        throw new ApiError(404, "not_found", "Not found.");
      }
      reply(response, 200, await service.handle(request.method, url.pathname.slice(BASE_PATH.length) || "/", request.headers));
    } catch (error) {
      if (error instanceof ApiError) {
        reply(response, error.status, { error: error.code, message: error.message });
      } else {
        process.stderr.write(`telegram-join: ${error?.message ?? error}\n`);
        reply(response, 500, { error: "internal", message: "Something went wrong." });
      }
    }
  });
  return { server, service };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.OPENBANNERS_JOIN_BOT_TOKEN || "";
  // Never let the token reach a log line.
  const clean = (line) => (token ? String(line).split(token).join("<token>") : String(line));
  const log = (line) => process.stderr.write(`telegram-join ${clean(line)}\n`);
  const port = Number(process.env.OPENBANNERS_JOIN_PORT) || 8791;
  const chats = token ? parseChats(process.env.OPENBANNERS_JOIN_CHATS, process.env.OPENBANNERS_JOIN_CHAT_LABELS) : [];
  let username = process.env.OPENBANNERS_JOIN_BOT_USERNAME || "OpenBannersBot";
  const { server, service } = createJoinServer({ chats, botUsername: () => username });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`OpenBanners Telegram join listening on 127.0.0.1:${port} (${chats.length ? `${chats.length} chats` : "not configured"})\n`);
  });
  if (token) {
    const bot = createJoinBot({
      token,
      chats,
      adminIds: parseList(process.env.OPENBANNERS_JOIN_ADMIN_IDS),
      siteUrl: process.env.OPENBANNERS_SITE_URL || "https://openbanners.org",
      store: service.store,
      log,
    });
    try {
      const me = await bot.api("getMe", {});
      username = me.username || username;
      process.stdout.write(`telegram-join: bot @${username} polling\n`);
    } catch (error) {
      log(`getMe: ${error.message}`);
    }
    bot.start();
  } else {
    process.stdout.write("telegram-join: no bot token, bot off\n");
  }
}
