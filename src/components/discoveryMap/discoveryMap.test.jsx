import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DiscoveryMap from "./DiscoveryMap";
import { useBannerRoute } from "./bannerRoute";
import { buildRow, keepFocus, sortByDistance } from "./rowModel";
import {
  MAP_FILTERS_STORAGE_KEY,
  applyMapFilters,
  countActiveMapFilters,
  filterSummary,
  normalizeMapFilters,
} from "./mapFilters";
import { getBannerStatus, withStatus } from "./mapStatus";
import { formatMinutes, isInsideArea, walkingMinutes } from "./mapMath";

vi.mock("leaflet", () => {
  const point = (x, y) => ({ x, y, add: (other) => point(x + other.x, y + other.y) });
  const leaflet = {
    divIcon: (options) => options,
    latLngBounds: (coordinates) => ({
      coordinates,
      getCenter: () => ({ lat: coordinates[0][0], lng: coordinates[0][1] }),
    }),
    point,
    Browser: { mobile: true },
  };
  return { __esModule: true, default: leaflet };
});

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Tooltip: () => null,
  Marker: ({ position, title, icon, eventHandlers }) => (
    <button
      type="button"
      data-testid={`marker-${position.join(",")}`}
      data-icon={icon?.className}
      aria-label={title}
      onClick={() => eventHandlers?.click?.()}
    />
  ),
  useMapEvents: () => null,
}));

// The map view model (viewport, banners) is driven by the tests.
let vm;
vi.mock("./useDiscoveryMap", () => ({ default: () => vm }));
vi.mock("./bannerRoute", () => ({
  useBannerRoute: vi.fn(() => ({ status: "idle", data: null })),
}));

function banner(id, latitude, longitude, extra = {}) {
  return { id, title: id, _latitude: latitude, _longitude: longitude, ...extra };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("map math", () => {
  test("formats walking time", () => {
    expect(walkingMinutes(4500)).toBeCloseTo(60);
    expect(walkingMinutes("x")).toBeNull();
    expect(formatMinutes(42)).toBe("40 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(137)).toBe("2 h 15");
    expect(formatMinutes(NaN)).toBe("?");
  });

  test("counts a banner in view by its start point", () => {
    const area = { minLatitude: 52, maxLatitude: 53, minLongitude: 6, maxLongitude: 7 };
    expect(isInsideArea(banner("in", 52.2, 6.9), area)).toBe(true);
    expect(isInsideArea(banner("out", 51.9, 6.9), area)).toBe(false);
    expect(isInsideArea({ startLatitude: "52.5", startLongitude: "6.5" }, area)).toBe(true);
    expect(isInsideArea({ id: "nowhere" }, area)).toBe(false);
  });
});

describe("filters", () => {
  const banners = [
    banner("todo-short", 0, 0, { _status: "todo", lengthMeters: 1500, numberOfMissions: 6 }),
    banner("done-long", 0, 0, { _status: "done", lengthMeters: 12000, numberOfMissions: 36 }),
    banner("none-hour", 0, 0, { _status: "none", lengthMeters: 3500, numberOfMissions: 12 }),
    banner("none-unknown", 0, 0, { _status: "none" }),
  ];
  const ids = (filters) => applyMapFilters(banners, filters).map((item) => item.id);

  test("status: all, To do only, hide Done", () => {
    expect(ids({ status: "all" })).toEqual(["todo-short", "done-long", "none-hour", "none-unknown"]);
    expect(ids({ status: "todo" })).toEqual(["todo-short"]);
    expect(ids({ status: "hideDone" })).toEqual(["todo-short", "none-hour", "none-unknown"]);
  });

  test("mission count is a minimum (6+ … 30+); unknown counts drop out", () => {
    expect(ids({ status: "all", missions: "6+" })).toEqual(["todo-short", "done-long", "none-hour"]);
    expect(ids({ status: "all", missions: "12+" })).toEqual(["done-long", "none-hour"]);
    expect(ids({ status: "all", missions: "18+" })).toEqual(["done-long"]);
    expect(ids({ status: "all", missions: "30+" })).toEqual(["done-long"]);
  });

  test("distance: under N km, and a custom min–max range", () => {
    expect(ids({ status: "all", distance: "lt5" })).toEqual(["todo-short", "none-hour"]);
    expect(ids({ status: "all", distance: "lt20" })).toEqual(["todo-short", "done-long", "none-hour"]);
    expect(ids({ status: "all", distance: "custom", distMin: 2, distMax: 5 })).toEqual(["none-hour"]);
    expect(ids({ status: "all", distance: "custom", distMin: 7 })).toEqual(["done-long"]);
    expect(ids({ status: "all", distance: "custom" })).toHaveLength(4);
  });

  test("normalizes and counts filters", () => {
    expect(normalizeMapFilters({ missions: "nope" })).toEqual({
      missions: "any",
      status: "hideDone",
      distance: "any",
      distMin: null,
      distMax: null,
    });
    expect(countActiveMapFilters({ missions: "12+", status: "all" })).toBe(1);
    expect(countActiveMapFilters({ status: "all" })).toBe(0);
    expect(filterSummary({})).toEqual({ missions: "Any missions", status: "Hide Done", distance: "Any distance" });
    expect(filterSummary({ distance: "lt10" }).distance).toBe("< 10 km");
    expect(filterSummary({ distance: "custom", distMin: 3, distMax: 8 }).distance).toBe("3–8 km");
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

test("clusterByPixels groups dots within the radius and keeps far ones apart", async () => {
  const { clusterByPixels } = await import("./mapMath");
  const clusters = clusterByPixels(
    [
      { x: 0, y: 0, id: "a" },
      { x: 20, y: 10, id: "b" },
      { x: 200, y: 0, id: "c" },
    ],
    34
  );

  expect(clusters.map((cluster) => cluster.items.map((item) => item.id))).toEqual([["a", "b"], ["c"]]);
});

describe("banners in view row (helpers)", () => {
  const center = { latitude: 52, longitude: 6 };

  test("sorts by distance from the map centre, ties in incoming order", () => {
    const list = [banner("far", 52.02, 6), banner("near", 52.001, 6), banner("mid", 52, 6.01), banner("tie", 52.001, 6)];
    expect(sortByDistance(list, center).map((item) => item.id)).toEqual(["near", "tie", "mid", "far"]);
    expect(sortByDistance(list, null).map((item) => item.id)).toEqual(["far", "near", "mid", "tie"]);
  });

  test("caps a long row at 30 cards plus a more card, keeping the focused one", () => {
    const list = Array.from({ length: 45 }, (_, index) => banner(`b${index}`, 52, 6));
    expect(buildRow(list.slice(0, 40), null)).toEqual({ items: list.slice(0, 40), moreCount: 0 });

    const capped = buildRow(list, "b2");
    expect(capped.items).toHaveLength(30);
    expect(capped.moreCount).toBe(15);

    const withFar = buildRow(list, "b44");
    expect(withFar.items.map((item) => item.id).slice(-1)).toEqual(["b44"]);
    expect(withFar.moreCount).toBe(14);
  });

  test("keeps the focus while listed, else the nearest", () => {
    const list = [banner("a", 0, 0), banner("b", 0, 0)];
    expect(keepFocus("b", list)).toBe("b");
    expect(keepFocus("gone", list)).toBe("a");
    expect(keepFocus(null, list)).toBe("a");
    expect(keepFocus("a", [])).toBeNull();
  });
});

describe("banners in view row (phone)", () => {
  const area = (lat, lng, half = 0.01) => ({
    minLatitude: lat - half,
    maxLatitude: lat + half,
    minLongitude: lng - half,
    maxLongitude: lng + half,
  });
  const mapBanner = (id, latitude, longitude) =>
    banner(id, latitude, longitude, { _status: "none", numberOfMissions: 6, lengthMeters: 2000 });

  function setVm(banners, liveArea, map = null) {
    vm = {
      map,
      banners,
      liveArea,
      searchArea: liveArea,
      zoom: 15,
      loading: false,
      error: null,
      initialCenter: [52, 6],
      initialZoom: 15,
      requestLocation: () => {},
      handleViewportChange: () => {},
    };
  }

  const ui = () => (
    <MemoryRouter initialEntries={["/map"]}>
      <DiscoveryMap />
    </MemoryRouter>
  );
  const cardTitles = () =>
    within(screen.getByRole("region", { name: "Banners in view" }))
      .getAllByRole("link")
      .map((link) => link.querySelector(".mv-rc-title").textContent);
  const current = () =>
    within(screen.getByRole("region", { name: "Banners in view" }))
      .getAllByRole("link")
      .find((link) => link.getAttribute("aria-current") === "true")
      ?.querySelector(".mv-rc-title").textContent;

  beforeEach(() => {
    window.localStorage.setItem(MAP_FILTERS_STORAGE_KEY, JSON.stringify({ status: "all" }));
    useBannerRoute.mockClear();
  });

  test("lists the banners in view nearest first, focuses the nearest and loads its route after a dwell", async () => {
    setVm(
      [mapBanner("far", 52.008, 6), mapBanner("near", 52.001, 6), mapBanner("out", 53, 6), mapBanner("mid", 52.004, 6)],
      area(52, 6)
    );
    render(ui());

    expect(cardTitles()).toEqual(["near", "mid", "far"]);
    expect(screen.getByText("3 banners here")).toBeInTheDocument();
    expect(screen.queryByText(/tap one for its route/)).not.toBeInTheDocument();
    expect(current()).toBe("near");
    expect(useBannerRoute).not.toHaveBeenCalledWith("near");
    await waitFor(() => expect(useBannerRoute).toHaveBeenCalledWith("near"), { timeout: 1500 });
    // The focused banner's dot is drawn enlarged on top of the plain one.
    expect(screen.getAllByTestId("marker-52.001,6").map((marker) => marker.dataset.icon)).toEqual([
      "mv-dot",
      "mv-dot sel",
    ]);
  });

  test("until the user picks one, the nearest card stays selected as the map moves", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
    const { rerender } = render(ui());
    expect(current()).toBe("a");

    setVm(vm.banners, area(52.009, 6));
    rerender(ui());
    expect(cardTitles()).toEqual(["c", "b", "a"]);
    expect(current()).toBe("c");
  });

  test("tapping a card focuses it, tapping the focused card opens it; focus survives a re-sort", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
    const { rerender } = render(ui());
    const link = (title) => screen.getAllByRole("link").find((item) => item.textContent.includes(title));

    expect(link("c")).toHaveAttribute("href", "/banner/c");
    fireEvent.click(link("c"));
    expect(current()).toBe("c");

    // The map moved north: the order flips but c stays focused.
    setVm(vm.banners, area(52.009, 6));
    rerender(ui());
    expect(cardTitles()).toEqual(["c", "b", "a"]);
    expect(current()).toBe("c");

    // c left the view: the nearest one takes over.
    setVm(vm.banners, area(51.995, 6, 0.007));
    rerender(ui());
    expect(cardTitles()).toEqual(["a"]);
    expect(current()).toBe("a");
  });

  test("tapping a dot focuses its card", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6)], area(52, 6));
    render(ui());

    fireEvent.click(screen.getByTestId("marker-52.004,6"));
    expect(current()).toBe("b");
  });

  test("more than 40 in view: 30 cards and a more card that opens the full list", () => {
    setVm(
      Array.from({ length: 45 }, (_, index) => mapBanner(`b${String(index).padStart(2, "0")}`, 52 + index * 0.0001, 6)),
      area(52, 6)
    );
    render(ui());

    expect(cardTitles()).toHaveLength(30);
    fireEvent.click(screen.getByRole("button", { name: "+15 more · show list" }));
    const sheet = screen.getByRole("dialog", { name: "45 banners here" });
    expect(within(sheet).getAllByRole("button", { name: /b\d\d/ })).toHaveLength(45);
    expect(screen.queryByRole("region", { name: "Banners in view" })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: /b40/ }));
    expect(cardTitles()).toHaveLength(31);
    expect(current()).toBe("b40");
  });

  test("a group that zooming can't split becomes the row", () => {
    const map = {
      project: ([lat, lng]) => ({ x: lng * 1e5, y: -lat * 1e5 }),
      getZoom: () => 18,
      getMaxZoom: () => 18,
      getBoundsZoom: () => 18,
      flyToBounds: vi.fn(),
      flyTo: vi.fn(),
    };
    setVm([mapBanner("x", 52.003, 6), mapBanner("y", 52.003, 6), mapBanner("z", 52.0001, 6)], area(52, 6), map);
    render(ui());

    expect(cardTitles()).toEqual(["z", "x", "y"]);
    fireEvent.click(screen.getByRole("button", { name: "2 banners" }));
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(cardTitles()).toEqual(["x", "y"]);
    expect(current()).toBe("x");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all in view" }));
    expect(cardTitles()).toEqual(["z", "x", "y"]);
  });

  test("folds to a handle and remembers it", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6)], area(52, 6));
    const { unmount } = render(ui());

    fireEvent.click(screen.getByRole("button", { name: "Fold the list" }));
    expect(screen.queryByRole("region", { name: "Banners in view" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the list" })).toHaveTextContent("2 banners");
    unmount();

    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Show the list" }));
    expect(cardTitles()).toEqual(["a", "b"]);
  });

  describe("swiping", () => {
    // Layout for jsdom: the row is 100 px wide, each card 100 px at its index.
    const restore = [];
    const stub = (proto, name, get) => {
      restore.push([proto, name, Object.getOwnPropertyDescriptor(proto, name)]);
      Object.defineProperty(proto, name, { configurable: true, get });
    };
    const isCard = (element) => element.classList.contains("mv-rc-item");
    let scrollTo;

    beforeEach(() => {
      vi.useFakeTimers();
      stub(HTMLElement.prototype, "offsetLeft", function () {
        return isCard(this) ? [...this.parentNode.children].indexOf(this) * 100 : 0;
      });
      stub(HTMLElement.prototype, "offsetWidth", function () {
        return isCard(this) ? 100 : 0;
      });
      stub(Element.prototype, "clientWidth", function () {
        return this.classList.contains("mv-row-scroll") ? 100 : 0;
      });
      scrollTo = vi.fn(function ({ left }) {
        this.scrollLeft = left;
      });
      Element.prototype.scrollTo = scrollTo;
    });

    afterEach(() => {
      vi.useRealTimers();
      delete Element.prototype.scrollTo;
      for (const [proto, name, descriptor] of restore.splice(0).reverse()) {
        if (descriptor) {
          Object.defineProperty(proto, name, descriptor);
        } else {
          delete proto[name];
        }
      }
    });

    const scroller = () => document.querySelector(".mv-row-scroll");
    const finger = (x) => ({ touches: [{ clientX: x, clientY: 800 }], changedTouches: [{ clientX: x, clientY: 800 }] });
    const lift = (x) => ({ touches: [], changedTouches: [{ clientX: x, clientY: 800 }] });
    const scrollRowTo = (left) => {
      scroller().scrollLeft = left;
      fireEvent.scroll(scroller());
    };

    test("a pause mid-drag selects nothing; resting on a card selects it without scrolling the row", () => {
      setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
      render(ui());
      expect(current()).toBe("a");

      fireEvent.touchStart(scroller(), finger(300));
      scrollRowTo(100);
      // The finger rests on b for a while: the row must not take over.
      act(() => vi.advanceTimersByTime(1000));
      expect(current()).toBe("a");

      fireEvent.touchEnd(scroller(), lift(200));
      act(() => vi.advanceTimersByTime(200));
      expect(current()).toBe("b");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scroller().scrollLeft).toBe(100);

      // scrollend settles at once.
      fireEvent.touchStart(scroller(), finger(300));
      scrollRowTo(200);
      fireEvent.touchEnd(scroller(), lift(200));
      fireEvent(scroller(), new Event("scrollend"));
      expect(current()).toBe("c");
      expect(scrollTo).not.toHaveBeenCalled();

      // A dot still brings its card to the middle, smoothly.
      fireEvent.click(screen.getByTestId("marker-52.001,6"));
      expect(current()).toBe("a");
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
    });

    test("keeps the card order while the row is touched, then re-sorts around the selected card", () => {
      setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
      const { rerender } = render(ui());
      const link = (title) => screen.getAllByRole("link").find((item) => item.textContent.includes(title));

      fireEvent.click(link("c"));
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 200, behavior: "smooth" });
      scrollTo.mockClear();

      fireEvent.touchStart(scroller(), finger(200));
      // More banners loaded / the map moved: the order flips under the finger.
      setVm(vm.banners, area(52.009, 6));
      rerender(ui());
      expect(cardTitles()).toEqual(["a", "b", "c"]);
      expect(current()).toBe("c");
      act(() => vi.advanceTimersByTime(1000));
      expect(cardTitles()).toEqual(["a", "b", "c"]);
      expect(scrollTo).not.toHaveBeenCalled();

      fireEvent.touchEnd(scroller(), lift(200));
      act(() => vi.advanceTimersByTime(1000));
      expect(cardTitles()).toEqual(["c", "b", "a"]);
      expect(current()).toBe("c");
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "instant" });
    });
  });

  test("hidden when nothing matches in view", () => {
    setVm([mapBanner("out", 53, 6)], area(52, 6));
    render(ui());

    expect(screen.queryByRole("region", { name: "Banners in view" })).not.toBeInTheDocument();
    expect(screen.getByText("No matching banners here – zoom out or move the map")).toBeInTheDocument();
  });
});
