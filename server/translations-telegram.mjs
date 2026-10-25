// Telegram review messages for translation suggestions (server/translations.mjs),
// run by the passphrase moderation bot (server/passphrases-telegram.mjs):
// - One message per language, once nobody has suggested anything for that
//   language for the quiet period; a long batch is split over a few messages.
//   New suggestions for the language replace the old message(s).
// - Each suggestion shows its key, the English text, the current translation,
//   the suggestion and who sent it, with Approve / Reject; the message also has
//   Approve all / Reject all. Approved suggestions are live on the site at once.

const MAX_TEXT = 3800;
const MAX_ITEMS = 10;
const CLIP = 300;

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const clip = (value) => {
  const text = String(value ?? "");
  return text.length > CLIP ? `${text.slice(0, CLIP - 1)}…` : text;
};

export function languageName(code) {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

const ICON = { pending: "⏳", approved: "✅", rejected: "🗑", gone: "🗑" };

function stateOf(row) {
  return row ? row.status : "gone";
}

// One suggestion as message lines; n is its number in the message.
function itemLines(item, row, n) {
  const state = stateOf(row);
  const suggestion = state === "rejected" || state === "gone" ? `<s>${escapeHtml(clip(item.text))}</s>` : `<b>${escapeHtml(clip(item.text))}</b>`;
  const lines = [`${ICON[state]} <b>${n}.</b> <code>${escapeHtml(clip(item.key))}</code>${item.form ? ` <i>(${escapeHtml(item.form)})</i>` : ""}`];
  if (item.english !== item.key) {
    lines.push(`   EN: ${escapeHtml(clip(item.english))}`);
  }
  lines.push(`   Now: ${item.current ? escapeHtml(clip(item.current)) : "<i>not translated</i>"}`);
  lines.push(`   New: ${suggestion}`);
  lines.push(`   by ${escapeHtml(item.by || "unverified user")}${state === "approved" ? " · approved" : state === "rejected" || state === "gone" ? " · rejected" : ""}`);
  return lines.join("\n");
}

export function renderTranslationReview(review, rows, { part = 1, parts = 1 } = {}) {
  const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  const body = review.items.map((item, index) => {
    const row = byId.get(item.id);
    const state = stateOf(row);
    counts[state === "gone" ? "rejected" : state] += 1;
    return itemLines(item, row, index + 1);
  });
  const from = [...new Set(review.items.map((item) => item.by || "unverified user"))];
  const head = [
    `🌐 <b>Translations</b> · ${escapeHtml(languageName(review.language))}${parts > 1 ? ` · part ${part} of ${parts}` : ""}`,
    `From: ${escapeHtml(from.join(", "))}`,
    `${review.items.length} suggestion${review.items.length === 1 ? "" : "s"}` +
      (counts.pending ? ` · ${counts.pending} to review` : "") +
      (counts.approved ? ` · ${counts.approved} approved` : "") +
      (counts.rejected ? ` · ${counts.rejected} rejected` : ""),
    "<i>Approved translations show on the site at once.</i>",
    "",
  ].join("\n");
  return { text: `${head}\n${body.join("\n\n")}`.slice(0, 4090), counts };
}

export function translationKeyboard(review, rows) {
  const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
  const open = review.items.map((item, index) => ({ item, n: index + 1 })).filter(({ item }) => stateOf(byId.get(item.id)) === "pending");
  if (!open.length) {
    return undefined;
  }
  const buttons = open.flatMap(({ item, n }) => [
    { text: `${n} ✅ Approve`, callback_data: `tr:i:${review.id}:${item.id}:a` },
    { text: `${n} 🗑 Reject`, callback_data: `tr:i:${review.id}:${item.id}:r` },
  ]);
  const rowsOfButtons = [];
  for (let i = 0; i < buttons.length; i += 4) {
    rowsOfButtons.push(buttons.slice(i, i + 4));
  }
  if (open.length > 1) {
    rowsOfButtons.push([
      { text: "✅ Approve all", callback_data: `tr:r:${review.id}:a` },
      { text: "🗑 Reject all", callback_data: `tr:r:${review.id}:r` },
    ]);
  }
  return { inline_keyboard: rowsOfButtons };
}

// Splits a language's suggestions over messages that fit Telegram.
export function chunkItems(items) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    const length = itemLines(item, { status: "pending" }, 99).length + 2;
    if (current.length && (current.length >= MAX_ITEMS || size + length > MAX_TEXT - 400)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += length;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

export function createTranslationReviewer({ api, send, moderators, translations, quietMs, now, log }) {
  const rowsOf = (review) => review.items.map((item) => translations.get(item.id));

  async function postLanguage(language) {
    const rows = translations.openForLanguage(language);
    if (!rows.length) {
      return false;
    }
    const items = rows.map((row) => ({
      id: row.id,
      key: row.key,
      form: row.form || null,
      english: translations.english(row),
      current: translations.current(row),
      text: row.text,
      by: row.submitter_agent,
    }));
    const chunks = chunkItems(items);
    for (const chatId of moderators) {
      for (const old of translations.reviews.openFor(language, chatId)) {
        translations.reviews.close(old.id);
        if (old.message_id) {
          await api("deleteMessage", { chat_id: chatId, message_id: old.message_id }).catch(() =>
            api("editMessageText", { chat_id: chatId, message_id: old.message_id, text: "➡️ Moved to a newer message for this language." }).catch(() => {})
          );
        }
      }
      for (const [index, chunk] of chunks.entries()) {
        const id = translations.reviews.create(language, chatId, chunk);
        const review = translations.reviews.get(id);
        const reviewRows = rowsOf(review);
        const { text } = renderTranslationReview(review, reviewRows, { part: index + 1, parts: chunks.length });
        const message = await send(chatId, text, { reply_markup: translationKeyboard(review, reviewRows) });
        translations.reviews.setMessage(id, message.message_id);
      }
    }
    for (const row of rows) {
      if (row.notified_at === null) {
        translations.markNotified(row.id);
      }
    }
    return true;
  }

  async function notify({ force = false } = {}) {
    for (const { language, lastAt } of translations.unnotifiedLanguages()) {
      if (force || now() - lastAt >= quietMs) {
        await postLanguage(language);
      }
    }
  }

  async function redraw(review, chatId, messageId) {
    const rows = rowsOf(review);
    const keyboard = translationKeyboard(review, rows);
    if (!keyboard) {
      translations.reviews.close(review.id);
    }
    const { text } = renderTranslationReview(review, rows);
    await api("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    }).catch((error) => {
      if (!/not modified/.test(error.message)) {
        log(`translation edit: ${error.message}`);
      }
    });
  }

  // tr:r:<review>:a|r (all) and tr:i:<review>:<suggestion>:a|r (one). Moderators only (checked by the caller).
  async function onCallback(query, reply) {
    const bulk = /^tr:r:(\d+):(a|r)$/.exec(query.data ?? "");
    const single = /^tr:i:(\d+):(\d+):(a|r)$/.exec(query.data ?? "");
    const review = translations.reviews.get(Number((bulk ?? single)?.[1]));
    if (!review || review.closed) {
      return reply("This message is outdated. Send /pending for a fresh one.");
    }
    const action = (bulk ?? single)[bulk ? 2 : 3] === "a" ? "approve" : "reject";
    const done = action === "approve" ? "Approved" : "Rejected";
    if (bulk) {
      let changed = 0;
      for (const item of review.items) {
        if (translations.get(item.id)?.status === "pending") {
          translations.decide(item.id, action);
          changed += 1;
        }
      }
      await reply(`${done} ${changed} suggestion${changed === 1 ? "" : "s"}.`);
    } else {
      const id = Number(single[2]);
      if (!review.items.some((item) => item.id === id)) {
        return reply("That suggestion isn't in this message.");
      }
      const row = translations.decide(id, action);
      await reply(!row ? "Already gone." : row.decided ? `${done}.` : "Already decided.");
    }
    const chatId = String(query.message?.chat?.id ?? query.from.id);
    if (query.message?.message_id) {
      await redraw(review, chatId, query.message.message_id);
    }
    return null;
  }

  return { notify, postLanguage, onCallback, openLanguages: () => translations.languagesWithOpen() };
}
