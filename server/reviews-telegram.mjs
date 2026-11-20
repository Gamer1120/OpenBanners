// Review tag suggestions in the passphrase bot (server/passphrases-telegram.mjs):
// every suggestion goes to each moderator at once as one message with the tag,
// positive/negative, who suggested it, on which banner, and a ready-made
// prompt in a code block (tap to copy). Michael pastes that prompt into his
// chat with Ember, who adds the tag in all languages (docs/review-tags.md).
// Nothing is shown on the site and there are no buttons: adding a tag is a
// code change. A failed send stays unnotified and is retried every minute.

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

// The prompt Michael pastes to Ember. Keep its start ("Add the OpenBanners
// review tag") as is: the openbanners-review-tag skill triggers on it. The
// suggestion ids at the end go into the tag's fromSuggestions in
// src/reviewTags.mjs, so the tag lands in those suggesters' reviews.
export function tagPrompt(name, kind, siteUrl, ids = []) {
  const test = /\/\/test\./.test(siteUrl ?? "");
  const list = [...new Set(ids)].map((id) => `#${id}`);
  const refs = list.length ? ` Suggestion${list.length > 1 ? "s" : ""} ${list.join(", ")}.` : "";
  return `Add the OpenBanners review tag "${name}" (${kind}) to the ${test ? "test website" : "website"} in all languages.${refs}`;
}

// ids: every not-yet-added suggestion of this tag (same name and kind), this one included.
export function renderTagSuggestion(row, siteUrl, ids = [row.id]) {
  const link = row.banner_id ? `${siteUrl}/banner/${encodeURIComponent(row.banner_id)}` : null;
  if (row.tag_id) {
    return [
      `🏷 <b>Review tag suggestion #${row.id}</b>`,
      `Tag: <b>${escapeHtml(row.name)}</b> (${row.kind === "positive" ? "👍 positive" : "👎 negative"})`,
      `✅ Added as <code>${escapeHtml(row.tag_id)}</code>${row.applied_to_review ? ", and in the suggester's review" : ""}.`,
    ].join("\n");
  }
  return [
    `🏷 <b>Review tag suggestion #${row.id}</b>`,
    `Tag: <b>${escapeHtml(row.name)}</b> (${row.kind === "positive" ? "👍 positive" : "👎 negative"})`,
    `From: ${escapeHtml(row.agent || "unverified agent")}`,
    `Banner: ${link ? `<a href="${escapeHtml(link)}">${escapeHtml(row.banner_title || row.banner_id)}</a>` : "none"}`,
    "",
    "To add it, tap the prompt to copy it and paste it in your chat with Ember:",
    `<code>${escapeHtml(tagPrompt(row.name, row.kind, siteUrl, ids.length ? ids : [row.id]))}</code>`,
    "",
    "<i>Until it's added, only the suggester sees it (in their own review). To skip one, do nothing.</i>",
  ].join("\n");
}

// send(chatId, html) -> Promise; suggestions = reviews.notifications (server/reviews.mjs).
export function createTagSuggestionNotifier({ send, moderators, suggestions, siteUrl, log = () => {} }) {
  async function notify() {
    if (!moderators.length) {
      return 0;
    }
    let sent = 0;
    const idsOf = (row) => suggestions.sameTag?.(row.name, row.kind) ?? [row.id];
    for (const row of suggestions.unnotified()) {
      const text = renderTagSuggestion(row, siteUrl, idsOf(row));
      let delivered = 0;
      for (const chatId of moderators) {
        try {
          await send(chatId, text);
          delivered += 1;
        } catch (error) {
          log(`tag suggestion ${row.id} to ${chatId}: ${error.message}`);
        }
      }
      // Marked once at least one moderator has it, so a blocked chat doesn't repeat it forever.
      if (delivered) {
        suggestions.markNotified(row.id);
        sent += 1;
      }
    }
    return sent;
  }

  // /tags: the last suggestions again, newest first (one message each).
  async function resend(chatId, limit = 10) {
    const rows = suggestions.recent(limit);
    if (!rows.length) {
      await send(chatId, "No review tag suggestions yet.");
      return 0;
    }
    for (const row of rows) {
      await send(chatId, renderTagSuggestion(row, siteUrl, suggestions.sameTag?.(row.name, row.kind) ?? [row.id]));
    }
    return rows.length;
  }

  return { notify, resend };
}
