import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bannergressSync", () => ({
  fetchBannergress: (url) => globalThis.fetch(url),
}));

import {
  resetDiscoveryMapData,
  tileBounds,
  tileLevelFor,
  tilesForArea,
  useDiscoveryMapBanners,
} from "./discoveryMapData";

const area = (lat, lng, span) => ({
  minLatitude: lat - span / 2,
  maxLatitude: lat + span / 2,
  minLongitude: lng - span / 2,
  maxLongitude: lng + span / 2,
  centerLatitude: lat,
  centerLongitude: lng,
});

const banner = (id, lat, lng) => ({ id, startLatitude: String(lat), startLongitude: String(lng) });
const ENSCHEDE = [banner("a", 52.22, 6.89), banner("b", 52.23, 6.9)];
const filters = { showOfflineBanners: false, showHiddenBanners: false };

// Answers each tile with the banners inside its box, like Bannergress.
function serve() {
  globalThis.fetch = vi.fn(async (url) => {
    const q = new URL(url).searchParams;
    const inside = ENSCHEDE.filter(
      (b) =>
        Number(b.startLatitude) >= Number(q.get("minLatitude")) &&
        Number(b.startLatitude) <= Number(q.get("maxLatitude")) &&
        Number(b.startLongitude) >= Number(q.get("minLongitude")) &&
        Number(b.startLongitude) <= Number(q.get("maxLongitude"))
    );
    return { json: async () => (Number(q.get("offset")) ? [] : inside) };
  });
}

describe("discovery map tiles", () => {
  beforeEach(() => {
    resetDiscoveryMapData();
    serve();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers a view with 2-3 tiles per side", () => {
    const view = area(52.22, 6.89, 0.05);
    const level = tileLevelFor(view);
    const tiles = tilesForArea(view, level);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(9);
    const size = tileBounds(tiles[0]).maxLongitude - tileBounds(tiles[0]).minLongitude;
    expect(size).toBeGreaterThanOrEqual(0.025);
    expect(size).toBeLessThan(0.1);
  });

  it("zooming in, back out and panning back fetches nothing again", async () => {
    const { result, rerender } = renderHook(
      ({ view }) => useDiscoveryMapBanners(view, null, filters),
      { initialProps: { view: area(52.22, 6.89, 0.2) } }
    );
    await waitFor(() => expect(result.current.banners.map((b) => b.id).sort()).toEqual(["a", "b"]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = globalThis.fetch.mock.calls.length;

    rerender({ view: area(52.225, 6.895, 0.05) }); // zoom in: inside loaded tiles
    await waitFor(() => expect(result.current.banners.map((b) => b.id).sort()).toEqual(["a", "b"]));
    rerender({ view: area(52.22, 6.89, 0.2) }); // back out
    await waitFor(() => expect(result.current.banners).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(globalThis.fetch.mock.calls.length).toBe(calls);
  });

  it("a new area does fetch, one zoom level out is one tile level up", async () => {
    const view = area(52.22, 6.89, 0.05);
    const level = tileLevelFor(view);
    const { result, rerender } = renderHook(
      ({ v }) => useDiscoveryMapBanners(v, null, filters),
      { initialProps: { v: view } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = globalThis.fetch.mock.calls.length;
    // One level out, a view that only needs the parent of tiles already loaded
    // would reuse them; a far-away view must fetch.
    rerender({ v: area(10, 10, 0.05) });
    await waitFor(() => expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(first));
    expect(tileLevelFor(area(52.22, 6.89, 0.1))).toBe(level - 1);
  });
});
