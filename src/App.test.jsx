import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import BannersNearMe from "./components/BannersNearMe";
import BrowsingPage from "./components/BrowsingPage";
import SearchResults from "./components/SearchResults";
import BannerDetailsPage from "./components/BannerDetailsPage";
import Map from "./components/Map";
import PlacesList from "./components/PlacesList";
import TopMenu from "./components/TopMenu";
import { getFlagForPlace } from "./components/CountryFlags";
import L from "leaflet";

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual("@mui/material");

  return {
    ...actual,
    useMediaQuery: vi.fn(() => false),
  };
});

vi.mock("leaflet", () => {
  const leaflet = {
    icon: vi.fn((options) => options),
    divIcon: vi.fn((options) => options),
    latLngBounds: vi.fn((coordinates) => ({ coordinates })),
    Browser: {
      mobile: false,
    },
  };

  return {
    __esModule: true,
    default: leaflet,
  };
});

vi.mock("react-leaflet", async () => {
  const React = await vi.importActual("react");

  let mapInstance = null;

  const createMapInstance = () => ({
    fitBounds: vi.fn(),
    getBounds: () => ({
      _southWest: { lat: 52.1, lng: 6.8 },
      _northEast: { lat: 52.3, lng: 6.9 },
    }),
    eachLayer: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    locate: vi.fn(),
    setView: vi.fn(),
    getZoom: vi.fn(() => 15),
  });

  const MapContainer = React.forwardRef(
    ({ children, whenReady, ...props }, ref) => {
      React.useEffect(() => {
        mapInstance = createMapInstance();

        if (ref) {
          if (typeof ref === "function") {
            ref(mapInstance);
          } else {
            ref.current = mapInstance;
          }
        }

        whenReady?.({ target: mapInstance });
      }, []);

      return (
        <div data-testid="map-container">
          {children}
        </div>
      );
    }
  );

  return {
    MapContainer,
    TileLayer: ({ children }) => <div data-testid="tile-layer">{children}</div>,
    Marker: ({ children, position }) => (
      <div data-testid={`marker-${position?.join("-")}`}>{children}</div>
    ),
    Polyline: ({ children }) => <div data-testid="polyline">{children}</div>,
    Popup: ({ children }) => <div>{children}</div>,
    useMap: () => mapInstance ?? createMapInstance(),
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

function renderWithProviders(ui, { route = "/" } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </ThemeProvider>
  );
}

function LocationDisplay() {
  const location = useLocation();

  return <div data-testid="location-display">{location.pathname}</div>;
}

beforeEach(() => {
  global.fetch = vi.fn();
  window.open = vi.fn();
  navigator.share = vi.fn().mockResolvedValue(undefined);
  navigator.permissions = {
    query: vi.fn().mockResolvedValue({ state: "prompt", onchange: null }),
  };
  navigator.geolocation = {
    getCurrentPosition: vi.fn((success) =>
      success({
        coords: {
          latitude: 52.221058,
          longitude: 6.893297,
        },
      })
    ),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

test("renders nearby banners after granting location access", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "nearby-banner",
          title: "Nearby Banner",
          picture: "/images/nearby.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/" element={<BannersNearMe />} />
    </Routes>
  );

  await userEvent.click(
    await screen.findByRole("button", { name: /grant location access/i })
  );

  expect(await screen.findByText("Nearby Banner")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("orderBy=proximityStartPoint")
  );
});

test("normalizes place aliases to the expected country flags", () => {
  expect(getFlagForPlace("The Netherlands")).toBe("🇳🇱");
  expect(getFlagForPlace("Curacao")).toBe("🇨🇼");
  expect(getFlagForPlace("Republic of Korea")).toBe("🇰🇷");
  expect(getFlagForPlace("  Reunion  ")).toBe("🇷🇪");
});

test("renders browsing results and places list", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places?used=true&type=country")) {
      return jsonResponse([
        {
          id: "netherlands",
          formattedAddress: "Netherlands",
          numberOfBanners: 12,
        },
      ]);
    }

    if (url.includes("/bnrs?limit=100&offset=0&orderBy=created")) {
      return jsonResponse([
        {
          id: "browse-banner",
          title: "Browse Banner",
          picture: "/images/browse.jpg",
          numberOfMissions: 6,
          lengthMeters: 2400,
          formattedAddress: "Utrecht, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/browse/" element={<BrowsingPage />} />
    </Routes>,
    { route: "/browse/" }
  );

  expect(await screen.findByText("Browsing")).toBeInTheDocument();
  expect(await screen.findByText("Browse Banner")).toBeInTheDocument();
  expect(await screen.findByText(/Netherlands/)).toBeInTheDocument();
});

test("renders places list flags and browse links for aliased place names", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places?used=true&type=country")) {
      return jsonResponse([
        {
          id: "curacao",
          formattedAddress: "Curacao",
          numberOfBanners: 4,
        },
        {
          id: "south-korea",
          formattedAddress: "Republic of Korea",
          numberOfBanners: 9,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/browse/" element={<PlacesList />} />
    </Routes>,
    { route: "/browse/" }
  );

  expect(await screen.findByText("🇨🇼")).toBeInTheDocument();
  expect(screen.getByText("🇰🇷")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Curacao \(4\)/ })).toHaveAttribute(
    "href",
    "/browse/curacao"
  );
  expect(
    screen.getByRole("link", { name: /Republic of Korea \(9\)/ })
  ).toHaveAttribute("href", "/browse/south-korea");
});

test("submits top menu searches, fires menu callbacks, and navigates map route", async () => {
  const onBrowseClick = vi.fn();
  const onTitleClick = vi.fn();
  const onSearch = vi.fn();

  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <TopMenu
              onBrowseClick={onBrowseClick}
              onTitleClick={onTitleClick}
              onSearch={onSearch}
            />
            <LocationDisplay />
          </>
        }
      />
      <Route path="/map" element={<LocationDisplay />} />
    </Routes>,
    { route: "/" }
  );

  await userEvent.click(screen.getByRole("button", { name: /browse/i }));
  expect(onBrowseClick).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByText("OB"));
  expect(onTitleClick).toHaveBeenCalledTimes(1);

  await userEvent.type(screen.getByPlaceholderText("Search"), "enschede{enter}");
  expect(onSearch).toHaveBeenCalledWith("enschede");

  await userEvent.clear(screen.getByPlaceholderText("Search"));
  await userEvent.type(screen.getByPlaceholderText("Search"), "{enter}");
  expect(onSearch).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole("button", { name: /map/i }));
  expect(screen.getByTestId("location-display")).toHaveTextContent("/map");
});

test("renders place and banner search results", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places?used=true&collapsePlaces=true&query=enschede")) {
      return jsonResponse([
        {
          id: "enschede-place",
          shortName: "Enschede",
          type: "CITY",
          numberOfBanners: 22,
        },
      ]);
    }

    if (url.includes("/bnrs?orderBy=relevance") && url.includes("query=enschede")) {
      return jsonResponse([
        {
          id: "search-banner",
          title: "Search Banner",
          picture: "/images/search.jpg",
          numberOfMissions: 12,
          lengthMeters: 3600,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/search/:query" element={<SearchResults />} />
    </Routes>,
    { route: "/search/enschede" }
  );

  expect(await screen.findByText(/Enschede \(CITY\) \(22\)/)).toBeInTheDocument();
  expect(await screen.findByText("Search Banner")).toBeInTheDocument();
});

test("renders banner details route with actions", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/detail-banner")) {
      return jsonResponse({
        id: "detail-banner",
        title: "Detail Banner",
        picture: "/images/detail.jpg",
        numberOfMissions: 6,
        lengthMeters: 2100,
        formattedAddress: "Amsterdam, NL",
        description: "A banner used for smoke testing.",
        startLatitude: 52.37,
        startLongitude: 4.89,
        missions: {
          "mission-1": {
            id: "mission-1",
            steps: {
              0: {
                poi: {
                  title: "Portal One",
                  type: "portal",
                  latitude: 52.37,
                  longitude: 4.89,
                },
              },
            },
          },
        },
      });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/banner/:bannerId" element={<BannerDetailsPage />} />
    </Routes>,
    { route: "/banner/detail-banner" }
  );

  expect(await screen.findByText("Detail Banner")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /share banner/i })
  ).toBeInTheDocument();
});

test("renders map markers using fixed contain icons linked to banner details routes", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=created&orderDirection=DESC&online=true")) {
      return jsonResponse([
        {
          id: "map-banner",
          title: "Map Banner",
          picture: "/images/map.jpg",
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  const bannerLink = await screen.findByRole("link");
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("orderBy=created")
    )
  );
  expect(bannerLink).toHaveAttribute("href", "/banner/map-banner");
  expect(L.icon).not.toHaveBeenCalled();
  expect(L.divIcon).toHaveBeenCalledWith(
    expect.objectContaining({
      className: "banner-map-icon",
      iconSize: [100, 150],
      iconAnchor: [50, 150],
      html: expect.stringContaining("object-fit:contain"),
    })
  );
  expect(L.divIcon).toHaveBeenCalledWith(
    expect.objectContaining({
      html: expect.stringContaining("https://api.bannergress.com/images/map.jpg"),
    })
  );
});
