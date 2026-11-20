// Banner review tags: the ONE list, used by the site
// (src/components/bannerDetails/BannerReviews.jsx) and the server
// (server/reviews.mjs, which refuses any tag id that isn't here).
// How to add a tag (translations, tests, deploy): docs/review-tags.md.
// - id: lowercase words with dashes. Stored in people's reviews, so never
//   rename or reuse one; to retire a tag, delete its line (old reviews keep
//   the id, but it isn't counted or shown any more).
// - kind: "positive" or "negative" (shown green / red, in their own group).
// - label: the English text in tk(), so scripts/i18n-extract.mjs lists it in
//   src/i18n/keys.json; every src/i18n/locales/<lang>.json translates it under
//   the same English key.
// No imports: Node imports this file directly (server/reviews.mjs), hence .mjs.
const tk = (text) => text;

export const REVIEW_TAGS = [
  { id: "scenic-route", kind: "positive", label: tk("Scenic route") },
  { id: "nice-landmarks", kind: "positive", label: tk("Nice landmarks") },
  { id: "short-walks", kind: "positive", label: tk("Short walk between missions") },
  { id: "accessible-portals", kind: "positive", label: tk("Accessible portals") },
  { id: "easy-parking", kind: "positive", label: tk("Easy parking") },
  { id: "good-for-cycling", kind: "positive", label: tk("Good for cycling") },
  { id: "family-friendly", kind: "positive", label: tk("Family friendly") },
  { id: "safe-at-night", kind: "positive", label: tk("Safe at night") },
  { id: "portals-inaccessible", kind: "negative", label: tk("Portals inaccessible") },
  { id: "missing-portals", kind: "negative", label: tk("Missing portals") },
  { id: "long-detours", kind: "negative", label: tk("Long detours") },
  { id: "busy-traffic", kind: "negative", label: tk("Busy traffic") },
  { id: "poor-gps", kind: "negative", label: tk("Poor GPS signal") },
  { id: "steep-hills", kind: "negative", label: tk("Steep hills") },
  { id: "no-shade", kind: "negative", label: tk("No shade") },
  { id: "unsafe-at-night", kind: "negative", label: tk("Unsafe at night") },
];

export const REVIEW_TAG_KINDS = ["positive", "negative"];
