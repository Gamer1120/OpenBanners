import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DiscoveryMap from "./DiscoveryMap";
import { useBannerRoute } from "./bannerRoute";
import { buildRow, sortByDistance } from "./rowModel";
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
  function BannerPage() {
    return <p>banner page {useParams().id}</p>;
  }
  // With the banner page routed, to see whether something navigated.
  const routedUi = () => (
    <MemoryRouter initialEntries={["/map"]}>
      <Routes>
        <Route path="/map" element={<DiscoveryMap />} />
        <Route path="/banner/:id" element={<BannerPage />} />
      </Routes>
    </MemoryRouter>
  );
  // The cards are buttons (select); each has a separate Details link.
  const cards = () =>
    within(screen.getByRole("region", { name: "Banners in view" }))
      .getAllByRole("button")
      .filter((button) => button.classList.contains("mv-rc") && !button.classList.contains("mv-rc-more"));
  const cardTitles = () => cards().map((card) => card.querySelector(".mv-rc-title").textContent);
  const card = (title) => cards().find((item) => item.querySelector(".mv-rc-title").textContent === title);
  const current = () =>
    cards()
      .find((item) => item.getAttribute("aria-pressed") === "true")
      ?.querySelector(".mv-rc-title").textContent;
  const routeFor = () => useBannerRoute.mock.lastCall?.[0] ?? null;
  const dotIcons = (position) => screen.getAllByTestId(`marker-${position}`).map((marker) => marker.dataset.icon);

  beforeEach(() => {
    window.localStorage.setItem(MAP_FILTERS_STORAGE_KEY, JSON.stringify({ status: "all" }));
    useBannerRoute.mockClear();
  });

  test("lists the banners in view nearest first; nothing is selected and no route is shown", () => {
    setVm(
      [mapBanner("far", 52.008, 6), mapBanner("near", 52.001, 6), mapBanner("out", 53, 6), mapBanner("mid", 52.004, 6)],
      area(52, 6)
    );
    render(ui());

    expect(cardTitles()).toEqual(["near", "mid", "far"]);
    expect(screen.getByText("3 banners here")).toBeInTheDocument();
    expect(current()).toBeUndefined();
    expect(cards().every((item) => item.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(useBannerRoute).toHaveBeenCalled();
    expect(useBannerRoute.mock.calls.every(([id]) => id === null)).toBe(true);
    expect(dotIcons("52.001,6")).toEqual(["mv-dot"]);
  });

  test("tapping a card selects it and loads its route at once; tapping it again deselects it", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
    render(ui());

    expect(card("c")).not.toHaveAttribute("href");
    fireEvent.click(card("c"));
    expect(current()).toBe("c");
    expect(routeFor()).toBe("c");
    // The selected banner's dot is drawn enlarged on top of the plain one.
    expect(dotIcons("52.008,6")).toEqual(["mv-dot", "mv-dot sel"]);

    fireEvent.click(card("c"));
    expect(current()).toBeUndefined();
    expect(routeFor()).toBeNull();
    expect(dotIcons("52.008,6")).toEqual(["mv-dot"]);

    // Another card switches the selection.
    fireEvent.click(card("a"));
    fireEvent.click(card("b"));
    expect(current()).toBe("b");
    expect(routeFor()).toBe("b");
  });

  test("moving the map selects nothing, keeps a selection while it is listed and drops it when it leaves", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
    const { rerender } = render(ui());

    // A re-sort selects nothing.
    setVm(vm.banners, area(52.009, 6));
    rerender(ui());
    expect(cardTitles()).toEqual(["c", "b", "a"]);
    expect(current()).toBeUndefined();

    fireEvent.click(card("b"));
    setVm(vm.banners, area(52, 6));
    rerender(ui());
    expect(cardTitles()).toEqual(["a", "b", "c"]);
    expect(current()).toBe("b");
    expect(routeFor()).toBe("b");

    // b left the view: deselected, its route is gone, nothing else selected.
    setVm(vm.banners, area(51.995, 6, 0.007));
    rerender(ui());
    expect(cardTitles()).toEqual(["a"]);
    expect(current()).toBeUndefined();
    expect(routeFor()).toBeNull();
  });

  test("tapping a card doesn't open the banner; its Details button does", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6)], area(52, 6));
    render(routedUi());

    fireEvent.click(card("a"));
    fireEvent.keyDown(card("a"), { key: "Enter" });
    expect(screen.queryByText(/banner page/)).not.toBeInTheDocument();
    expect(current()).toBe("a");

    // Every card has one, the selected one or not.
    expect(screen.getByRole("link", { name: "Details for a" })).toHaveAttribute("href", "/banner/a");
    const details = screen.getByRole("link", { name: "Details for b" });
    expect(details).toHaveAttribute("href", "/banner/b");
    expect(details.closest(".mv-rc")).toBeNull();
    fireEvent.click(details);
    expect(screen.getByText("banner page b")).toBeInTheDocument();
  });

  test("the Details button doesn't toggle the selection", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6)], area(52, 6));
    render(ui());
    // Keep the page (React Router skips a click whose default was prevented).
    const stay = (event) => event.preventDefault();
    window.addEventListener("click", stay, true);

    try {
      fireEvent.click(screen.getByRole("link", { name: "Details for b" }));
      expect(current()).toBeUndefined();
      fireEvent.click(card("a"));
      fireEvent.click(screen.getByRole("link", { name: "Details for a" }));
      expect(current()).toBe("a");
      expect(routeFor()).toBe("a");
    } finally {
      window.removeEventListener("click", stay, true);
    }
  });

  test("tapping a dot selects its card; tapping it again deselects it", () => {
    setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6)], area(52, 6));
    render(ui());

    fireEvent.click(screen.getByTestId("marker-52.004,6"));
    expect(current()).toBe("b");
    expect(routeFor()).toBe("b");

    fireEvent.click(screen.getAllByTestId("marker-52.004,6")[0]);
    expect(current()).toBeUndefined();
    expect(routeFor()).toBeNull();
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
    expect(current()).toBeUndefined();
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
    // Layout for jsdom: the row is 250 px wide with 12 px padding, each card 100 px at its index.
    const restore = [];
    const stub = (proto, name, get) => {
      restore.push([proto, name, Object.getOwnPropertyDescriptor(proto, name)]);
      Object.defineProperty(proto, name, { configurable: true, get });
    };
    const isCard = (element) => element.classList.contains("mv-rc-item");
    const isRow = (element) => element.classList.contains("mv-row-scroll");
    let scrollTo;

    beforeEach(() => {
      vi.useFakeTimers();
      stub(HTMLElement.prototype, "offsetLeft", function () {
        return isCard(this) ? 12 + [...this.parentNode.children].indexOf(this) * 100 : 0;
      });
      stub(HTMLElement.prototype, "offsetWidth", function () {
        return isCard(this) ? 100 : 0;
      });
      stub(Element.prototype, "clientWidth", function () {
        return isRow(this) ? 250 : 0;
      });
      stub(Element.prototype, "scrollWidth", function () {
        return isRow(this) ? 24 + this.children.length * 100 : 0;
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
    // A swipe: finger down, the row scrolls to left, finger up.
    const swipeTo = (left) => {
      fireEvent.touchStart(scroller(), finger(300));
      scrollRowTo(left);
      fireEvent.touchEnd(scroller(), lift(200));
    };
    const fourBanners = () => [
      mapBanner("a", 52.001, 6),
      mapBanner("b", 52.004, 6),
      mapBanner("c", 52.006, 6),
      mapBanner("d", 52.008, 6),
    ];

    test("scrolling never selects anything and the row stays where it stops", () => {
      setVm(fourBanners(), area(52, 6));
      render(ui());

      fireEvent.touchStart(scroller(), finger(300));
      scrollRowTo(60);
      act(() => vi.advanceTimersByTime(1000));
      fireEvent.touchEnd(scroller(), lift(200));
      act(() => vi.advanceTimersByTime(1000));
      expect(current()).toBeUndefined();
      expect(scroller().scrollLeft).toBe(60);

      // Momentum ending mid-card, at the end, back at the start: still nothing.
      swipeTo(100);
      act(() => vi.advanceTimersByTime(1000));
      swipeTo(174);
      act(() => vi.advanceTimersByTime(1000));
      expect(current()).toBeUndefined();
      expect(scroller().scrollLeft).toBe(174);
      swipeTo(0);
      act(() => vi.advanceTimersByTime(1000));
      expect(current()).toBeUndefined();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(useBannerRoute.mock.calls.every(([id]) => id === null)).toBe(true);
    });

    test("a dot or a half-hidden card scrolls just into view; a visible card or a tap without scrolling doesn't scroll", () => {
      setVm(fourBanners(), area(52, 6));
      render(ui());

      // c (212–312) is cut off on the right: brought in at the right edge.
      fireEvent.click(screen.getByTestId("marker-52.006,6"));
      expect(current()).toBe("c");
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 74, behavior: "smooth" });
      scrollTo.mockClear();

      // b is fully visible: selected without scrolling.
      fireEvent.touchStart(scroller(), finger(150));
      fireEvent.touchEnd(scroller(), lift(150));
      fireEvent.click(card("b"));
      act(() => vi.advanceTimersByTime(1000));
      expect(current()).toBe("b");
      expect(scrollTo).not.toHaveBeenCalled();

      // Deselecting doesn't scroll either.
      fireEvent.click(card("b"));
      expect(current()).toBeUndefined();
      expect(scrollTo).not.toHaveBeenCalled();

      // a (12–112) is cut off on the left.
      fireEvent.click(card("a"));
      expect(current()).toBe("a");
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
    });

    test("keeps the card order while the row is touched, then re-sorts and keeps the selected card in view", () => {
      setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
      const { rerender } = render(ui());

      fireEvent.click(card("c"));
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 74, behavior: "smooth" });
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

    test("a re-sort without a selection puts the row back at its start", () => {
      setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6), mapBanner("c", 52.008, 6)], area(52, 6));
      const { rerender } = render(ui());

      swipeTo(74);
      act(() => vi.advanceTimersByTime(1000));
      setVm(vm.banners, area(52.009, 6));
      rerender(ui());
      expect(cardTitles()).toEqual(["c", "b", "a"]);
      expect(current()).toBeUndefined();
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "instant" });
    });
  });

  describe("desktop side list", () => {
    beforeEach(() => {
      window.matchMedia = (query) => ({
        matches: query === "(min-width: 840px)",
        addEventListener: () => {},
        removeEventListener: () => {},
      });
    });

    afterEach(() => {
      delete window.matchMedia;
    });

    test("click toggles the selection; arrow keys only move focus", () => {
      setVm([mapBanner("a", 52.001, 6), mapBanner("b", 52.004, 6)], area(52, 6));
      render(ui());

      expect(document.querySelector(".mv-side")).not.toBeNull();
      expect(current()).toBeUndefined();
      expect(routeFor()).toBeNull();

      act(() => card("a").focus());
      act(() => {
        fireEvent.keyDown(card("a"), { key: "ArrowDown" });
      });
      expect(document.activeElement).toBe(card("b"));
      expect(current()).toBeUndefined();

      fireEvent.click(card("b"));
      expect(current()).toBe("b");
      expect(routeFor()).toBe("b");
      fireEvent.click(card("b"));
      expect(current()).toBeUndefined();
      expect(routeFor()).toBeNull();
    });
  });

  test("hidden when nothing matches in view", () => {
    setVm([mapBanner("out", 53, 6)], area(52, 6));
    render(ui());

    expect(screen.queryByRole("region", { name: "Banners in view" })).not.toBeInTheDocument();
    expect(screen.getByText("No matching banners here – zoom out or move the map")).toBeInTheDocument();
  });
});
