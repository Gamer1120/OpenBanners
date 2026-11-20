# Adding a banner review tag

Banner reviews are 1-5 stars plus tags from a fixed list; there is no text.
Visitors can suggest a new tag on a banner page ("Suggest a tag"). The
suggestion never shows on the site: the passphrase bot sends it to the
moderators with a prompt to copy, for example:

    Add the OpenBanners review tag "Muddy paths" (negative) to the test website in all languages.

Michael pastes that prompt into his chat with Ember. This is what Ember then does.
"to the test website" = deploy to test.openbanners.org only; "to the website" =
production, which needs the reviews feature on `main` (check first; if it
isn't there, deploy to test and say so).

## Where things are

- The ONE tag list: `src/reviewTags.mjs` (`id`, `kind` positive/negative,
  English `label` in `tk()`). The site and the server
  (`server/reviews.mjs`) both import it; the server refuses tag ids that
  aren't in it.
- Translations: the English label is the key. `node scripts/i18n-extract.mjs`
  adds it to `src/i18n/keys.json`; each of the 15 locale files
  `src/i18n/locales/<lang>.json` (cs de es fr id it ja ko nl pl pt ru uk
  zh-Hans zh-Hant) needs a translation.
- Suggestions: table `review_tag_suggestions` in the passphrase DB; the bot
  (`server/reviews-telegram.mjs`) sends each one at once; `/tags` in the bot
  re-sends the last 10.

## Steps

1. **Clone.** Follow the `openbanners-web-change` skill step 1 (fresh clone
   under `/mnt/ssd/michael/tmp`, node_modules). Base the work on the branch
   that has the reviews: `git ls-tree origin/main src/reviewTags.mjs`; if
   main doesn't have it yet, `git checkout -b review-tag origin/test`.
2. **Check the name.** Plain words, at most 40 characters, sentence case like
   the existing labels ("Poor GPS signal"). If an existing tag means the same,
   don't add it: tell Michael which one already covers it. Fix obvious typos;
   keep the meaning and the positive/negative from the prompt.
3. **Add one line** to `REVIEW_TAGS` in `src/reviewTags.mjs`, at the end of
   its group (positive lines first, then negative; the order is the display
   order):
   `{ id: "muddy-paths", kind: "negative", label: tk("Muddy paths") },`
   The id is lowercase words with dashes, new and unique. Never rename or
   reuse an id: reviews store it.
4. **Keys.** `node scripts/i18n-extract.mjs` → every locale now shows
   "1 missing".
5. **Translate into all 15 languages** with a small Python script: load each
   locale, set `data[label] = translation`, `dict(sorted(data.items()))`,
   `json.dump(..., ensure_ascii=False, indent=2)` plus a final newline. Reuse
   each locale's existing terms (look at the other tag labels in that file,
   e.g. "Missing portals"): portal = 门户 (zh-Hans), 能量塔 (zh-Hant), 포탈
   (ko), ポータル (ja); banner = 拼圖 in zh-Hant. Keep it as short as the
   English. Run `node scripts/i18n-extract.mjs` again: "0 missing" for every
   locale.
6. **Test.**
   - `node --test server/reviews-tests.mjs server/data-export-tests.mjs`
   - In the background (see the web-change skill):
     `npx vitest run src/i18n src/bannerReviews.test.js src/components/bannerDetails/BannerReviews.test.jsx`
   - `npx -y yarn@1.22.22 build` must succeed.
7. **Commit**: `Review tags: add "<label>" (<kind>)` with the identity from
   the web-change skill step 4.
8. **Deploy to test.** `git fetch -q origin`; rebase onto `origin/test` if
   it moved; `git push origin HEAD:test` (via the gh credential helper as in
   the web-change skill). Then run
   `ssh -i ~/.ssh/id_ed25519_vps -o BatchMode=yes -o IdentitiesOnly=yes root@openbanners.org /root/ProjectPA/deploy_openbanners_test.sh`
   (the push webhook usually doesn't fire). Never push to `main` for a "test
   website" prompt.
9. **Verify live.**
   - `curl -s https://test.openbanners.org/_openbanners/passphrases/v1/reviews/tags`
     lists the new id (the deploy restarted the passphrase service).
   - The built site has the label and its translations: over the same ssh,
     `grep -l '<English label>' /var/www/OpenBanners-test/dist/assets/*.js`
     lists a `bannerDetails-*.js` chunk (the tag list) and the locale chunks;
     `grep -l '<Dutch label>' …/nl-*.js` finds the translation.
10. **Reply** to Michael in one short message: the tag (id, positive/negative),
    "added in all 15 languages", the commit, and that it's live on test.
