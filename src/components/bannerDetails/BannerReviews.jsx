import React, { useEffect, useRef, useState } from "react";
import { AddOutlined, HourglassEmptyOutlined, RateReviewOutlined, Star, StarBorder, StarHalf, ThumbDownOutlined, ThumbUpOutlined } from "@mui/icons-material";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../../bannergressSync";
import { TAG_NAME_MAX, tagById, useBannerReviews } from "../../bannerReviews";
import { REVIEW_TAGS } from "../../reviewTags.mjs";
import { getLanguage, t, tn } from "../../i18n";

// Banner reviews on the banner page (Overview tab): average stars, number of
// reviews and the most picked tags for everyone; signed in, your own review
// (1-5 stars + tags from src/reviewTags.mjs, never text) with Edit / Delete.
// The last chip of each tag group is "+ Suggest a tag": the suggestion goes to
// the moderators and sits in your own review as a pending tag (only you see
// it) until they add the tag, which then lands in your review for real.
const TOP_TAGS = 8;

const formatRating = (value) => {
  try {
    return new Intl.NumberFormat(getLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  } catch {
    return value.toFixed(1);
  }
};

function StarRow({ value, label }) {
  return (
    <span className="rv-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) =>
        value >= n - 0.25 ? <Star key={n} fontSize="inherit" /> : value >= n - 0.75 ? <StarHalf key={n} fontSize="inherit" /> : <StarBorder key={n} fontSize="inherit" />
      )}
    </span>
  );
}

function TagChip({ id, count }) {
  const tag = tagById.get(id);
  if (!tag) {
    return null;
  }
  const Icon = tag.kind === "positive" ? ThumbUpOutlined : ThumbDownOutlined;
  return (
    <li className={`chip mini rv-tag ${tag.kind === "positive" ? "ok" : "bad"}`}>
      <Icon className="ic" aria-label={tag.kind === "positive" ? t("Positive") : t("Negative")} />
      {t(tag.label)}
      {count ? <span className="count">{count}</span> : null}
    </li>
  );
}

const PENDING_NOTE = () => t("Suggested, waiting for approval");

// One of your suggested tags, pending until the team adds it: only you see it.
function PendingChip({ item }) {
  const Icon = item.kind === "positive" ? ThumbUpOutlined : ThumbDownOutlined;
  return (
    <li className={`chip mini rv-tag rv-pending ${item.kind === "positive" ? "ok" : "bad"}`} title={PENDING_NOTE()} aria-label={`${item.name} (${PENDING_NOTE()})`}>
      <Icon className="ic" aria-hidden="true" />
      {item.name}
      <HourglassEmptyOutlined className="ic" aria-hidden="true" />
    </li>
  );
}

const PendingLegend = () => (
  <span className="small muted rv-pending-legend">
    <HourglassEmptyOutlined fontSize="inherit" aria-hidden="true" /> {PENDING_NOTE()}
  </span>
);

// "+ Suggest a tag": the last chip of a tag group. Opens a one-line field in the group;
// the new tag gets the group's kind and goes into your review as pending.
function SuggestChip({ kind, onSuggest, onSuggested }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const chipRef = useRef(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      chipRef.current?.focus();
    }
  }, [open]);
  const close = () => {
    refocus.current = true;
    setOpen(false);
    setName("");
    setError("");
  };
  if (!open) {
    return (
      <>
        <button
          ref={chipRef}
          type="button"
          className={`chip rv-choice rv-suggest-chip ${kind}`}
          onClick={() => {
            setOpen(true);
            setSent(false);
          }}
        >
          <AddOutlined fontSize="inherit" aria-hidden="true" />
          {t("Suggest a tag")}
        </button>
        {sent ? (
          <p className="small muted rv-suggest-sent" role="status">
            {t("Thanks! Your tag suggestion was sent.")}
          </p>
        ) : null}
      </>
    );
  }
  const send = (event) => {
    event.preventDefault();
    if (busy || name.trim().length < 2) {
      return;
    }
    setBusy(true);
    setError("");
    onSuggest(name.trim(), kind).then(
      (result) => {
        setBusy(false);
        setSent(true);
        onSuggested?.(result?.suggestion);
        close();
      },
      (e) => {
        setBusy(false);
        setError(e.message);
      }
    );
  };
  return (
    <form
      className="rv-suggest"
      onSubmit={send}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <input
        className="pp-input"
        aria-label={t("Tag name")}
        placeholder={t("Tag name")}
        value={name}
        maxLength={TAG_NAME_MAX}
        autoFocus
        enterKeyHint="send"
        onChange={(event) => setName(event.target.value)}
      />
      <span className="small muted">{t("Your suggestion goes to the OpenBanners team and doesn't show to others until they add it.")}</span>
      <div className="pp-actions">
        <button type="submit" className="btn filled sl" disabled={busy || name.trim().length < 2}>
          {busy ? t("Sending…") : t("Send")}
        </button>
        <button type="button" className="btn text sl" disabled={busy} onClick={close}>
          {t("Cancel")}
        </button>
      </div>
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
    </form>
  );
}

function ReviewEditor({ initial, initialPending, onSave, onCancel, onSuggest }) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [tags, setTags] = useState(initial?.tags ?? []);
  // Your pending suggestions on this banner; "keep" = the ones still picked.
  const [pending, setPending] = useState(initialPending ?? []);
  const [keep, setKeep] = useState(() => (initialPending ?? []).map((item) => item.suggestionId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id) => setTags((current) => (current.includes(id) ? current.filter((tag) => tag !== id) : [...current, id]));
  const toggleKeep = (id) => setKeep((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const added = (suggestion) => {
    if (!suggestion?.id || !suggestion.pending) {
      return;
    }
    const item = { suggestionId: suggestion.id, name: suggestion.name, kind: suggestion.kind };
    setPending((current) => (current.some((p) => p.suggestionId === item.suggestionId) ? current : [...current, item]));
    setKeep((current) => (current.includes(item.suggestionId) ? current : [...current, item.suggestionId]));
  };
  const save = () => {
    setBusy(true);
    setError("");
    onSave(stars, tags, keep.filter((id) => pending.some((p) => p.suggestionId === id))).then(
      () => setBusy(false),
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };
  const group = (kind, title) => {
    const mineHere = pending.filter((item) => item.kind === kind);
    const Icon = kind === "positive" ? ThumbUpOutlined : ThumbDownOutlined;
    return (
      <div className="rv-group" role="group" aria-label={title}>
        <span className="small muted">{title}</span>
        <div className="rv-choices">
          {REVIEW_TAGS.filter((tag) => tag.kind === kind).map((tag) => {
            const on = tags.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className={`chip rv-choice ${kind}${on ? " sel" : ""}`}
                aria-pressed={on}
                onClick={() => toggle(tag.id)}
              >
                <Icon fontSize="inherit" />
                {t(tag.label)}
              </button>
            );
          })}
          {mineHere.map((item) => {
            const on = keep.includes(item.suggestionId);
            return (
              <button
                key={`s${item.suggestionId}`}
                type="button"
                className={`chip rv-choice rv-pending ${kind}${on ? " sel" : ""}`}
                aria-pressed={on}
                aria-label={`${item.name} (${PENDING_NOTE()})`}
                title={PENDING_NOTE()}
                onClick={() => toggleKeep(item.suggestionId)}
              >
                <Icon fontSize="inherit" />
                {item.name}
                <HourglassEmptyOutlined fontSize="inherit" aria-hidden="true" />
              </button>
            );
          })}
          {onSuggest ? <SuggestChip kind={kind} onSuggest={onSuggest} onSuggested={added} /> : null}
        </div>
        {mineHere.length ? <PendingLegend /> : null}
      </div>
    );
  };
  return (
    <div className="rv-editor">
      <div className="rv-pick" role="radiogroup" aria-label={t("Your rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={tn("{count} star", "{count} stars", n)}
            className={`rv-star${n <= stars ? " on" : ""}`}
            onClick={() => setStars(n)}
          >
            {n <= stars ? <Star /> : <StarBorder />}
          </button>
        ))}
      </div>
      {group("positive", t("What was good"))}
      {group("negative", t("What could be better"))}
      <div className="pp-actions">
        <button type="button" className="btn filled sl" disabled={busy || !stars} onClick={save}>
          {busy ? t("Saving…") : t("Save")}
        </button>
        <button type="button" className="btn text sl" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
    </div>
  );
}

export default function BannerReviews({ bannerId }) {
  const reviews = useBannerReviews(bannerId);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setEditing(false);
    setError("");
  }, [bannerId]);
  if (!bannerId || reviews.status === "idle") {
    return null;
  }
  const data = reviews.data;
  const mine = data?.mine ?? null;
  const top = (data?.tags ?? []).filter((tag) => tagById.has(tag.id)).slice(0, TOP_TAGS);
  const remove = () => {
    setBusy(true);
    setError("");
    reviews.remove().then(
      () => setBusy(false),
      (e) => {
        setBusy(false);
        setError(e.message);
      }
    );
  };

  return (
    <section className="pp-panel rv" aria-label={t("Reviews")}>
      <RateReviewOutlined />
      <div className="grow">
        <b>{t("Reviews")}</b>
        {reviews.status === "loading" ? <p className="small muted rv-line">{t("Loading…")}</p> : null}
        {reviews.status === "error" ? <p className="small muted rv-line">{t("Couldn't load the reviews.")}</p> : null}
        {data ? (
          <p className="rv-line rv-summary">
            {data.count ? (
              <>
                <StarRow value={data.average} label={t("{rating} out of 5 stars", { rating: formatRating(data.average) })} />
                <span className="rv-avg" aria-hidden="true">
                  {formatRating(data.average)}
                </span>
                <span className="muted"> · {tn("{count} review", "{count} reviews", data.count)}</span>
              </>
            ) : (
              <span className="muted">{t("No reviews yet.")}</span>
            )}
          </p>
        ) : null}
        {top.length ? (
          <ul className="rv-tags" aria-label={t("Most picked tags")}>
            {top.map((tag) => (
              <TagChip key={tag.id} id={tag.id} count={tag.count} />
            ))}
          </ul>
        ) : null}

        {data && !reviews.loggedIn ? (
          <div className="rv-signin">
            <span className="small muted">{t("Sign in to review this banner.")}</span>
            <button type="button" className="btn tonal sl" onClick={() => window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT))}>
              {t("Sign in")}
            </button>
          </div>
        ) : null}

        {data && reviews.loggedIn ? (
          editing ? (
            <ReviewEditor
              initial={mine}
              initialPending={data.minePending ?? mine?.pending ?? []}
              onCancel={() => setEditing(false)}
              onSave={(stars, tags, suggestions) => reviews.save(stars, tags, suggestions).then(() => setEditing(false))}
              onSuggest={reviews.suggest}
            />
          ) : mine ? (
            <div className="rv-mine">
              <span className="small muted">{t("Your review")}</span>
              <p className="rv-line">
                <StarRow value={mine.stars} label={tn("{count} star", "{count} stars", mine.stars)} />
              </p>
              {mine.tags.length || mine.pending?.length ? (
                <ul className="rv-tags">
                  {mine.tags.map((id) => (
                    <TagChip key={id} id={id} />
                  ))}
                  {(mine.pending ?? []).map((item) => (
                    <PendingChip key={`s${item.suggestionId}`} item={item} />
                  ))}
                </ul>
              ) : null}
              {mine.pending?.length ? <PendingLegend /> : null}
              <div className="pp-actions">
                <button type="button" className="btn text sl" disabled={busy} onClick={() => setEditing(true)}>
                  {t("Edit")}
                </button>
                <button type="button" className="btn text sl" disabled={busy} onClick={remove}>
                  {t("Delete")}
                </button>
              </div>
            </div>
          ) : (
            <div className="pp-actions">
              <button type="button" className="btn tonal sl" onClick={() => setEditing(true)}>
                {t("Rate this banner")}
              </button>
            </div>
          )
        ) : null}
        {error ? <p className="small pp-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
