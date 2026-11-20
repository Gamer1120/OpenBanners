import { useCallback, useEffect, useState } from "react";
import { useBannergressAuth } from "./bannergressSync";
import { call } from "./passphraseApi";
import { REVIEW_TAGS } from "./reviewTags.mjs";

// Banner reviews (stars + tags, no text), kept by the passphrase service
// (server/reviews.mjs). The summary is public; your own review comes along
// when you're signed in.
export const TAG_NAME_MAX = 40;

export const reviewPath = (bannerId) => `/reviews/banners/${encodeURIComponent(bannerId)}`;
export const tagById = new Map(REVIEW_TAGS.map((tag) => [tag.id, tag]));

export const saveReview = (bannerId, stars, tags) => call(reviewPath(bannerId), { method: "PUT", body: { stars, tags } });
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
    async (stars, tags) => {
      const data = await saveReview(bannerId, stars, tags);
      setState({ status: "ready", data, error: "" });
    },
    [bannerId]
  );

  const remove = useCallback(async () => {
    const data = await deleteReview(bannerId);
    setState({ status: "ready", data, error: "" });
  }, [bannerId]);

  const suggest = useCallback((name, kind) => suggestReviewTag(bannerId, name, kind), [bannerId]);

  return { ...state, loggedIn, save, remove, suggest };
}
