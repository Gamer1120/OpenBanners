import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import L from "leaflet";
import Map, { __resetDiscoveryMapCacheForTests } from "./Map";
import { DEFAULT_MAP_BANNER_FILTERS } from "../bannerFilters";
import { saveBannergressSyncData } from "../bannergressSync";
import {
  saveDiscoveryMapFilters,
  saveDiscoveryMapSelectedBanner,
  saveDiscoveryMapViewport,
} from "../discoveryMapState";

vi.mock("leaflet", () => {
  return {
    __esModule: true,
    default: {
      Browser: {
        mobile: false,
      },
      divIcon: vi.fn((options) => options),
    },
  };
});

vi.mock("react-leaflet", async () => {
  const React = await vi.importActual("react");

  let mapInstance = null;
  const defaultMapCenter = [52.221058, 6.893297];
  const legacyMockCenter = [52.2, 6.85];

  const isDefaultMapCenter = (center) =>
    Array.isArray(center) &&
    Math.abs(center[0] - defaultMapCenter[0]) < 0.0000001 &&
    Math.abs(center[1] - defaultMapCenter[1]) < 0.0000001;

  const createMapInstance = ({ center = [52.2, 6.85], zoom = 15 } = {}) => {
    const resolvedCenter = isDefaultMapCenter(center) ? legacyMockCenter : center;
    let currentCenter = Array.isArray(resolvedCenter)
      ? { lat: resolvedCenter[0], lng: resolvedCenter[1] }
      : { lat: resolvedCenter.lat, lng: resolvedCenter.lng };
    let currentZoom = zoom;

    return {
      getBounds: () => ({
        _southWest: {
          lat: currentCenter.lat - 0.1,
          lng: currentCenter.lng - 0.05,
        },
        _northEast: {
          lat: currentCenter.lat + 0.1,
          lng: currentCenter.lng + 0.05,
        },
      }),
      getCenter: () => currentCenter,
      getZoom: () => currentZoom,
      getContainer: () => document.createElement("div"),
      setView: vi.fn((nextCenter, nextZoom = currentZoom) => {
        currentCenter = Array.isArray(nextCenter)
          ? { lat: nextCenter[0], lng: nextCenter[1] }
          : { lat: nextCenter.lat, lng: nextCenter.lng };
        currentZoom = nextZoom;
      }),
      distance: vi.fn((a, b) => {
        const dx = (b.lng - a.lng) * 111000;
        const dy = (b.lat - a.lat) * 111000;
        return Math.sqrt(dx * dx + dy * dy);
      }),
      latLngToContainerPoint: ({ lat, lng }) => ({
        x: Math.round((lng - currentCenter.lng) * 1000 + 180),
        y: Math.round((currentCenter.lat - lat) * 1000 + 320),
      }),
      containerPointToLatLng: ({ x, y }) => ({
        lat: currentCenter.lat - (y - 320) / 1000,
        lng: currentCenter.lng + (x - 180) / 1000,
      }),
    };
  };

  const MapContainer = React.forwardRef(({ children, center, zoom, whenReady }, ref) => {
    React.useEffect(() => {
      mapInstance = createMapInstance({ center, zoom });

      if (typeof ref === "function") {
        ref(mapInstance);
      } else if (ref) {
        ref.current = mapInstance;
      }

      whenReady?.({ target: mapInstance });
    }, [ref, whenReady]);

    return (
      <div
        data-testid="map-container"
        data-center={Array.isArray(center) ? center.join(",") : ""}
        data-zoom={String(zoom)}
      >
        {children}
      </div>
    );
  });

  return {
    MapContainer,
    TileLayer: ({ children }) => <div data-testid="tile-layer">{children}</div>,
    Polyline: ({ children }) => <div data-testid="polyline">{children}</div>,
    Tooltip: ({ children }) => <div data-testid="marker-tooltip">{children}</div>,
    Marker: ({ children, position, eventHandlers }) => (
      <div
        data-testid={`marker-${
          Array.isArray(position)
            ? position.join("-")
            : `${position?.lat}-${position?.lng}`
        }`}
        onClick={() =>
          eventHandlers?.click?.({
            latlng: Array.isArray(position)
              ? { lat: position?.[0], lng: position?.[1] }
              : { lat: position?.lat, lng: position?.lng },
            containerPoint: mapInstance?.latLngToContainerPoint(
              Array.isArray(position)
                ? { lat: position?.[0], lng: position?.[1] }
                : { lat: position?.lat, lng: position?.lng }
            ),
          })
        }
      >
        {children}
      </div>
    ),
    useMapEvents: (handlers) => {
      React.useEffect(() => {
        mapInstance = mapInstance ?? createMapInstance();
        handlers.load?.({ target: mapInstance });
        handlers.moveend?.({ target: mapInstance });
      }, []);

      return mapInstance;
    },
  };
});

const theme = createTheme({
  palette: {
    mode: "dark",
  },
});

function jsonResponse(data) {
  return Promise.resolve({
    json: () => Promise.resolve(data),
  });
}

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function renderWithProviders(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>
  );
}

function ControlledMap() {
  const [filters, setFilters] = React.useState(DEFAULT_MAP_BANNER_FILTERS);

  return <Map bannerFilters={filters} onBannerFiltersChange={setFilters} />;
}

beforeEach(() => {
  __resetDiscoveryMapCacheForTests();
  L.divIcon.mockClear();
  global.fetch = vi.fn();
  window.localStorage.clear();
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn().mockResolvedValue({ state: "prompt", onchange: null }),
    },
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(),
    },
  });
});

test("renders the first discovery map page before later pages finish", async () => {
  const secondPage = deferred();
  const banners = Array.from({ length: 60 }, (_, index) => ({
    id: `progressive-map-banner-${index + 1}`,
    title: `Progressive Map Banner ${index + 1}`,
    picture: `/images/progressive-map-${index + 1}.jpg`,
    numberOfMissions: 6,
    lengthMeters: 1800,
    formattedAddress: "Enschede, NL",
    numberOfDisabledMissions: 0,
    startLatitude: String(52.2 + index * 0.00001),
    startLongitude: String(6.85 + index * 0.00001),
  }));

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      const parsedUrl = new URL(url);
      const offset = Number(parsedUrl.searchParams.get("offset"));
      const limit = Number(parsedUrl.searchParams.get("limit"));

      if (offset === 50) {
        return secondPage.promise;
      }

      return jsonResponse(banners.slice(offset, offset + limit));
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  const bannerLink = await screen.findByRole("link", { name: /open banner/i });
  expect(bannerLink).toHaveAttribute(
    "href",
    "/banner/progressive-map-banner-1"
  );
  expect(screen.getByText("Progressive Map Banner 1")).toBeInTheDocument();
  expect(screen.queryByText("Progressive Map Banner 60")).not.toBeInTheDocument();

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

  secondPage.resolve({
    json: () => Promise.resolve(banners.slice(50)),
  });

  expect(await screen.findByText("60 banners in view")).toBeInTheDocument();
});

test("reuses partially loaded discovery map pages until refresh", async () => {
  const secondPage = deferred();
  const banners = Array.from({ length: 60 }, (_, index) => ({
    id: `cached-progressive-map-banner-${index + 1}`,
    title: `Cached Progressive Map Banner ${index + 1}`,
    picture: `/images/cached-progressive-map-${index + 1}.jpg`,
    numberOfMissions: 6,
    lengthMeters: 1800,
    formattedAddress: "Enschede, NL",
    numberOfDisabledMissions: 0,
    startLatitude: String(52.2 + index * 0.00001),
    startLongitude: String(6.85 + index * 0.00001),
  }));

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      const parsedUrl = new URL(url);
      const offset = Number(parsedUrl.searchParams.get("offset"));
      const limit = Number(parsedUrl.searchParams.get("limit"));

      if (offset === 50) {
        return secondPage.promise;
      }

      return jsonResponse(banners.slice(offset, offset + limit));
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const firstRender = renderWithProviders(<Map />);

  expect(
    await screen.findByText("Cached Progressive Map Banner 1")
  ).toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

  firstRender.unmount();
  renderWithProviders(<Map />);

  expect(
    await screen.findByText("Cached Progressive Map Banner 1")
  ).toBeInTheDocument();
  expect(screen.queryByText("Cached Progressive Map Banner 60")).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);

  secondPage.resolve({
    json: () => Promise.resolve(banners.slice(50)),
  });

  expect(await screen.findByText("60 banners in view")).toBeInTheDocument();
});

test("restores discovery map viewport and selected banner after remount", async () => {
  saveDiscoveryMapViewport({
    center: {
      latitude: 52.42,
      longitude: 6.99,
    },
    zoom: 12,
  });
  saveDiscoveryMapSelectedBanner("restored-map-banner-2");

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "restored-map-banner-1",
          title: "Restored Map Banner One",
          picture: "/images/restored-map-1.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.42",
          startLongitude: "6.99",
        },
        {
          id: "restored-map-banner-2",
          title: "Restored Map Banner Two",
          picture: "/images/restored-map-2.jpg",
          numberOfMissions: 12,
          lengthMeters: 2400,
          formattedAddress: "Hengelo, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.421",
          startLongitude: "6.991",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  const mapContainer = await screen.findByTestId("map-container");
  expect(mapContainer).toHaveAttribute("data-center", "52.42,6.99");
  expect(mapContainer).toHaveAttribute("data-zoom", "12");
  expect(await screen.findByText("Restored Map Banner Two")).toBeInTheDocument();
  expect(screen.queryByText("Restored Map Banner One")).not.toBeInTheDocument();
});

test("restores discovery map filters after remount", async () => {
  saveDiscoveryMapFilters({
    ...DEFAULT_MAP_BANNER_FILTERS,
    minimumKilometers: "2",
    maximumKilometers: "3",
  });

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "short-map-filter-banner",
          title: "Short Map Filter Banner",
          picture: "/images/short-map-filter.jpg",
          numberOfMissions: 6,
          lengthMeters: 1200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.85",
        },
        {
          id: "restored-map-filter-banner",
          title: "Restored Map Filter Banner",
          picture: "/images/restored-map-filter.jpg",
          numberOfMissions: 6,
          lengthMeters: 2400,
          formattedAddress: "Hengelo, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.201",
          startLongitude: "6.851",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const firstRender = renderWithProviders(<Map />);

  expect(await screen.findByText("Restored Map Filter Banner")).toBeInTheDocument();
  expect(screen.queryByText("Short Map Filter Banner")).not.toBeInTheDocument();

  firstRender.unmount();
  renderWithProviders(<Map />);

  expect(await screen.findByText("Restored Map Filter Banner")).toBeInTheDocument();
  expect(screen.queryByText("Short Map Filter Banner")).not.toBeInTheDocument();
});

test("toggles discovery map markers between images and list-colored dots", async () => {
  saveBannergressSyncData({
    bannerLists: {
      "dot-todo-banner": "todo",
      "dot-done-banner": "done",
      "dot-hidden-banner": "blacklist",
    },
  });

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "dot-todo-banner",
          title: "Dot Todo Banner",
          picture: "/images/dot-todo.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.85",
        },
        {
          id: "dot-done-banner",
          title: "Dot Done Banner",
          picture: "/images/dot-done.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.9",
        },
        {
          id: "dot-hidden-banner",
          title: "Dot Hidden Banner",
          picture: "/images/dot-hidden.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.15",
          startLongitude: "6.85",
        },
        {
          id: "dot-none-banner",
          title: "Dot None Banner",
          picture: "/images/dot-none.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.15",
          startLongitude: "6.9",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Map
      bannerFilters={{
        ...DEFAULT_MAP_BANNER_FILTERS,
        hideDoneBanners: false,
        showHiddenBanners: true,
      }}
    />
  );

  await screen.findByText("Dot Todo Banner");
  expect(screen.queryByText(/away/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /marker mode: images/i }));

  expect(
    screen.getByRole("button", { name: /marker mode: dots/i })
  ).toBeInTheDocument();
  expect(window.localStorage.getItem("openbanners.discoveryMap.markerMode")).toBe(
    "dots"
  );

  await waitFor(() => {
    const dotIconHtml = L.divIcon.mock.calls
      .map(([options]) => options)
      .filter((options) => options.className === "banner-map-dot-icon")
      .map((options) => options.html)
      .join("\n");

    expect(dotIconHtml).toContain("background:#f2b63d");
    expect(dotIconHtml).toContain("background:#35a853");
    expect(dotIconHtml).toContain("background:#d85f5f");
    expect(dotIconHtml).toContain("background:#4d9fff");
  });

  expect(
    screen.getAllByTestId("marker-tooltip").map((tooltip) => tooltip.textContent)
  ).toEqual(
    expect.arrayContaining([
      "Dot Todo Banner",
      "Dot Done Banner",
      "Dot Hidden Banner",
      "Dot None Banner",
    ])
  );
});

test("filters discovery map markers to to do banners only", async () => {
  window.localStorage.setItem("openbanners.discoveryMap.markerMode", "dots");
  saveBannergressSyncData({
    bannerLists: {
      "todo-map-banner": "todo",
      "done-map-banner": "done",
    },
  });

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "todo-map-banner",
          title: "Todo Map Banner",
          picture: "/images/todo-map.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.85",
        },
        {
          id: "done-map-banner",
          title: "Done Map Banner",
          picture: "/images/done-map.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.9",
        },
        {
          id: "none-map-banner",
          title: "None Map Banner",
          picture: "/images/none-map.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.15",
          startLongitude: "6.85",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  function FilterableMap() {
    const [filters, setFilters] = React.useState(DEFAULT_MAP_BANNER_FILTERS);

    return (
      <Map bannerFilters={filters} onBannerFiltersChange={setFilters} />
    );
  }

  renderWithProviders(<FilterableMap />);

  await waitFor(() => {
    const tooltipLabels = screen
      .getAllByTestId("marker-tooltip")
      .map((tooltip) => tooltip.textContent);

    expect(tooltipLabels).toEqual(
      expect.arrayContaining(["Todo Map Banner", "None Map Banner"])
    );
    expect(tooltipLabels).not.toContain("Done Map Banner");
  });

  fireEvent.click(screen.getByRole("button", { name: /^filters$/i }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: /only to do banners/i })
  );

  await waitFor(() => {
    expect(screen.getByText("1 banners in view")).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("marker-tooltip")
        .map((tooltip) => tooltip.textContent)
    ).toEqual(["Todo Map Banner"]);
  });
});

test("clusters nearby dot markers into numbered dots without connector lines", async () => {
  window.localStorage.setItem("openbanners.discoveryMap.markerMode", "dots");
  saveBannergressSyncData({
    bannerLists: {
      "cluster-dot-banner-1": "todo",
      "cluster-dot-banner-2": "done",
    },
  });

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "cluster-dot-banner-1",
          title: "Cluster Dot Banner 1",
          picture: "/images/cluster-dot-1.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.85",
        },
        {
          id: "cluster-dot-banner-2",
          title: "Cluster Dot Banner 2",
          picture: "/images/cluster-dot-2.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2005",
          startLongitude: "6.8505",
        },
        {
          id: "cluster-dot-banner-3",
          title: "Cluster Dot Banner 3",
          picture: "/images/cluster-dot-3.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.201",
          startLongitude: "6.851",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Map
      bannerFilters={{
        ...DEFAULT_MAP_BANNER_FILTERS,
        hideDoneBanners: false,
      }}
    />
  );

  await screen.findByText("Cluster Dot Banner 1");

  await waitFor(() => {
    const dotIconHtml = L.divIcon.mock.calls
      .map(([options]) => options)
      .filter((options) => options.className === "banner-map-dot-icon")
      .map((options) => options.html)
      .join("\n");

    expect(dotIconHtml).toContain(">3</div>");
    expect(dotIconHtml).toContain("conic-gradient");
    expect(dotIconHtml).toContain("#f2b63d");
    expect(dotIconHtml).toContain("#35a853");
    expect(dotIconHtml).toContain("#4d9fff");
  });

  expect(screen.queryByTestId("polyline")).not.toBeInTheDocument();
  expect(screen.queryByTestId("marker-tooltip")).not.toBeInTheDocument();

  fireEvent.click(screen.getAllByTestId(/marker-/)[0]);

  const firstPickerChoice = await screen.findByRole("button", {
    name: /select cluster dot banner 1/i,
  });

  expect(firstPickerChoice).toHaveAttribute("data-marker-mode", "dots");
  expect(firstPickerChoice.querySelector("img")).toBeNull();
  expect(screen.getAllByTestId("disambiguation-dot")).toHaveLength(3);
});

test("fetches additional discovery map pages when more than 50 banners are in view", async () => {
  const banners = Array.from({ length: 101 }, (_, index) => ({
    id: `map-page-banner-${index + 1}`,
    title: `Map Page Banner ${index + 1}`,
    picture: `/images/map-page-${index + 1}.jpg`,
    numberOfMissions: 6,
    lengthMeters: 1800,
    formattedAddress: "Enschede, NL",
    numberOfDisabledMissions: 0,
    startLatitude: String(52.2 + index * 0.00001),
    startLongitude: String(6.85 + index * 0.00001),
  }));

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      const parsedUrl = new URL(url);
      const offset = Number(parsedUrl.searchParams.get("offset"));
      const limit = Number(parsedUrl.searchParams.get("limit"));

      return jsonResponse(banners.slice(offset, offset + limit));
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  expect(await screen.findByText("101 banners in view")).toBeInTheDocument();

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

  const fetchedOffsets = global.fetch.mock.calls.map(([url]) =>
    new URL(url).searchParams.get("offset")
  );

  expect(fetchedOffsets).toEqual(["0", "50", "100"]);
});

test("filters discovery map banners by minimum and maximum route kilometers", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "short-route-banner",
          title: "Short Route Banner",
          picture: "/images/short-route.jpg",
          numberOfMissions: 6,
          lengthMeters: 1200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.2",
          startLongitude: "6.85",
        },
        {
          id: "middle-route-banner",
          title: "Middle Route Banner",
          picture: "/images/middle-route.jpg",
          numberOfMissions: 6,
          lengthMeters: 2600,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.21",
          startLongitude: "6.86",
        },
        {
          id: "long-route-banner",
          title: "Long Route Banner",
          picture: "/images/long-route.jpg",
          numberOfMissions: 6,
          lengthMeters: 5200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.87",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<ControlledMap />);

  expect(await screen.findByText("3 banners in view")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^filters$/i }));
  fireEvent.change(screen.getByLabelText("Minimum km"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Maximum km"), {
    target: { value: "3" },
  });

  expect(await screen.findByText("1 banners in view")).toBeInTheDocument();
  expect(screen.getByText("Middle Route Banner")).toBeInTheDocument();
  expect(screen.queryByText("Short Route Banner")).not.toBeInTheDocument();
  expect(screen.queryByText("Long Route Banner")).not.toBeInTheDocument();
});
