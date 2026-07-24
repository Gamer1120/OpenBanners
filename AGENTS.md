# Repository Guidelines

## Project Structure & Module Organization

OpenBanners is a Vite React single-page app. Main application code lives in `src/`, with route-level and UI components in `src/components/`. Banner rerouting logic is grouped under `src/bannerRerouter/`, while shared helpers such as filters, SEO, constants, and sync state live directly in `src/`. Static assets and browser-facing files are in `public/`. Build and prerender tooling lives in `scripts/`; the PHP metadata fallback is in `server/banner-meta.php`. Project notes and manual regression material are in `docs/`.

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
- The Docker image includes PHP-FPM solely for `/banner/:id` metadata fallback. Keep nginx routing for `/banner/` as prerendered static file first, then `server/banner-meta.php`, then normal SPA behavior for unavailable banner metadata.

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

## Commit & Pull Request Guidelines

Recent history uses short imperative commits, with occasional conventional scope prefixes such as `fix(bannerguider): don't open new missions on blank`. Prefer concise subject lines that describe the behavior change, for example `Fix browse pagination after filters`.

Pull requests should include a summary, testing performed (`yarn test`, `yarn build`, manual route checks), linked issues when applicable, and screenshots or screen recordings for visible UI changes. Mention changes that affect deployment, prerendering, or external API assumptions.

## Security & Configuration Tips

Do not commit secrets, local tokens, or production certificate material. Treat `server/banner-meta.php`, prerendered metadata, Docker deployment files, nginx proxy snippets, and third-party API contracts as deployment-sensitive paths; verify them through the GitHub Docker image workflow and live production smoke checks when touched.
