// Telegram moderation bot for passphrase answers (long polling, no webhook).
// - One message per banner, not per answer: answers are collected until the
//   banner has been quiet for a while (people submit while walking), then the
//   moderators get a single message listing them, with buttons for the whole
//   banner (Approve all = visible after the 30 days, Publish all now, Reject
//   all) and "Per answer" for single decisions. New answers for the same banner
//   replace the old message with a fresh one, so there is one per banner.
// - Commands: /pending, /blocks, /block, /unblock, /contact.
// - Anyone else who writes to the bot (an author objecting via Telegram) gets
//   told how to object, and the message is forwarded to the moderators.
// Only Telegram user ids in OPENBANNERS_TELEGRAM_MODERATORS can moderate.

const API = "https://api.telegram.org";
const MAX_TEXT = 3800;
const MAX_ITEM_ROWS = 30;

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

const shortDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const place = (item) => `${item.m + 1}.${item.w + 1}`;

// What happened to an answer since the message was sent.
function stateOf(row) {
  if (!row) {
    return "rejected";
  }
  if (row.status === "live") {
    return "live";
  }
  return row.approved_at === null ? "review" : "approved";
}

const ICON = { review: "⏳", approved: "✅", live: "🚀", rejected: "🗑" };
const DONE = { a: "Approved", p: "Published", r: "Rejected" };
const ACTIONS = { a: "approve", p: "publish", r: "reject" };

export function renderReview(review, rows, siteUrl) {
  const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
  const first = rows.find(Boolean);
  const link = `${siteUrl}/banner/${encodeURIComponent(review.banner_id)}`;
  const submitters = [...new Set(review.items.map((item) => item.by || "unverified user"))];
  const counts = { review: 0, approved: 0, live: 0, rejected: 0 };
  const lines = review.items.map((item) => {
    const row = byId.get(item.id);
    const state = stateOf(row);
    counts[state] += 1;
    const answer = state === "rejected" ? `<s>${escapeHtml(item.answer)}</s>` : `<code>${escapeHtml(item.answer)}</code>`;
    const note =
      state === "approved" ? ` · visible ${shortDate(row.visible_at)}` : state === "live" ? " · live" : state === "rejected" ? " · rejected" : "";
    return `${ICON[state]} ${place(item)}  ${answer}${note}`;
  });
  const head = [
    `🔑 <b>Passphrase answers</b> · <a href="${escapeHtml(link)}">${escapeHtml(first?.title || review.banner_id)}</a>`,
    `Authors: ${escapeHtml(first?.authors || "unknown")}`,
    `From: ${escapeHtml(submitters.join(", "))}`,
    `${review.items.length} answer${review.items.length > 1 ? "s" : ""} (mission.waypoint)` +
      (counts.review ? ` · ${counts.review} to review` : "") +
      (counts.approved ? ` · ${counts.approved} approved` : ""),
    "",
  ];
  let text = head.join("\n");
  let shown = 0;
  for (const line of lines) {
    if (text.length + line.length + 60 > MAX_TEXT) {
      break;
    }
    text += `${line}\n`;
    shown += 1;
  }
  if (shown < lines.length) {
    text += `…and ${lines.length - shown} more (the buttons cover all of them)\n`;
  }
  return { text: text.trimEnd(), counts };
}

export function keyboardFor(review, rows) {
  const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
  const open = review.items
    .map((item) => ({ item, state: stateOf(byId.get(item.id)) }))
    .filter(({ state }) => state === "review" || state === "approved");
  if (!open.length) {
    return undefined;
  }
  const cb = (action) => `pp:r:${review.id}:${action}`;
  if (review.mode === "items") {
    const perAnswer = open.slice(0, MAX_ITEM_ROWS).map(({ item, state }) => [
      ...(state === "review" ? [{ text: `${place(item)} ✅`, callback_data: `pp:i:${review.id}:${item.id}:a` }] : []),
      { text: `${place(item)} 🚀`, callback_data: `pp:i:${review.id}:${item.id}:p` },
      { text: `${place(item)} 🗑`, callback_data: `pp:i:${review.id}:${item.id}:r` },
    ]);
    return { inline_keyboard: [...perAnswer, [{ text: "« All at once", callback_data: cb("back") }]] };
  }
  const toReview = open.some(({ state }) => state === "review");
  return {
    inline_keyboard: toReview
      ? [
          [
            { text: "✅ Approve all (30 days)", callback_data: cb("a") },
            { text: "🚀 Publish all now", callback_data: cb("p") },
          ],
          [
            { text: "🗑 Reject all", callback_data: cb("r") },
            { text: "✏️ Per answer", callback_data: cb("items") },
          ],
        ]
      : [
          [
            { text: "🚀 Publish all now", callback_data: cb("p") },
            { text: "🗑 Reject all", callback_data: cb("r") },
          ],
          [{ text: "✏️ Per answer", callback_data: cb("items") }],
        ],
  };
}

const HELP = [
  "<b>OpenBanners passphrase moderation</b>",
  "Answers come in as one message per banner, once nobody has added any for a while.",
  "/pending: a fresh message for every banner with answers to review, or approved ones still in their 30 days",
  "/blocks: banners and authors that objected",
  "/block banner &lt;banner-id&gt; or /block author &lt;agent&gt;: delete their answers and block new ones",
  "/unblock banner|author &lt;key&gt;",
  "/contact &lt;agent&gt; &lt;channel&gt; [note]: log an attempt to reach an author",
].join("\n");

const OBJECT_HELP = [
  "Hi! This bot handles passphrase answers on OpenBanners.",
  "If you made a banner and don't want its passphrases published, the quickest way is to log in on https://openbanners.org with Bannergress (verified agent) and use the buttons on your banner, or Settings in the ⋮ menu for all your banners.",
  "You can also reply here with your agent name and the banner, and a moderator will take care of it.",
].join("\n\n");

export function createModerationBot({
  token,
  moderatorIds,
  siteUrl,
  moderation,
  quietMs = 15 * 60 * 1000,
  now = () => Date.now(),
  fetchImpl = fetch,
  log = () => {},
}) {
  const moderators = [...new Set(moderatorIds.map(String))];
  const isModerator = (id) => moderators.includes(String(id));

  async function api(method, body) {
    const response = await fetchImpl(`${API}/bot${token}/${method}`, {
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

  const rowsOf = (review) => review.items.map((item) => moderation.get(item.id));

  async function redraw(reviewId, chatId, messageId) {
    const review = moderation.reviews.get(reviewId);
    const rows = rowsOf(review);
    const { text } = renderReview(review, rows, siteUrl);
    const keyboard = keyboardFor(review, rows);
    if (!keyboard) {
      moderation.reviews.close(review.id);
    }
    await api("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    }).catch((error) => {
      if (!/not modified/.test(error.message)) {
        log(`edit: ${error.message}`);
      }
    });
  }

  // One fresh message for this banner per moderator; older open ones go away.
  async function postBanner(bannerId) {
    const rows = moderation.openForBanner(bannerId);
    if (!rows.length) {
      return false;
    }
    const items = rows.map((row) => ({ id: row.id, m: row.mission_index, w: row.step_index, answer: row.answer, by: row.submitter_agent }));
    for (const chatId of moderators) {
      for (const old of moderation.reviews.openFor(bannerId, chatId)) {
        moderation.reviews.close(old.id);
        if (old.message_id) {
          await api("deleteMessage", { chat_id: chatId, message_id: old.message_id }).catch(() =>
            api("editMessageText", { chat_id: chatId, message_id: old.message_id, text: "➡️ Moved to a newer message for this banner." }).catch(() => {})
          );
        }
      }
      const id = moderation.reviews.create(bannerId, chatId, items);
      const review = moderation.reviews.get(id);
      const { text } = renderReview(review, rows, siteUrl);
      const message = await send(chatId, text, { reply_markup: keyboardFor(review, rows) });
      moderation.reviews.setMessage(id, message.message_id);
    }
    for (const row of rows) {
      if (row.notified_at === null) {
        moderation.markNotified(row.id);
      }
    }
    return true;
  }

  let notifying = false;
  async function notifyPending({ force = false } = {}) {
    if (notifying || !moderators.length) {
      return;
    }
    notifying = true;
    try {
      for (const { bannerId, lastAt } of moderation.unnotifiedBanners()) {
        if (force || now() - lastAt >= quietMs) {
          await postBanner(bannerId);
        }
      }
    } catch (error) {
      log(`notify: ${error.message}`);
    } finally {
      notifying = false;
    }
  }

  async function onCallback(query) {
    const reply = (text) => api("answerCallbackQuery", { callback_query_id: query.id, text: text.slice(0, 190) }).catch(() => {});
    if (!isModerator(query.from?.id)) {
      return reply("Not allowed.");
    }
    const chatId = String(query.message?.chat?.id ?? query.from.id);
    const messageId = query.message?.message_id;
    const bulk = /^pp:r:(\d+):(a|p|r|items|back)$/.exec(query.data ?? "");
    const single = /^pp:i:(\d+):(\d+):(a|p|r)$/.exec(query.data ?? "");
    const review = moderation.reviews.get(Number((bulk ?? single)?.[1]));
    if (!review || review.closed) {
      return reply("This message is outdated. Send /pending for a fresh one.");
    }
    if (bulk) {
      const action = bulk[2];
      if (action === "items" || action === "back") {
        moderation.reviews.setMode(review.id, action === "items" ? "items" : "banner");
        await reply(action === "items" ? "Per answer" : "All at once");
      } else {
        let changed = 0;
        for (const item of review.items) {
          const state = stateOf(moderation.get(item.id));
          // Approve all only touches answers still to review; publish and reject also the approved ones.
          if (state === "review" || (state === "approved" && action !== "a")) {
            moderation.decide(item.id, ACTIONS[action]);
            changed += 1;
          }
        }
        await reply(`${DONE[action]} ${changed} answer${changed === 1 ? "" : "s"}.`);
      }
    } else {
      const [, , answerId, action] = single;
      if (!review.items.some((item) => item.id === Number(answerId))) {
        return reply("That answer isn't in this message.");
      }
      const row = moderation.decide(Number(answerId), ACTIONS[action]);
      await reply(row ? `${DONE[action]}.` : "Already gone.");
    }
    if (messageId) {
      await redraw(review.id, chatId, messageId);
    }
    return null;
  }

  async function onModeratorCommand(chatId, text) {
    const [command, ...args] = text.trim().split(/\s+/);
    const name = command.replace(/@.*$/, "").toLowerCase();
    if (name === "/pending") {
      const banners = moderation.bannersWithOpenAnswers();
      if (!banners.length) {
        return send(chatId, "Nothing to review, and nothing approved that's still waiting.");
      }
      for (const bannerId of banners.slice(0, 20)) {
        await postBanner(bannerId);
      }
      return banners.length > 20 ? send(chatId, `…and ${banners.length - 20} more banners. Handle these first, then /pending again.`) : null;
    }
    if (name === "/blocks") {
      const rows = moderation.blocks();
      return send(
        chatId,
        rows.length
          ? rows.map((row) => `${row.scope} <code>${escapeHtml(row.key)}</code> (via ${escapeHtml(row.via)}, ${shortDate(row.at)})`).join("\n")
          : "No blocks."
      );
    }
    if ((name === "/block" || name === "/unblock") && (args[0] === "banner" || args[0] === "author") && args[1]) {
      if (name === "/block") {
        const { banners, deleted } = moderation.block(args[0], args[1], "telegram");
        return send(chatId, `Blocked ${args[0]} <code>${escapeHtml(args[1])}</code>: deleted ${deleted} answers on ${banners} banner(s).`);
      }
      const removed = moderation.unblock(args[0], args[1]);
      return send(chatId, removed ? `Unblocked ${args[0]} <code>${escapeHtml(args[1])}</code>.` : "No such block.");
    }
    if (name === "/contact" && args.length >= 2) {
      moderation.logContact(args[0], args[1], null, args.slice(2).join(" ") || null);
      return send(chatId, `Logged: contacted ${escapeHtml(args[0])} via ${escapeHtml(args[1])}.`);
    }
    return send(chatId, HELP);
  }

  async function onMessage(message) {
    const chatId = String(message.chat?.id ?? "");
    const text = typeof message.text === "string" ? message.text : "";
    if (message.chat?.type !== "private") {
      return null;
    }
    if (isModerator(message.from?.id)) {
      return onModeratorCommand(chatId, text);
    }
    // Someone else (an author objecting?): explain, and pass it on.
    await send(chatId, escapeHtml(OBJECT_HELP));
    const from = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
    const who = `${escapeHtml(from || "Someone")}${message.from?.username ? ` (@${escapeHtml(message.from.username)})` : ""}`;
    for (const moderator of moderators) {
      await send(
        moderator,
        `✉️ Message to the passphrase bot from ${who}:\n\n${escapeHtml(text || "(no text)")}\n\nApply an objection with /block banner &lt;id&gt; or /block author &lt;agent&gt;.`
      );
    }
    return null;
  }

  async function handleUpdate(update) {
    if (update.callback_query) {
      await onCallback(update.callback_query);
    } else if (update.message) {
      await onMessage(update.message);
    }
  }

  let stopped = false;
  async function poll() {
    let offset = Number(moderation.getValue("telegram_offset")) || 0;
    while (!stopped) {
      try {
        const updates = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
        for (const update of updates) {
          offset = update.update_id + 1;
          moderation.setValue("telegram_offset", offset);
          await handleUpdate(update).catch((error) => log(`update: ${error.message}`));
        }
      } catch (error) {
        log(`poll: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  return {
    notifyPending,
    handleUpdate,
    start() {
      poll();
      // Every minute: post banners that have gone quiet; also retries failed sends.
      setInterval(notifyPending, 60 * 1000).unref();
    },
    stop() {
      stopped = true;
    },
  };
}

export function startModerationBot(options) {
  const bot = createModerationBot({ ...options, log: (line) => process.stderr.write(`telegram ${line}\n`) });
  bot.start();
  return bot;
}
