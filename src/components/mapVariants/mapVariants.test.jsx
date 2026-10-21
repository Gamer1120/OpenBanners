import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  MAP_VARIANT_STORAGE_KEY,
  normalizeMapVariant,
  readMapVariant,
  saveMapVariant,
  withMapVariantParam,
} from "./mapVariantChoice";
import MapVariantSwitcher from "./MapVariantSwitcher";
import { orderNearestNeighbour, summarizePlan } from "./planDay";
import { applyVariantFilters, countActiveVariantFilters, normalizeVariantFilters } from "./mapFilters";
import { getBannerStatus, withStatus } from "./mapStatus";
import { clusterByPixels, formatMinutes, walkingMinutes } from "./mapMath";

vi.mock("../Map", () => ({ default: () => <div data-testid="variant">now</div> }));
vi.mock("./PicturesMap", () => ({ default: () => <div data-testid="variant">a</div> }));
vi.mock("./ListStripMap", () => ({ default: () => <div data-testid="variant">b</div> }));
vi.mock("./RoutePreviewMap", () => ({ default: () => <div data-testid="variant">c</div> }));
vi.mock("./FiltersMap", () => ({ default: () => <div data-testid="variant">d</div> }));
vi.mock("./PlanDayMap", () => ({ default: () => <div data-testid="variant">e</div> }));

const { default: MapVariantsHost } = await import("./MapVariantsHost");

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    values,
  };
}

function banner(id, latitude, longitude, extra = {}) {
  return { id, title: id, _latitude: latitude, _longitude: longitude, ...extra };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("map variant choice", () => {
  test("?map= wins over the stored choice", () => {
    const storage = memoryStorage({ [MAP_VARIANT_STORAGE_KEY]: "b" });
    expect(readMapVariant("?map=D", storage)).toBe("d");
    expect(readMapVariant("?map=now", storage)).toBe("now");
  });

  test("falls back to the stored choice, then the default", () => {
    expect(readMapVariant("", memoryStorage({ [MAP_VARIANT_STORAGE_KEY]: "c" }), "a")).toBe("c");
    expect(readMapVariant("?map=zzz", memoryStorage(), "a")).toBe("a");
    expect(readMapVariant("", memoryStorage({ [MAP_VARIANT_STORAGE_KEY]: "x" }), "a")).toBe("a");
  });

  test("survives a storage that throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(readMapVariant("", storage, "a")).toBe("a");
  });

  test("saves only known variants and rewrites the map parameter", () => {
    const storage = memoryStorage();
    expect(saveMapVariant("E", storage)).toBe("e");
    expect(storage.values[MAP_VARIANT_STORAGE_KEY]).toBe("e");
    expect(saveMapVariant("q", storage)).toBeNull();
    expect(storage.values[MAP_VARIANT_STORAGE_KEY]).toBe("e");
    expect(normalizeMapVariant(" a ")).toBe("a");
    expect(withMapVariantParam("?x=1&map=a", "c")).toBe("?x=1&map=c");
  });
});

describe("switcher", () => {
  test("shows Now and A–E and reports the picked one", () => {
    const onChange = vi.fn();
    render(<MapVariantSwitcher value="a" onChange={onChange} />);

    const options = screen.getAllByRole("radio");
    expect(options.map((option) => option.textContent)).toEqual(["Now", "A", "B", "C", "D", "E"]);
    expect(screen.getByRole("radio", { name: /A: Pictures/ })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: /C: Route preview/ }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  function SearchDisplay() {
    return <div data-testid="search">{useLocation().search}</div>;
  }

  function renderHost(route) {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route
            path="/map"
            element={
              <>
                <MapVariantsHost />
                <SearchDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
  }

  test("host renders the ?map= variant and switching updates storage and URL", () => {
    renderHost("/map?map=b");
    expect(screen.getByTestId("variant")).toHaveTextContent("b");

    fireEvent.click(screen.getByRole("radio", { name: /E: Plan a day/ }));
    expect(screen.getByTestId("variant")).toHaveTextContent("e");
    expect(window.localStorage.getItem(MAP_VARIANT_STORAGE_KEY)).toBe("e");
    expect(screen.getByTestId("search")).toHaveTextContent("?map=e");

    fireEvent.click(screen.getByRole("radio", { name: /Now/ }));
    expect(screen.getByTestId("variant")).toHaveTextContent("now");
  });

  test("host uses the stored choice without a parameter", () => {
    window.localStorage.setItem(MAP_VARIANT_STORAGE_KEY, "d");
    renderHost("/map");
    expect(screen.getByTestId("variant")).toHaveTextContent("d");
    fireEvent.click(screen.getByRole("radio", { name: /A: Pictures/ }));
    expect(screen.getByTestId("search")).toHaveTextContent("");
    expect(window.localStorage.getItem(MAP_VARIANT_STORAGE_KEY)).toBe("a");
  });
});

describe("plan a day", () => {
  // Roughly on a line going east: 0.01° longitude ≈ 680 m at this latitude.
  const west = banner("west", 52.22, 6.86, { lengthMeters: 1000, numberOfMissions: 6 });
  const middle = banner("middle", 52.22, 6.88, { lengthMeters: 2000, numberOfMissions: 12 });
  const east = banner("east", 52.22, 6.9, { lengthMeters: 3000, numberOfMissions: 18 });

  test("visits the nearest next banner from the start point", () => {
    const fromEast = orderNearestNeighbour([west, east, middle], { latitude: 52.22, longitude: 6.91 });
    expect(fromEast.map((item) => item.id)).toEqual(["east", "middle", "west"]);
  });

  test("starts at the first banner without a start point and puts unlocated banners last", () => {
    const lost = { id: "lost", title: "lost" };
    const nearEast = banner("east", 52.22, 6.895);
    const ordered = orderNearestNeighbour([middle, lost, west, nearEast]);
    expect(ordered.map((item) => item.id)).toEqual(["middle", "east", "west", "lost"]);
    expect(orderNearestNeighbour([])).toEqual([]);
  });

  test("adds up legs, banner lengths, missions and time", () => {
    const ordered = orderNearestNeighbour([west, middle, east]);
    const summary = summarizePlan(ordered);

    expect(summary.legs[0]).toBe(0);
    expect(summary.legs[1]).toBeGreaterThan(1300);
    expect(summary.legs[1]).toBeLessThan(1400);
    expect(summary.bannerMeters).toBe(6000);
    expect(summary.missions).toBe(36);
    expect(summary.totalMeters).toBeCloseTo(summary.walkingMeters + 6000);
    expect(summary.minutes).toBeCloseTo(walkingMinutes(summary.totalMeters));

    const fromStart = summarizePlan(ordered, { latitude: 52.22, longitude: 6.85 });
    expect(fromStart.legs[0]).toBeGreaterThan(600);
  });

  test("formats walking time", () => {
    expect(walkingMinutes(4500)).toBeCloseTo(60);
    expect(formatMinutes(42)).toBe("40 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(137)).toBe("2 h 15");
    expect(formatMinutes(NaN)).toBe("?");
  });
});

describe("filters", () => {
  const banners = [
    banner("todo-short", 0, 0, { _status: "todo", lengthMeters: 1500, numberOfMissions: 6 }),
    banner("done-long", 0, 0, { _status: "done", lengthMeters: 12000, numberOfMissions: 36 }),
    banner("none-hour", 0, 0, { _status: "none", lengthMeters: 3500, numberOfMissions: 12 }),
    banner("none-unknown", 0, 0, { _status: "none" }),
  ];
  const ids = (filters) => applyVariantFilters(banners, filters).map((item) => item.id);

  test("status: all, To do only, hide Done", () => {
    expect(ids({ status: "all" })).toEqual(["todo-short", "done-long", "none-hour", "none-unknown"]);
    expect(ids({ status: "todo" })).toEqual(["todo-short"]);
    expect(ids({ status: "hideDone" })).toEqual(["todo-short", "none-hour", "none-unknown"]);
  });

  test("walking time and mission count; unknown values drop out", () => {
    expect(ids({ status: "all", walk: "short" })).toEqual(["todo-short"]);
    expect(ids({ status: "all", walk: "hour" })).toEqual(["none-hour"]);
    expect(ids({ status: "all", walk: "long" })).toEqual(["done-long"]);
    expect(ids({ status: "all", missions: "6" })).toEqual(["todo-short"]);
    expect(ids({ status: "all", missions: "12" })).toEqual(["none-hour"]);
    expect(ids({ status: "all", missions: "25" })).toEqual(["done-long"]);
  });

  test("normalizes and counts filters", () => {
    expect(normalizeVariantFilters({ walk: "nope" })).toEqual({ walk: "any", missions: "any", status: "hideDone" });
    expect(countActiveVariantFilters({ walk: "short", status: "all" })).toBe(1);
    expect(countActiveVariantFilters({ status: "all" })).toBe(0);
  });
});

describe("status", () => {
  const syncState = { bannerLists: { a: "todo", b: "done", c: "blacklist", d: null } };

  test("uses the synced list first and the API listType as fallback", () => {
    expect(getBannerStatus({ id: "a" }, syncState)).toBe("todo");
    expect(getBannerStatus({ id: "b", listType: "todo" }, syncState)).toBe("done");
    expect(getBannerStatus({ id: "c" }, syncState)).toBe("hidden");
    expect(getBannerStatus({ id: "d", listType: "done" }, syncState)).toBe("none");
    expect(getBannerStatus({ id: "x", listType: "done" }, syncState)).toBe("done");
    expect(getBannerStatus({ id: "y" }, syncState)).toBe("none");
  });

  test("withStatus tags banners and leaves Hidden ones out", () => {
    const tagged = withStatus([{ id: "a" }, { id: "c" }, { id: "y" }], syncState);
    expect(tagged).toEqual([
      { id: "a", _status: "todo" },
      { id: "y", _status: "none" },
    ]);
  });
});

test("clusters nearby pixels, first item represents the cluster", () => {
  const clusters = clusterByPixels(
    [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 30, y: 10 },
      { id: 3, x: 200, y: 0 },
      { id: 4, x: 10, y: 50 },
    ],
    60
  );
  expect(clusters.map((cluster) => cluster.items.map((item) => item.id))).toEqual([[1, 2, 4], [3]]);
});
