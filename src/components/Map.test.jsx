import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import Map, { __resetDiscoveryMapCacheForTests } from "./Map";

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
    Marker: ({ children, position }) => (
      <div
        data-testid={`marker-${
          Array.isArray(position)
            ? position.join("-")
            : `${position?.lat}-${position?.lng}`
        }`}
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
