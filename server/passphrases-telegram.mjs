// Telegram moderation bot for passphrase answers (long polling, no webhook).
// - One message per banner, not per answer: answers are collected until the
//   banner has been quiet for a while (people submit while walking), then the
//   moderators get a single message listing them, with buttons for the whole
//   banner (Approve all = visible after the 30 days, Publish all now, Reject
//   all) and "Per answer" for single decisions. New answers for the same banner
//   replace the old message with a fresh one, so there is one per banner.
//   "✉️ Message to author" sends a ready-made request to the banner author
//   (all its answers that aren't rejected) as one tap-to-copy <pre> block.
// - Commands: /pending (only answers awaiting a decision), /approved (approved,
//   waiting out their 30 days; a banner button opens its answers with Publish
//   now), /live (recently published), /blocks, /block, /unblock, /contact.
// - Anyone else who writes to the bot (an author objecting via Telegram) gets
//   told how to object, and the message is forwarded to the moderators.
// Only Telegram user ids in OPENBANNERS_TELEGRAM_MODERATORS can moderate.

// Translation suggestions ride along: one message per language
// (server/translations-telegram.mjs), callback data "tr:…".
import { createTranslationReviewer } from "./translations-telegram.mjs";

const API = "https://api.telegram.org";
const MAX_TEXT = 3800;
const MAX_ITEM_ROWS = 30;
const MAX_BANNER_BUTTONS = 30;
const DAY = 24 * 60 * 60 * 1000;
const LIVE_DAYS = 7;

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
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const clip = (value, length) => (value.length > length ? `${value.slice(0, length - 1)}…` : value);
const bannerLink = (siteUrl, bannerId, title) =>
  `<a href="${escapeHtml(`${siteUrl}/banner/${encodeURIComponent(bannerId)}`)}">${escapeHtml(title || bannerId)}</a>`;

// /approved: one line per banner, soonest visible first, with a button that
// opens the banner's approved answers (Publish all now / Reject / Per answer).
export function renderApproved(banners, siteUrl) {
  if (!banners.length) {
    return { text: "Nothing approved that's still waiting out its 30 days." };
  }
  const total = banners.reduce((sum, row) => sum + row.count, 0);
  let text = [
    `✅ <b>Approved, waiting out their 30 days</b> · ${plural(total, "answer")} on ${plural(banners.length, "banner")}`,
    "<i>Tap a banner for its answers, with Publish now and Reject.</i>",
    "",
  ].join("\n");
  const keyboard = [];
  for (const row of banners) {
    const from = shortDate(row.firstAt);
    const to = shortDate(row.lastAt);
    const line = `• ${bannerLink(siteUrl, row.bannerId, row.title)} · ${plural(row.count, "answer")} · visible ${from === to ? from : `${from} to ${to}`}\n`;
    if (keyboard.length >= MAX_BANNER_BUTTONS || text.length + line.length + 80 > MAX_TEXT) {
      break;
    }
    text += line;
    keyboard.push([{ text: `📋 ${clip(row.title || row.bannerId, 40)} · ${from.slice(5)}`, callback_data: `pp:ab:${row.anyId}` }]);
  }
  if (keyboard.length < banners.length) {
    text += `…and ${plural(banners.length - keyboard.length, "more banner")} (visible later)\n`;
  }
  return { text: text.trimEnd(), reply_markup: { inline_keyboard: keyboard } };
}

// /live: answers published in the last few days, grouped per banner, newest first.
export function renderLive(rows, siteUrl, days) {
  const period = days === 1 ? "the last day" : `the last ${days} days`;
  if (!rows.length) {
    return `Nothing went live in ${period}.`;
  }
  const banners = new Map();
  for (const row of rows) {
    if (!banners.has(row.banner_id)) {
      banners.set(row.banner_id, { first: row, rows: [] });
    }
    banners.get(row.banner_id).rows.push(row);
  }
  let text = `🚀 <b>Live in ${period}</b> · ${plural(rows.length, "answer")} on ${plural(banners.size, "banner")}\n\n`;
  let shown = 0;
  for (const [bannerId, { first, rows: answers }] of banners) {
    const sorted = [...answers].sort((a, b) => a.mission_index - b.mission_index || a.step_index - b.step_index);
    let list = "";
    let listed = 0;
    for (const row of sorted) {
      const entry = `${row.mission_index + 1}.${row.step_index + 1} <code>${escapeHtml(row.answer)}</code>`;
      if (list.length + entry.length > 300) {
        break;
      }
      list += `${listed ? " · " : ""}${entry}`;
      listed += 1;
    }
    if (listed < sorted.length) {
      list += ` · +${sorted.length - listed} more`;
    }
    const block = `${bannerLink(siteUrl, bannerId, first.title)} · ${plural(answers.length, "answer")} · ${shortDate(first.visible_at)}\n${list}\n\n`;
    if (text.length + block.length + 80 > MAX_TEXT) {
      break;
    }
    text += block;
    shown += 1;
  }
  if (shown < banners.size) {
    text += `…and ${plural(banners.size - shown, "more banner")} (older)\n`;
  }
  return text.trimEnd();
}
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
    const kind = row?.kind === "number" || item.kind === "number" ? " <i>(mission number)</i>" : "";
    const note =
      kind +
      (state === "approved" ? ` · visible ${shortDate(row.visible_at)}` : state === "live" ? " · live" : state === "rejected" ? " · rejected" : "");
    const instead = item.alt ? `\n      instead of <code>${escapeHtml(item.alt)}</code>${item.altRemoved ? " (removed)" : ""}` : "";
    return `${ICON[state]} ${place(item)}  ${answer}${note}${instead}`;
  });
  const head = [
    `🔑 <b>Passphrase answers</b> · <a href="${escapeHtml(link)}">${escapeHtml(first?.title || review.banner_id)}</a>`,
    `Authors: ${escapeHtml(first?.authors || "unknown")}`,
    `From: ${escapeHtml(submitters.join(", "))}`,
    `${review.items.length} answer${review.items.length > 1 ? "s" : ""} (mission.waypoint)` +
      (counts.review ? ` · ${counts.review} to review` : "") +
      (counts.approved ? ` · ${counts.approved} approved` : ""),
    "<i>Approve: mission numbers show at once, typed answers after their 30 days.</i>",
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
      // A correction: the old live answer can go too.
      ...(item.alt && !item.altRemoved ? [{ text: `${place(item)} 🗑 old`, callback_data: `pp:i:${review.id}:${item.id}:o` }] : []),
    ]);
    return { inline_keyboard: [...perAnswer, [{ text: "« All at once", callback_data: cb("back") }]] };
  }
  const toReview = open.some(({ state }) => state === "review");
  return {
    inline_keyboard: [
      ...(toReview
      ? [
          [
            { text: "✅ Approve all", callback_data: cb("a") },
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
        ]),
      ...messageRow(review, rows),
    ],
  };
}

// ✉️ Message to author: while the message lists any answer that isn't rejected,
// also once every answer is decided (then it is the only button).
export function messageRow(review, rows) {
  const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
  return review.items.some((item) => stateOf(byId.get(item.id)) !== "rejected")
    ? [[{ text: "✉️ Message to author", callback_data: `pp:m:${review.id}` }]]
    : [];
}

// The ✉️ button: a ready-made message Michael sends the banner author himself,
// asking whether its passphrase answers may be published. Plain text; the bot
// sends it inside <pre> so one tap copies all of it (copy_text buttons stop at
// 256 characters). rows: the banner's answers still there (rejected ones are
// deleted), any order. missions: passphraseStepsOf() of the banner, or null
// when Bannergress didn't answer (then the waypoint number stands in).
export function authorMessage(bannerId, rows, siteUrl, missions = null) {
  const link = `${siteUrl}/banner/${encodeURIComponent(bannerId)}`;
  const passphraseNumber = (missionIndex, stepIndex) => {
    const steps = missions?.[missionIndex]?.steps;
    if (!steps?.[stepIndex]?.passphrase) {
      return stepIndex + 1;
    }
    return steps.slice(0, stepIndex + 1).filter((step) => step.passphrase).length;
  };
  const sorted = [...rows].sort(
    (a, b) => a.mission_index - b.mission_index || a.step_index - b.step_index || (a.submitted_at ?? 0) - (b.submitted_at ?? 0)
  );
  // Several answers on one passphrase (a correction): one line.
  const lines = new Map();
  for (const row of sorted) {
    const key = `${row.mission_index}:${row.step_index}`;
    if (!lines.has(key)) {
      lines.set(key, { label: `Mission ${row.mission_index + 1}, passphrase ${passphraseNumber(row.mission_index, row.step_index)}`, answers: [] });
    }
    const entry = lines.get(key);
    if (!entry.answers.includes(row.answer)) {
      entry.answers.push(row.answer);
    }
  }
  const intro = [
    "Hi! Do you play Ingress? I'm asking because I think you made this banner:",
    link,
    "",
    "I run OpenBanners, a site where people can view banners from Bannergress, and I'd like to add the answers to its passphrase missions so more people can complete it.",
    "",
    'Is that okay with you? Just reply "no" if you\'d rather I didn\'t, and I won\'t publish them. If I don\'t hear back within 30 days, I\'ll assume it\'s fine. You can always ask me to remove them later or opt out from having passphrases from this or any of your banners added to OpenBanners.',
    "",
    "These passphrases were submitted:",
    "",
    "",
  ].join("\n");
  return { intro, answers: [...lines.values()].map(({ label, answers }) => `${label}: ${answers.join(" / ")}`) };
}

// Telegram messages hold 4096 characters: the text in as few <pre> blocks as fit.
export function authorMessageBlocks({ intro, answers }, limit = MAX_TEXT) {
  const blocks = [];
  let current = intro;
  for (const line of answers) {
    if (escapeHtml(`${current}${line}\n`).length > limit && current !== intro) {
      blocks.push(current);
      current = "";
    }
    current += `${line}\n`;
  }
  blocks.push(current);
  return blocks.map((block) => `<pre>${escapeHtml(block.trimEnd())}</pre>`);
}

const HELP = [
  "<b>OpenBanners passphrase moderation</b>",
  "Answers come in as one message per banner, once nobody has added any for a while.",
  "/pending: a fresh message for every banner with answers still to decide on, and for every language with translation suggestions",
  "/approved: approved answers still waiting out their 30 days, per banner with the date they become visible; tap a banner to publish now",
  `/live [days]: answers that went live in the last ${LIVE_DAYS} days (or the number of days you give)`,
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
  translations = null,
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
  const translationReviews = translations
    ? createTranslationReviewer({ api, send, moderators, translations, quietMs, now, log })
    : null;

  async function redraw(reviewId, chatId, messageId) {
    const review = moderation.reviews.get(reviewId);
    const rows = rowsOf(review);
    const { text } = renderReview(review, rows, siteUrl);
    let keyboard = keyboardFor(review, rows);
    if (!keyboard) {
      moderation.reviews.close(review.id);
      const row = messageRow(review, rows);
      keyboard = row.length ? { inline_keyboard: row } : undefined;
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

  // One fresh message for this banner per moderator; older open ones of the same
  // kind go away. kind 'review': answers awaiting a decision; 'approved': approved
  // ones in their 30 days (only to the moderator who asked).
  async function postBanner(bannerId, { kind = "review", chats = moderators } = {}) {
    const rows = moderation.openForBanner(bannerId, kind);
    if (!rows.length) {
      return false;
    }
    const items = rows.map((row) => ({
      id: row.id,
      m: row.mission_index,
      w: row.step_index,
      answer: row.answer,
      kind: row.kind,
      by: row.submitter_agent,
      ...(row.others ? { alt: row.others } : {}),
    }));
    for (const chatId of chats) {
      for (const old of moderation.reviews.openFor(bannerId, chatId, kind)) {
        moderation.reviews.close(old.id);
        if (old.message_id) {
          await api("deleteMessage", { chat_id: chatId, message_id: old.message_id }).catch(() =>
            api("editMessageText", { chat_id: chatId, message_id: old.message_id, text: "➡️ Moved to a newer message for this banner." }).catch(() => {})
          );
        }
      }
      const id = moderation.reviews.create(bannerId, chatId, items, kind);
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
    }
    try {
      await translationReviews?.notify({ force });
    } catch (error) {
      log(`notify translations: ${error.message}`);
    } finally {
      notifying = false;
    }
  }

  async function onCallback(query) {
    const reply = (text) => api("answerCallbackQuery", { callback_query_id: query.id, text: text.slice(0, 190) }).catch(() => {});
    if (!isModerator(query.from?.id)) {
      return reply("Not allowed.");
    }
    if (/^tr:/.test(query.data ?? "")) {
      return translationReviews ? translationReviews.onCallback(query, reply) : reply("Not available.");
    }
    const chatId = String(query.message?.chat?.id ?? query.from.id);
    const messageId = query.message?.message_id;
    // A banner button under /approved: post that banner's approved answers.
    const approvedBanner = /^pp:ab:(\d+)$/.exec(query.data ?? "");
    if (approvedBanner) {
      const row = moderation.get(Number(approvedBanner[1]));
      if (!row || !(await postBanner(row.banner_id, { kind: "approved", chats: [chatId] }))) {
        return reply("Nothing approved is waiting on this banner any more. Send /approved for a fresh list.");
      }
      return reply("Sent.");
    }
    // ✉️ Message to author: read-only, so it works on decided (closed) messages too.
    const message = /^pp:m:(\d+)$/.exec(query.data ?? "");
    if (message) {
      const review = moderation.reviews.get(Number(message[1]));
      const rows = review ? moderation.allForBanner(review.banner_id) : [];
      if (!rows.length) {
        return reply("No answers left on this banner.");
      }
      const missions = await moderation.passphraseSteps?.(review.banner_id).catch((error) => {
        log(`author message: ${error.message}`);
        return null;
      });
      await reply("Tap the text to copy it.");
      for (const block of authorMessageBlocks(authorMessage(review.banner_id, rows, siteUrl, missions))) {
        await send(chatId, block);
      }
      return null;
    }
    const bulk = /^pp:r:(\d+):(a|p|r|items|back)$/.exec(query.data ?? "");
    const single = /^pp:i:(\d+):(\d+):(a|p|r|o)$/.exec(query.data ?? "");
    const review = moderation.reviews.get(Number((bulk ?? single)?.[1]));
    if (!review || review.closed) {
      return reply(`This message is outdated. Send ${review?.kind === "approved" ? "/approved" : "/pending"} for a fresh one.`);
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
      if (action === "o") {
        const removed = moderation.removeOthers(Number(answerId));
        moderation.reviews.markAltRemoved(review.id, Number(answerId));
        await reply(removed ? "Removed the old answer." : "The old answer was already gone.");
      } else {
        const row = moderation.decide(Number(answerId), ACTIONS[action]);
        await reply(row ? `${DONE[action]}.` : "Already gone.");
      }
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
      const banners = moderation.bannersToReview();
      const languages = translationReviews?.openLanguages() ?? [];
      if (!banners.length && !languages.length) {
        const approvedBanners = moderation.approvedBanners();
        const approved = approvedBanners.reduce((sum, row) => sum + row.count, 0);
        return send(
          chatId,
          `Nothing to review.${approved ? ` ${plural(approved, "approved answer")} on ${plural(approvedBanners.length, "banner")} waiting out the 30 days: /approved` : ""}`,
        );
      }
      for (const bannerId of banners.slice(0, 20)) {
        await postBanner(bannerId);
      }
      for (const language of languages) {
        await translationReviews.postLanguage(language);
      }
      return banners.length > 20 ? send(chatId, `…and ${banners.length - 20} more banners. Handle these first, then /pending again.`) : null;
    }
    if (name === "/approved") {
      const { text: body, reply_markup } = renderApproved(moderation.approvedBanners(), siteUrl);
      return send(chatId, body, reply_markup ? { reply_markup } : {});
    }
    if (name === "/live") {
      const asked = Number.parseInt(args[0], 10);
      const days = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 365) : LIVE_DAYS;
      return send(chatId, renderLive(moderation.liveSince(now() - days * DAY), siteUrl, days));
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
