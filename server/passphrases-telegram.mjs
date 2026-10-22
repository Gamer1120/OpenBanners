// Telegram moderation bot for passphrase answers (long polling, no webhook).
// - Every typed crowd answer is sent to the moderators with three buttons:
//   Approve (visible after its 30 days), Publish now, Reject (deleted).
// - Moderators also get commands: /pending, /blocks, /block, /unblock, /contact.
// - Anyone else who writes to the bot (an author objecting via Telegram) gets
//   told how to object, and the message is forwarded to the moderators, who
//   can apply it with /block.
// Only chats listed in OPENBANNERS_TELEGRAM_MODERATORS can moderate.

const API = "https://api.telegram.org";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

const shortDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export function describeAnswer(row, siteUrl) {
  const link = `${siteUrl}/banner/${encodeURIComponent(row.banner_id)}`;
  return [
    `🔑 <b>Passphrase answer</b> #${row.id}`,
    `<a href="${escapeHtml(link)}">${escapeHtml(row.title || row.banner_id)}</a>`,
    `Mission ${row.mission_index + 1}, waypoint ${row.step_index + 1}`,
    `Answer: <code>${escapeHtml(row.answer)}</code>`,
    `By: ${escapeHtml(row.submitter_agent || "unverified Bannergress user")}`,
    `Authors: ${escapeHtml(row.authors || "unknown")}`,
    `Submitted ${shortDate(row.submitted_at)}, 30 days end ${shortDate(row.visible_at)}`,
  ].join("\n");
}

const OUTCOME = {
  approve: (row) => `✅ Approved: visible from ${shortDate(row.visible_at)}${row.status === "live" ? " (already live)" : ""}`,
  publish: () => "🚀 Published now",
  reject: () => "🗑 Rejected and deleted",
};

export function buttonsFor(id) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve (30 days)", callback_data: `pp:approve:${id}` },
        { text: "🚀 Publish now", callback_data: `pp:publish:${id}` },
      ],
      [{ text: "🗑 Reject", callback_data: `pp:reject:${id}` }],
    ],
  };
}

const HELP = [
  "<b>OpenBanners passphrase moderation</b>",
  "/pending: answers waiting for review",
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

export function createModerationBot({ token, moderatorIds, siteUrl, moderation, fetchImpl = fetch, log = () => {} }) {
  const moderators = new Set(moderatorIds.map(String));

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

  let notifying = false;
  async function notifyPending() {
    if (notifying || !moderators.size) {
      return;
    }
    notifying = true;
    try {
      for (const row of moderation.unnotified()) {
        for (const chatId of moderators) {
          await send(chatId, describeAnswer(row, siteUrl), { reply_markup: buttonsFor(row.id) });
        }
        moderation.markNotified(row.id);
      }
    } catch (error) {
      log(`notify: ${error.message}`);
    } finally {
      notifying = false;
    }
  }

  async function onCallback(query) {
    const chatId = String(query.message?.chat?.id ?? query.from?.id ?? "");
    const match = /^pp:(approve|publish|reject):(\d+)$/.exec(query.data ?? "");
    if (!moderators.has(String(query.from?.id)) || !match) {
      await api("answerCallbackQuery", { callback_query_id: query.id, text: "Not allowed." });
      return;
    }
    const [, action, id] = match;
    const before = moderation.get(Number(id));
    const row = moderation.decide(Number(id), action);
    const outcome = row ? OUTCOME[action](row) : "Already gone (rejected, or the author objected).";
    await api("answerCallbackQuery", { callback_query_id: query.id, text: outcome.slice(0, 190) });
    if (query.message) {
      const text = `${before ? describeAnswer(before, siteUrl) : `🔑 Passphrase answer #${id}`}\n\n<b>${escapeHtml(outcome)}</b>`;
      await api("editMessageText", {
        chat_id: chatId,
        message_id: query.message.message_id,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }).catch((error) => log(`edit: ${error.message}`));
    }
  }

  async function onModeratorCommand(chatId, text) {
    const [command, ...args] = text.trim().split(/\s+/);
    const name = command.replace(/@.*$/, "").toLowerCase();
    if (name === "/pending") {
      const rows = moderation.awaitingReview();
      if (!rows.length) {
        return send(chatId, "Nothing waiting for review.");
      }
      for (const row of rows.slice(0, 20)) {
        await send(chatId, describeAnswer(row, siteUrl), { reply_markup: buttonsFor(row.id) });
      }
      return rows.length > 20 ? send(chatId, `…and ${rows.length - 20} more. Handle these first, then /pending again.`) : null;
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
    if (moderators.has(String(message.from?.id)) && message.chat?.type === "private") {
      return onModeratorCommand(chatId, text);
    }
    if (message.chat?.type !== "private") {
      return null;
    }
    // Someone else (an author objecting?): explain, and pass it on.
    await send(chatId, escapeHtml(OBJECT_HELP));
    const from = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
    const who = `${escapeHtml(from || "Someone")}${message.from?.username ? ` (@${escapeHtml(message.from.username)})` : ""}`;
    for (const moderator of moderators) {
      await send(moderator, `✉️ Message to the passphrase bot from ${who}:\n\n${escapeHtml(text || "(no text)")}\n\nApply an objection with /block banner &lt;id&gt; or /block author &lt;agent&gt;.`);
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
      notifyPending();
      // Retry notices that failed, e.g. while Telegram was unreachable.
      setInterval(notifyPending, 10 * 60 * 1000).unref();
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

