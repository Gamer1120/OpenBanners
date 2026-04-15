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
```

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

## Bannergress Sync Prototype

This repo now includes a prototype bridge for importing Bannergress `todo`, `done`, and `hidden` lists into OpenBanners, and for letting OpenBanners make authenticated Bannergress banner requests with a short-lived access token supplied by the userscript.

- Install the userscript from `/userscripts/openbanners-bannergress-sync.user.js` on the deployed site.
- Log into `https://bannergress.com/` in the same browser.
- Click `Sync Lists` in the OpenBanners top bar.

The current approach is unofficial. It relies on a userscript running on both `bannergress.com` and OpenBanners domains. The userscript keeps Bannergress auth in userscript storage, refreshes the access token when needed, and provides either:

- synced list state for `todo`, `done`, and `hidden` banner badges
- an access token that OpenBanners can use for authenticated `api.bannergress.com` banner requests
