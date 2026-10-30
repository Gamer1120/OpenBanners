import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bannergressSync", () => ({
  fetchBannergress: (url, options) => globalThis.fetch(url, options),
}));

import {
  MIN_LOAD_TILE_LEVEL,
  comparePagePriority,
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

  it("asks Bannergress nothing for a world or continent view, and says so", async () => {
    const { result, rerender } = renderHook(
      ({ view }) => useDiscoveryMapBanners(view, null, filters),
      { initialProps: { view: area(25, 10, 120) } } // the default world view
    );
    expect(result.current.tooFarOut).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the debounce
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    rerender({ view: area(52, 7, 20) }); // a big country: still nothing
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(globalThis.fetch).not.toHaveBeenCalled();

    rerender({ view: area(52.22, 6.89, 0.2) }); // zoomed in: loads
    expect(result.current.tooFarOut).toBe(false);
    await waitFor(() => expect(result.current.banners.map((b) => b.id).sort()).toEqual(["a", "b"]));

    rerender({ view: area(25, 10, 120) }); // back out: keeps what it has
    await new Promise((resolve) => setTimeout(resolve, 400));
    const calls = globalThis.fetch.mock.calls.length;
    expect(result.current.banners.map((b) => b.id).sort()).toEqual(["a", "b"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(globalThis.fetch.mock.calls.length).toBe(calls);
  });

  it("loads from about country size (tile level " + MIN_LOAD_TILE_LEVEL + ")", () => {
    expect(tileLevelFor(area(52, 7, 11))).toBe(MIN_LOAD_TILE_LEVEL);
    expect(tileLevelFor(area(52, 7, 12))).toBe(MIN_LOAD_TILE_LEVEL - 1);
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

  it("zoom out keeps the already-loaded dots while the bigger tiles load", async () => {
    const { result, rerender } = renderHook(
      ({ view }) => useDiscoveryMapBanners(view, null, filters),
      { initialProps: { view: area(52.225, 6.895, 0.05) } }
    );
    await waitFor(() => expect(result.current.banners.map((b) => b.id).sort()).toEqual(["a", "b"]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The bigger tiles never answer: only what is already loaded can show.
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    rerender({ view: area(52.225, 6.895, 0.4) }); // a few levels out
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.banners.map((b) => b.id).sort()).toEqual(["a", "b"]);
  });

  it("orders waiting pages newest view first, then nearest the centre", () => {
    const waiting = [
      { name: "old-centre", generation: 1, distance: 0 },
      { name: "new-edge", generation: 2, distance: 4 },
      { name: "new-centre", generation: 2, distance: 1 },
    ];
    expect(waiting.sort(comparePagePriority).map((w) => w.name)).toEqual([
      "new-centre",
      "new-edge",
      "old-centre",
    ]);
  });

  it("zooming out and then in elsewhere loads the new view first and stops the old tiles", async () => {
    // A zoomed-out area with endless full pages that are slow to answer, and
    // a far-away area that answers at once.
    const FAR = [banner("far", 40.42, -3.7)];
    const requests = [];
    globalThis.fetch = vi.fn((url, options) => {
      const q = new URL(url).searchParams;
      const far = Number(q.get("maxLatitude")) < 45;
      requests.push({ far, offset: Number(q.get("offset")), signal: options?.signal });
      if (far) {
        return Promise.resolve({ json: async () => (Number(q.get("offset")) ? [] : FAR) });
      }
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        setTimeout(() => {
          const page = Array.from({ length: 50 }, (_, i) =>
            banner(`z${q.get("minLatitude")}:${q.get("minLongitude")}:${q.get("offset")}:${i}`, 52, 6)
          );
          resolve({ json: async () => page });
        }, 150);
      });
    });

    const { result, rerender } = renderHook(
      ({ view }) => useDiscoveryMapBanners(view, null, filters),
      { initialProps: { view: area(52, 6, 8) } } // zoomed out: big tiles
    );
    await waitFor(() => expect(requests.filter((r) => !r.far).length).toBeGreaterThanOrEqual(3));
    expect(requests.filter((r) => !r.far).length).toBe(3); // at most 3 at a time

    rerender({ view: area(40.42, -3.7, 0.05) }); // zoom in somewhere else
    await waitFor(() => expect(result.current.banners.map((b) => b.id)).toEqual(["far"]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The old tiles' open requests get aborted and nothing more is asked for them.
    await waitFor(() => expect(requests.some((r) => !r.far && r.signal?.aborted)).toBe(true));
    const oldCount = requests.filter((r) => !r.far).length;
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(requests.filter((r) => !r.far).length).toBe(oldCount);
  });

  it("a tile stopped part-way continues from the next page when it is needed again", async () => {
    const pages = [];
    globalThis.fetch = vi.fn((url, options) => {
      const q = new URL(url).searchParams;
      const offset = Number(q.get("offset"));
      pages.push(offset);
      if (offset === 0) {
        const page = Array.from({ length: 50 }, (_, i) => banner(`p${i}`, 52.22, 6.89));
        return Promise.resolve({ json: async () => page });
      }
      // Later pages hang until aborted.
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const here = area(52.22, 6.89, 0.0001);
    expect(tilesForArea(here)).toHaveLength(1);
    const { result, rerender } = renderHook(
      ({ view }) => useDiscoveryMapBanners(view, null, filters),
      { initialProps: { view: here } }
    );
    await waitFor(() => expect(result.current.banners).toHaveLength(50));
    await waitFor(() => expect(pages).toContain(50));

    globalThis.fetch.mockClear();
    pages.length = 0;
    rerender({ view: null });
    await new Promise((resolve) => setTimeout(resolve, 600)); // past the release grace
    rerender({ view: here });
    await waitFor(() => expect(pages.length).toBeGreaterThan(0));
    expect(pages[0]).toBe(50); // not page one again
    expect(result.current.banners).toHaveLength(50);
  });
});
