# Regression Checklist

Run the app with:

```bash
yarn dev
```

Compare against `https://openbanners.org` where applicable.

## Core Routes

### `/`

- Top menu background matches the original dark bar.
- `OB` title is clickable.
- `Browse` and `Map` buttons are stacked vertically on desktop.
- Search field sits on the right side of the menu.
- Disclaimer text is visible.
- Clicking `Grant location access` loads nearby banners.
- Nearby banner cards render without stretched images.
- `Load more...` increases the number of rendered cards.

### `/browse/`

- Header reads `Browsing`.
- Country list renders on the left on desktop.
- Country flags render correctly for known aliases:
  - `Curacao` -> `🇨🇼`
  - `Republic of Korea` -> `🇰🇷`
  - `The Netherlands` -> `🇳🇱`
- Banner cards render at consistent heights.
- Sorting controls still work.
- Toggling offline banners still changes results.

### `/browse/:placeId`

- Clicking a place link updates the route.
- Place-specific banners load.
- Efficiency sorting still works for a populated place.

### `/search/:query`

- Matching places render above banner results.
- Clicking a place result navigates to `/browse/:placeId`.
- Banner cards render below the divider.
- No layout collapse when the query returns both places and banners.

### `/banner/:bannerId`

- Banner title, description, and actions render.
- Share action is available.
- Embedded map still loads.
- Banner image is not stretched.

### `/map`

- Map loads without console errors.
- Banner marker images are not stretched.
- Marker previews keep their intended aspect ratio.
- Clicking a marker navigates to `/banner/:id`.

### `/bannerguider/:bannerId`

- Route loads without a blank screen.
- Main controls and map render.
- No obvious overflow or full-height layout regression.

### `/bannerguiderwithoutlocation/:bannerId`

- Route loads without a blank screen.
- Main controls and map render.

## Visual Focus Areas

- Top menu spacing, alignment, and background color.
- Country flag rendering and alignment.
- Card heights in browse/search/nearby sections.
- Map marker aspect ratios.
- Mobile wrapping behavior for the menu and content grids.

## Basic Console Checks

- No React render errors.
- No obvious routing errors after navigation.
- No repeated fetch loops while sitting idle on a page.

