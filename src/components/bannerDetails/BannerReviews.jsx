import React, { useEffect, useState } from "react";
import { RateReviewOutlined, Star, StarBorder, StarHalf, ThumbDownOutlined, ThumbUpOutlined } from "@mui/icons-material";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../../bannergressSync";
import { TAG_NAME_MAX, tagById, useBannerReviews } from "../../bannerReviews";
import { REVIEW_TAGS } from "../../reviewTags.mjs";
import { getLanguage, t, tn } from "../../i18n";

// Banner reviews on the banner page (Overview tab): average stars, number of
// reviews and the most picked tags for everyone; signed in, your own review
// (1-5 stars + tags from src/reviewTags.mjs, never text) with Edit / Delete,
// and "Suggest a tag", which only reaches the moderators.
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

function ReviewEditor({ initial, onSave, onCancel }) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [tags, setTags] = useState(initial?.tags ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id) => setTags((current) => (current.includes(id) ? current.filter((tag) => tag !== id) : [...current, id]));
  const save = () => {
    setBusy(true);
    setError("");
    onSave(stars, tags).then(
      () => setBusy(false),
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };
  const group = (kind, title) => (
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
              {kind === "positive" ? <ThumbUpOutlined fontSize="inherit" /> : <ThumbDownOutlined fontSize="inherit" />}
              {t(tag.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
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

function SuggestTag({ onSuggest }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("positive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (!open) {
    return (
      <div>
        <button type="button" className="btn text sl rv-suggest-open" onClick={() => { setOpen(true); setSent(false); }}>
          {t("Suggest a tag")}
        </button>
        {sent ? <p className="small muted" role="status">{t("Thanks! Your tag suggestion was sent.")}</p> : null}
      </div>
    );
  }
  const send = (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    onSuggest(name.trim(), kind).then(
      () => {
        setBusy(false);
        setName("");
        setSent(true);
        setOpen(false);
      },
      (e) => {
        setBusy(false);
        setError(e.message);
      }
    );
  };
  return (
    <form className="rv-suggest" onSubmit={send}>
      <b>{t("Suggest a tag")}</b>
      <input
        className="pp-input"
        aria-label={t("Tag name")}
        placeholder={t("Tag name")}
        value={name}
        maxLength={TAG_NAME_MAX}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <div className="rv-kinds" role="radiogroup" aria-label={t("Positive or negative")}>
        {["positive", "negative"].map((value) => (
          <label key={value} className="rv-kind">
            <input type="radio" name="rv-kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
            {value === "positive" ? t("Positive") : t("Negative")}
          </label>
        ))}
      </div>
      <span className="small muted">{t("Your suggestion goes to the OpenBanners team. It doesn't show on the site.")}</span>
      <div className="pp-actions">
        <button type="submit" className="btn filled sl" disabled={busy || name.trim().length < 2}>
          {busy ? t("Sending…") : t("Send")}
        </button>
        <button type="button" className="btn text sl" disabled={busy} onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
    </form>
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
              onCancel={() => setEditing(false)}
              onSave={(stars, tags) => reviews.save(stars, tags).then(() => setEditing(false))}
            />
          ) : mine ? (
            <div className="rv-mine">
              <span className="small muted">{t("Your review")}</span>
              <p className="rv-line">
                <StarRow value={mine.stars} label={tn("{count} star", "{count} stars", mine.stars)} />
              </p>
              {mine.tags.length ? (
                <ul className="rv-tags">
                  {mine.tags.map((id) => (
                    <TagChip key={id} id={id} />
                  ))}
                </ul>
              ) : null}
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
        {data && reviews.loggedIn && !editing ? <SuggestTag onSuggest={reviews.suggest} /> : null}
        {error ? <p className="small pp-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
