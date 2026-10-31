// Maths of the banner artwork viewer (BannerViewer.jsx) and the hero picture.
// Tile sizes are CSS pixels of one mission tile; the gap between tiles grows with it.

// Gap between tiles as a share of the tile size (6 px at 100 px, like the hero's 4 px at 56 px).
export const GAP_RATIO = 0.06;
// Largest zoom: one tile this big (mission pictures are fetched up to 640 px).
export const MAX_TILE = 480;
// The viewer never opens with tiles bigger than this (a 6-mission banner on a wide screen).
export const MAX_START_TILE = 200;
// Below this the viewer shows the banner's own picture instead of 1 000+ tiny tiles.
export const COMPOSITE_BELOW = 28;
// Mission numbers are only drawn on tiles at least this big.
export const NUMBERS_FROM = 26;
// The hero shows at most this many rows of tiles; taller banners pan through them.
export const HERO_ROWS = 3;

export function getTileGap(tile) {
  return tile * GAP_RATIO;
}

// Size of the whole mosaic for tile size `tile`.
export function getMosaicSize(tile, columns, rows) {
  const gap = getTileGap(tile);

  return {
    width: columns * tile + (columns - 1) * gap,
    height: rows * tile + (rows - 1) * gap,
  };
}

// Largest tile size at which `columns` × `rows` tiles fit in width × height.
export function getFitTile(width, height, columns, rows) {
  const byWidth = width / (columns + Math.max(0, columns - 1) * GAP_RATIO);
  const byHeight = height / (rows + Math.max(0, rows - 1) * GAP_RATIO);

  return Math.max(1, Math.min(byWidth, byHeight));
}

// How big the tiles are when the viewer opens, the same rule for every banner: the whole
// banner when its tiles are still a comfortable size there, otherwise full width with
// tiles of a comfortable size (one row in about a seventh of the screen height) that
// scroll vertically. Never bigger than MAX_START_TILE.
export function getStartTile(width, height, columns, rows) {
  const whole = getFitTile(width, height, columns, rows);
  const fullWidth = getFitTile(width, Infinity, columns, rows);
  const comfortable = Math.min(160, Math.max(72, height / 7));

  return Math.min(MAX_START_TILE, Math.max(whole, Math.min(fullWidth, comfortable)));
}

// Zoom range: from the whole banner on screen (or the start size, if smaller) to MAX_TILE.
export function getTileRange(width, height, columns, rows) {
  const whole = getFitTile(width, height, columns, rows);
  const start = getStartTile(width, height, columns, rows);

  return { min: Math.min(whole, start), max: Math.max(MAX_TILE, start) };
}

export function clampTile(tile, range) {
  return Math.min(range.max, Math.max(range.min, tile));
}

// Mission picture size to request for a tile (Google image `=sN`), in a few steps so
// zooming doesn't refetch every picture at every size.
export function getPictureSize(tile, pixelRatio = 1) {
  const needed = tile * Math.max(1, Math.min(3, pixelRatio || 1));

  return [80, 160, 320, 640].find((size) => size >= needed) ?? 640;
}

// Bannergress's pan timing (5 s down, 1 s pause, 1 s up, 1 s pause), slowed down for
// banners that are many screens tall: 5 s per window height on the way down (a
// 192-row banner would otherwise race past in a blur) and 2 s back up.
export function getPanTiming(overflow, windowHeight) {
  const screens = windowHeight > 0 ? overflow / windowHeight : 1;
  const down = 5000 * Math.max(1, screens);
  const up = screens > 1 ? 2000 : 1000;
  const pause = 1000;

  return { down, up, pause, total: down + pause + up + pause };
}
