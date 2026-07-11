# Open source front-end for Bannergress
Not associated with Bannergress in any way. Not developed or endorsed by members of the Bannergress team.

This project attempts to improve certain aspects of the Bannergress front-end, while being open-source from the start.

## Current State

This codebase has been mostly untouched for multiple years and is currently in a stabilization phase.

- The app now builds and runs with Vite instead of Create React App.
- The app depends on live third-party APIs and CDNs, so breakage can come from upstream changes even if the local code does not change.
- The first maintenance priority was preserving current behavior with smoke tests before changing the toolchain.

## Local Development

This repo is now set up primarily for Yarn.

Install dependencies and start the dev server:

```bash
yarn install
yarn dev
```

Useful commands:

```bash
yarn test
yarn build
yarn preview
yarn prerender:banner <banner-id>
```

## Docker Image

The repository includes a production Docker image definition and a GitHub Actions workflow at `.github/workflows/docker-image.yml`.

Build and run the image locally:

```bash
yarn build
docker build -t openbanners .
docker run --rm -p 8080:80 openbanners
```

Then open `http://localhost:8080`.

The container copies the existing `dist/` directory into nginx and includes PHP-FPM only for dynamic `/banner/:id` metadata fallback. Non-banner routes are still served as static SPA files.

The GitHub Actions workflow installs dependencies with Yarn cache, runs `yarn build`, and then builds the small static image. Pull requests build the image without publishing it. Pushes to `main`, `v*.*.*` tags, and manual `workflow_dispatch` runs publish to GitHub Container Registry. The workflow lowercases the repository path because container image names must be lowercase, producing tags such as:

```text
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:main
ghcr.io/<owner>/<repo>:sha-<commit>
```

Use a published image:

```bash
docker pull ghcr.io/<owner>/<repo>:latest
docker run --rm -p 8080:80 ghcr.io/<owner>/<repo>:latest
```

## Banner metadata prerender and fallback

Telegram and similar crawlers only read the initial HTML, so client-side meta updates are not enough for `/banner/:id` previews.

This repo supports two layers for banner metadata:

1. Preferred static prerender for known banner ids
2. A generic server-side fallback for any other `/banner/:id`

Static prerender:

```bash
yarn build
yarn prerender:banner nieuwe-werk-kop-van-zuid-8aa1
```

That command fetches Bannergress JSON for each requested banner id and writes a static HTML file to:

```text
dist/banner/<banner-id>/index.html
```

For banner ids that are not prerendered yet, the Docker deployment uses `server/banner-meta.php` as a fallback renderer. It reads the built SPA shell, fetches the requested Bannergress banner, injects the banner-specific metadata into the initial HTML, and still returns the normal SPA shell.

This keeps the deployment free of a dedicated Node metadata server while still making any banner URL previewable.

In production, nginx should prefer prerendered files for `/banner/:id`, then fall back to the PHP renderer, and only then fall back to the generic SPA shell when banner data is unavailable.

## External Dependencies

The current app relies on the following external services and assets:

- Bannergress API: banner, place, and search data are fetched from `https://api.bannergress.com`
- OpenStreetMap tiles: map tiles are loaded from `https://tile.openstreetmap.org`
- Google Fonts: Roboto is loaded from `https://fonts.googleapis.com`
- Google Maps deep links: start-point navigation uses `https://www.google.com/maps/dir`
- Ingress deep links: BannerGuider opens mission links via `https://link.ingress.com`

If any of those contracts change, the app may still build while key user flows fail at runtime.

## Stabilization Baseline

The repo now includes smoke tests for the most important user flows:

- nearby banners after granting geolocation access
- browsing banners and places
- search results for places and banners
- banner details rendering
- map markers linking to banner details

These tests are intentionally shallow. They are meant to catch obvious route and API regressions before larger refactors.

## Recommended Next Step

The core tooling migration is complete. The next maintenance project should focus on product-level cleanup: simplifying the remaining route/component structure and hardening runtime behavior around external APIs.

## Bannergress Authentication and Sync

OpenBanners uses Bannergress's OIDC authorization-code flow with PKCE on the supported HTTPS OpenBanners domains. Tokens remain in same-origin browser storage and are sent only to Bannergress login and API endpoints.

- Select **Authenticate** in the OpenBanners top bar and complete the Bannergress login popup.
- OpenBanners refreshes the short-lived access token when necessary and automatically syncs `todo`, `done`, and `blacklist` banner states.
- Authentication is enabled on `test.openbanners.org`, `openbanners.org`, and `www.openbanners.org`; normal local Vite origins cannot complete the production OIDC callback.

The integration depends on Bannergress's current login and API contracts and is not an official Bannergress client.

### Banner Together

Open a specific place under `/browse/:placeId` and select **Together** to compare that place's Bannergress to-do banners with another agent.

- The creator authenticates on their own device and copies a snapshot invite containing only their to-do banner IDs for that place.
- The recipient authenticates on their own device. OpenBanners requests their current to-do banners for the same place and computes the intersection locally.
- Bannergress access, refresh, and ID tokens are never added to the invite.
- The snapshot is stored in the URL fragment, so it is not sent to OpenBanners in the HTTP request. Anyone who receives the link can still decode the included banner IDs.
- Snapshot invites expire after seven days and are capped at a 16 KiB URL fragment and 1,000 banner IDs. Use a more specific place when either limit is exceeded.
- Ordinary invites use raw UTF-8-safe encoding. Larger invites use gzip only when the creator browser supports it; recipients of those larger links also need browser gzip-stream support.

This first version uses snapshots rather than a live room. The creator does not automatically receive the recipient's result, but the recipient can copy a result link containing only the intersection and send it back. A copied snapshot cannot be revoked from OpenBanners because there is no server-side invite state.
