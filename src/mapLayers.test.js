import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAP_LAYERS,
  MAP_LAYER_STORAGE_KEY,
  getMapLayer,
  getMapLayerPreview,
  readMapLayerChoice,
  setMapLayerChoice,
  useMapLayer,
} from "./mapLayers";

describe("map layers", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("offers the current darkened OpenStreetMap first, plus standard, streets and satellite", () => {
    expect(MAP_LAYERS.map((layer) => layer.id)).toEqual(["dark", "osm", "streets", "satellite"]);
    expect(getMapLayer("dark").url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(getMapLayer("dark").className).toBe("ob-tiles-dark");
    expect(getMapLayer("osm").className).toBeUndefined();
    expect(getMapLayer("satellite").className).toBeUndefined();
    expect(getMapLayer("nonsense").id).toBe("dark");
  });

  it("credits every provider", () => {
    for (const layer of MAP_LAYERS) {
      expect(layer.attribution()).toMatch(["streets", "satellite"].includes(layer.id) ? /Powered by .*Esri/ : /OpenStreetMap/);
    }
  });

  // The CSP (docker/openbanners-security-headers.conf img-src) must list them.
  it("only loads tiles from the hosts in the CSP", () => {
    const hosts = MAP_LAYERS.map((layer) => new URL(getMapLayerPreview(layer)).host);
    expect([...new Set(hosts)].sort()).toEqual([
      "server.arcgisonline.com",
      "tile.openstreetmap.org",
    ]);
    expect(getMapLayerPreview(getMapLayer("satellite"))).toBe(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/10771/16829"
    );
  });

  it("uses each map's own default until the visitor picks one, then that one everywhere", () => {
    const guider = renderHook(() => useMapLayer("osm"));
    const banner = renderHook(() => useMapLayer());
    expect(guider.result.current.id).toBe("osm");
    expect(banner.result.current.id).toBe("dark");
    expect(readMapLayerChoice()).toBeNull();

    act(() => setMapLayerChoice("satellite"));

    expect(window.localStorage.getItem(MAP_LAYER_STORAGE_KEY)).toBe("satellite");
    expect(guider.result.current.id).toBe("satellite");
    expect(banner.result.current.id).toBe("satellite");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(MAP_LAYER_STORAGE_KEY, "terrain");
    expect(readMapLayerChoice()).toBeNull();
    const { result } = renderHook(() => useMapLayer("osm"));
    expect(result.current.id).toBe("osm");
    setMapLayerChoice("terrain");
    expect(window.localStorage.getItem(MAP_LAYER_STORAGE_KEY)).toBe("terrain");
  });
});
