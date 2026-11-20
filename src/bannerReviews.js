import { useCallback, useEffect, useState } from "react";
import { useBannergressAuth } from "./bannergressSync";
import { call } from "./passphraseApi";
import { REVIEW_TAGS } from "./reviewTags.mjs";

// Banner reviews (stars + tags, no text), kept by the passphrase service
// (server/reviews.mjs). The summary is public; your own review comes along
// when you're signed in, with your pending suggested tags (minePending, only
// ever sent to you).
export const TAG_NAME_MAX = 40;

export const reviewPath = (bannerId) => `/reviews/banners/${encodeURIComponent(bannerId)}`;
export const tagById = new Map(REVIEW_TAGS.map((tag) => [tag.id, tag]));

// suggestions: ids of your pending suggested tags to keep in the review (left out = dropped).
export const saveReview = (bannerId, stars, tags, suggestions) =>
  call(reviewPath(bannerId), { method: "PUT", body: { stars, tags, ...(suggestions ? { suggestions } : {}) } });
export const deleteReview = (bannerId) => call(reviewPath(bannerId), { method: "DELETE" });
export const suggestReviewTag = (bannerId, name, kind) =>
  call("/reviews/tag-suggestions", { method: "POST", body: { name, kind, bannerId } });

// { status: "idle" | "loading" | "ready" | "error", data, error, loggedIn, save, remove, suggest }
export function useBannerReviews(bannerId) {
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [state, setState] = useState({ status: "idle", data: null, error: "" });

  useEffect(() => {
    if (!bannerId) {
      setState({ status: "idle", data: null, error: "" });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: current.data ? "ready" : "loading" }));
    call(reviewPath(bannerId), { authenticate: loggedIn }).then(
      (data) => !cancelled && setState({ status: "ready", data, error: "" }),
      (error) => !cancelled && setState({ status: "error", data: null, error: error.message })
    );
    return () => {
      cancelled = true;
    };
  }, [bannerId, loggedIn]);

  const save = useCallback(
    async (stars, tags, suggestions) => {
      const data = await saveReview(bannerId, stars, tags, suggestions);
      setState({ status: "ready", data, error: "" });
    },
    [bannerId]
  );

  const remove = useCallback(async () => {
    const data = await deleteReview(bannerId);
    setState({ status: "ready", data, error: "" });
  }, [bannerId]);

  // A suggestion made on the banner is a pending tag in your review: show it right away.
  const suggest = useCallback(
    async (name, kind) => {
      const result = await suggestReviewTag(bannerId, name, kind);
      const suggestion = result?.suggestion;
      if (suggestion?.pending) {
        const item = { suggestionId: suggestion.id, name: suggestion.name, kind: suggestion.kind };
        setState((current) => {
          if (!current.data) {
            return current;
          }
          const add = (list) => [...(list ?? []).filter((p) => p.suggestionId !== item.suggestionId), item];
          const data = { ...current.data, minePending: add(current.data.minePending) };
          if (data.mine) {
            data.mine = { ...data.mine, pending: add(data.mine.pending) };
          }
          return { ...current, data };
        });
      }
      return result;
    },
    [bannerId]
  );

  return { ...state, loggedIn, save, remove, suggest };
}
