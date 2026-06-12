import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import L from "leaflet";
import Map, { __resetDiscoveryMapCacheForTests } from "./Map";
import { DEFAULT_MAP_BANNER_FILTERS } from "../bannerFilters";
import { saveBannergressSyncData } from "../bannergressSync";

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

  const createMapInstance = () => ({
    getBounds: () => ({
      _southWest: { lat: 52.1, lng: 6.8 },
      _northEast: { lat: 52.3, lng: 6.9 },
    }),
    getZoom: () => 15,
    getContainer: () => document.createElement("div"),
    setView: vi.fn(),
    distance: vi.fn((a, b) => {
      const dx = (b.lng - a.lng) * 111000;
      const dy = (b.lat - a.lat) * 111000;
      return Math.sqrt(dx * dx + dy * dy);
    }),
    latLngToContainerPoint: ({ lat, lng }) => ({
      x: Math.round((lng - 6.85) * 1000 + 180),
      y: Math.round((52.2 - lat) * 1000 + 320),
    }),
    containerPointToLatLng: ({ x, y }) => ({
      lat: 52.2 - (y - 320) / 1000,
      lng: 6.85 + (x - 180) / 1000,
    }),
  });

  const MapContainer = React.forwardRef(({ children, whenReady }, ref) => {
    React.useEffect(() => {
      mapInstance = createMapInstance();

      if (typeof ref === "function") {
        ref(mapInstance);
      } else if (ref) {
        ref.current = mapInstance;
      }

      whenReady?.({ target: mapInstance });
    }, [ref, whenReady]);

    return <div data-testid="map-container">{children}</div>;
  });

  return {
    MapContainer,
    TileLayer: ({ children }) => <div data-testid="tile-layer">{children}</div>,
    Polyline: ({ children }) => <div data-testid="polyline">{children}</div>,
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

beforeEach(() => {
  __resetDiscoveryMapCacheForTests();
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
});

test("clusters nearby dot markers into numbered dots without connector lines", async () => {
  window.localStorage.setItem("openbanners.discoveryMap.markerMode", "dots");

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

  renderWithProviders(<Map />);

  await screen.findByText("Cluster Dot Banner 1");

  await waitFor(() => {
    const dotIconHtml = L.divIcon.mock.calls
      .map(([options]) => options)
      .filter((options) => options.className === "banner-map-dot-icon")
      .map((options) => options.html)
      .join("\n");

    expect(dotIconHtml).toContain(">3</div>");
  });

  expect(screen.queryByTestId("polyline")).not.toBeInTheDocument();

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
