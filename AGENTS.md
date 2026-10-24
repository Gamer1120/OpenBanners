# Repository Guidelines

## Project Structure & Module Organization

OpenBanners is a Vite React single-page app. Main application code lives in `src/`, with route-level and UI components in `src/components/`. Banner rerouting logic is grouped under `src/bannerRerouter/`, while shared helpers such as filters, SEO, constants, and sync state live directly in `src/`. Static assets and browser-facing files are in `public/`. Build and prerender tooling lives in `scripts/`; the TypeScript metadata fallback is in `server/banner-meta.mts` (tests in `server/banner-meta-tests.mts`). Project notes and manual regression material are in `docs/`.

Tests are colocated with the code they cover using `*.test.js` or `*.test.jsx`, for example `src/App.test.jsx` and `src/bannerRerouter/routeGenerator.test.js`.

## Build, Test, and Development Commands

Use Yarn 1, as pinned in `package.json`.

- `yarn install`: install dependencies from `yarn.lock`.
- `yarn dev` or `yarn start`: run the Vite development server for local debugging.
- `yarn test`: run Vitest once in jsdom.
- `yarn build`: create the production build in `dist/`.
- `yarn preview`: serve the built app locally for debugging a built bundle.
- `yarn prerender:banner <banner-id>`: generate static metadata HTML for a banner after a build.
- `docker compose -f docker-compose.public.yml up -d`: run the published GHCR image on local backend port `18080`; nginx exposes it publicly on the existing HTTPS port `443` using `docker/openbanners-nginx-container-location.conf` from the `openbanners.org` vhost. The included Watchtower service checks for new images and updates the container automatically.
- Do not deploy production by running `yarn build` locally or by restarting nginx for app code changes. After a completed change, commit and push to GitHub, wait for the Docker image workflow to publish `ghcr.io/gamer1120/openbanners:latest`, let Watchtower update the `openbanners-public` container, and then verify production at `https://openbanners.org/`.
- Always commit and push completed changes after verification; use the GitHub Docker image plus Watchtower path for production testing.
- The Docker image runs no PHP: it is based on `node:24-alpine`, and the build fails if a `php*` binary is present; nginx also returns 404 for `.php` URLs. `/banner/:id` metadata fallback is `server/banner-meta.mts`, run directly by Node (erasable TypeScript syntax only: no enums, namespaces or parameter properties; import local files with their `.mts` extension). Keep nginx routing for `/banner/` as prerendered static file first, then the metadata service on `127.0.0.1:8788`, then normal SPA behavior when it is unavailable. Run `node --test server/banner-meta-tests.mts` after changing it; the Docker build runs it too.

## Coding Style & Naming Conventions

Follow the existing JavaScript and JSX style: 2-space indentation, double quotes, semicolons, and ES module imports. React components use PascalCase file and function names, such as `BannerDetailsPage.jsx`; utilities use camelCase, such as `bannerFilters.js`. Keep component-specific styling near the component when practical, and avoid broad refactors when making targeted fixes in this stabilization-focused codebase.

There is no dedicated lint or format script in this repository. Match nearby code and run tests/builds before submitting changes.

## Continuous Learning

When a workflow, deployment step, testing note, or project-specific convention is discovered while working, add it to `AGENTS.md` in a concise, durable form so future agents can build on it.

Multiple agents may work in this repository at the same time. Before starting larger or risky work, check the current branch and worktree state, avoid overwriting unrelated changes, and prefer a separate `git worktree` for isolated parallel work when it would reduce coordination risk.

## Testing Guidelines

The test stack is Vitest, jsdom, and Testing Library, configured in `vite.config.mjs` with setup in `src/setupTests.js`. Add focused regression tests for route behavior, filtering, map interactions, rerouting logic, and API-state handling when those areas change. Mock external services and browser APIs in tests; the live app depends on Bannergress, OpenStreetMap, Google Fonts, Google Maps links, and Ingress links.

Local debugging with `yarn dev`, `yarn preview`, or focused tests is fine while developing. Always test changes on production as part of final verification after the GitHub Docker image workflow and Watchtower update have completed.

For `/map`, discovery banner loading should render each fetched page immediately; do not wait for every page in the viewport before plotting markers. Loaded discovery pages should remain cached in memory until the browser page is refreshed.

The `/map` marker toggle supports image markers and Bannergress-style dots; dot colors should continue to reflect the effective Bannergress list state.

In `/map` dot marker mode, overlapping banners should cluster into numbered dots instead of being displaced with connector lines.

When a `/map` dot marker cluster opens the disambiguation picker, render the choices as list-colored dots rather than banner thumbnails.

Mixed `/map` dot marker clusters should use segmented colors for the represented list states, and single dot markers should expose the banner title on hover.

For `/map`, list-state filters such as to-do-only and show-done depend on Bannergress list metadata and should remain mutually exclusive with Show hidden banners.

Banner Together creates live peer rooms under `/together/:placeId/live/:roomId`. Keep the room secret in the invite fragment and keep Bannergress tokens out of every room request. Todo, Done, and Hide snapshots must travel only as end-to-end encrypted WebRTC data-channel messages after each participant explicitly enables sharing. The v3 signaling service may hold only bounded room verifiers, hashed participant tokens, presence, and native SDP/ICE messages in memory; it must not accept application payloads, write room state to disk, or use a database. Rooms support at most eight peers, expire after four hours, and disappear when no peers remain. Cache private membership snapshots only in the browser, scoped to the authenticated account and place, for less than four hours; show the snapshot age and keep a manual refresh action. `/api/` and retired Banner Together API versions must return 404. Legacy `#banner-together=` snapshot links remain read-only until their normal expiry.

Banner Together offline sharing is a separate, default-off opt-in that is available only while **Share my lists** is enabled. Encode that preference inside the encrypted peer snapshot; peers may retain an opted-in snapshot in browser memory after disconnect, but the signaling service must never store it.

On `/together/` routes, do not run the TopMenu full-account list auto-sync; the route owns its place-scoped membership and catalog caches. Bannergress `/bnrs` pages are capped at 100. Banner Together should probe the first page and then use bounded four-request windows, and it must classify singular private-list requests by the requested list because `BannerDto.listType` is optional.

Banner pictures (`banner.picture`) are rendered only through `src/components/BannerImage.jsx`, which owns the tall-banner pan (2 s down / 1 s up, also under reduced motion, no pan below 3 % or 12 px overflow). `src/bannerImageGuard.test.js` fails if a component renders the picture itself. Mission pictures are not affected.

## Commit & Pull Request Guidelines

Recent history uses short imperative commits, with occasional conventional scope prefixes such as `fix(bannerguider): don't open new missions on blank`. Prefer concise subject lines that describe the behavior change, for example `Fix browse pagination after filters`.

Pull requests should include a summary, testing performed (`yarn test`, `yarn build`, manual route checks), linked issues when applicable, and screenshots or screen recordings for visible UI changes. Mention changes that affect deployment, prerendering, or external API assumptions.

## Security & Configuration Tips

Do not commit secrets, local tokens, or production certificate material. Treat `server/banner-meta.mts`, prerendered metadata, Docker deployment files, nginx proxy snippets, and third-party API contracts as deployment-sensitive paths; verify them through the GitHub Docker image workflow and live production smoke checks when touched.

## Design X (Material 3) UI

The app shell, Home, Browse, Search, Lists and the banner page follow prototype "X" (2026-10-20): Material 3 tokens in `src/m3.css` (light/dark via `data-theme` on `<html>`, set by `src/themeMode.js`; the theme choice lives in the top bar's More menu). Map, Banner Together and the Rerouter still use the original dark styling through the `LegacyDark` wrapper in `Home.jsx`. Keep these decisions: Home has no map (search + Nearby/Map/Browse + "Banners in <city>" + near-you wall); Browse shows places as a folded chip cloud, only Wall and List views, infinite scroll, mosaic tiles one column wide with tall art panning inside the tile; showing offline banners is never persisted; banner page shows route lines, a Start flag and numbered mission starts, portal links are `geo:` URIs, unavailable waypoints are struck through, and each mission links to Ingress (`link.ingress.com`) and Intel. Country flags use the self-hosted Twemoji Country Flags font (`public/fonts`) so they render on Windows.

## Passphrase answers

`server/passphrases.mjs` (node:sqlite, no dependencies; tests `node --test server/passphrases-tests.mjs`) serves `/_openbanners/passphrases/v1/`. Reading is public; submitting, voting and author actions send the Bannergress access token, which the server checks with Bannergress `GET /user` and never stores or logs. Authors are only the *verified* agent from `/user` (`agent.name`), matched to mission authors from an authenticated `/bnrs/:id`; `preferred_username` is not proof. "Mission number" answers go live once a moderator approves them, other answers need a moderator too and wait 30 days unless an author approves sooner; each account may add 500 answers a day, except the verified agent names in `OPENBANNERS_UNLIMITED_AGENTS` (comma-separated); an author objection (one banner or all their banners) deletes the answers permanently and blocks new ones. Typed crowd answers also need a moderator's approval: `server/passphrases-telegram.mjs` (started by the service when `OPENBANNERS_TELEGRAM_BOT_TOKEN` is set; moderators are the Telegram user ids in `OPENBANNERS_TELEGRAM_MODERATORS`) sends one message per banner, once nobody has added answers to it for 15 minutes (`OPENBANNERS_TELEGRAM_QUIET_MINUTES`), with Approve all (still waits the 30 days) / Publish all now / Reject all and a Per answer view; it has /pending, /blocks, /block, /unblock and /contact. Other people writing to the bot get the how-to-object text and are forwarded to the moderators. Only one service may poll a bot token, so test and production need different bots. `server/passphrases-admin.mjs` lists pending answers with authors and contact attempts, and applies objections that arrive outside the site (e.g. Telegram).

On test it runs as `openbanners-passphrases-test.service` (user `openbanners`, port 8790, DB `/var/lib/openbanners-passphrases-test/passphrases.sqlite`, bot token (@TestOpenBannersPassphraseBot) and moderators in the root-only `/etc/openbanners/passphrases-test.env`; the production bot @OpenBannersPassphraseBot is waiting in `/etc/openbanners/passphrases-prod.env`); the test deploy script restarts it, the test nginx vhost proxies the path, and `/usr/local/sbin/vps-backup-run` copies every `/var/lib/openbanners-passphrases-*/passphrases.sqlite` into the nightly restic backup. In production the Docker entrypoint runs it on port 8789 behind `docker/nginx.conf`, with the DB on the `/data` volume (host `/var/lib/openbanners-passphrases-prod`, owned by uid 1000) and the bot settings from `env_file: /etc/openbanners/passphrases-prod.env` (@OpenBannersPassphraseBot); the VPS compose file `/var/www/OpenBanners/docker-compose.public.yml` has the same volume and env_file. The Docker build runs the passphrase tests.

Personal banner notes (`src/bannerNotes.js`, `src/components/bannerDetails/BannerNotes.jsx`, Settings → My notes) show only while logged in. They are encrypted in the browser with AES-GCM (account and banner id as associated data) using a random 256-bit key per Bannergress account kept in `localStorage` (`openbanners-notes-keys`); the passphrase service stores only ciphertext and the key's SHA-256 fingerprint (`notes`, `note_keys` tables, `/notes`, `/notes/banners/:id`, `/notes/reset`) and refuses notes under a different key for the same account. The key reaches another device only through a `/#notes-key=…` link from Settings, which `captureNotesKeyFromUrl` strips from the address at start-up; never send the key to a server or log it. A lost key can't be recovered: "Start over" deletes the account's notes.
