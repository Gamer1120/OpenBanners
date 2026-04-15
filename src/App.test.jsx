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
import BannerGuiderWithoutLocation from "./components/BannerGuiderWithoutLocation";
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

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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
  window.localStorage.clear();
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn().mockResolvedValue({ state: "prompt", onchange: null }),
    },
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((success) =>
        success({
          coords: {
            latitude: 52.221058,
            longitude: 6.893297,
          },
        })
      ),
    },
  });
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

test("shows a warning when nearby banners cannot use blocked location access", async () => {
  navigator.permissions.query = vi.fn().mockResolvedValue({
    state: "denied",
    onchange: null,
  });

  renderWithProviders(
    <Routes>
      <Route path="/" element={<BannersNearMe />} />
    </Routes>
  );

  expect(
    await screen.findByText(/Location access is blocked/i)
  ).toBeInTheDocument();
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
  expect(
    screen.getByRole("button", { name: /visual banner view/i })
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("link", { name: /browse banner/i })).toHaveAttribute(
    "href",
    "/banner/browse-banner"
  );
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

test("uses cached country places without refetching", async () => {
  window.localStorage.setItem(
    "openbanners-country-places-v1",
    JSON.stringify({
      cachedAt: Date.now(),
      places: [
        {
          id: "cached-netherlands",
          formattedAddress: "Netherlands",
          numberOfBanners: 12,
        },
      ],
    })
  );

  renderWithProviders(
    <Routes>
      <Route path="/browse/" element={<PlacesList />} />
    </Routes>,
    { route: "/browse/" }
  );

  expect(await screen.findByText(/Netherlands \(12\)/)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
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

  await userEvent.click(screen.getByRole("button", { name: /go to home page/i }));
  expect(onTitleClick).toHaveBeenCalledTimes(1);

  await userEvent.type(
    screen.getByPlaceholderText("Search banners or places"),
    "enschede{enter}"
  );
  expect(onSearch).toHaveBeenCalledWith("enschede");

  await userEvent.clear(screen.getByPlaceholderText("Search banners or places"));
  await userEvent.type(
    screen.getByPlaceholderText("Search banners or places"),
    "{enter}"
  );
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
  expect(
    screen.getByRole("button", { name: /visual banner view/i })
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("link", { name: /search banner/i })).toHaveAttribute(
    "href",
    "/banner/search-banner"
  );
});

test("persists compact banner view preference across result screens", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places?used=true&type=country")) {
      return jsonResponse([]);
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

    if (url.includes("/places?used=true&collapsePlaces=true&query=enschede")) {
      return jsonResponse([]);
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

  const user = userEvent.setup();

  const { unmount } = renderWithProviders(
    <Routes>
      <Route path="/browse/" element={<BrowsingPage />} />
    </Routes>,
    { route: "/browse/" }
  );

  await screen.findByText("Browse Banner");
  await user.click(screen.getByRole("button", { name: /compact banner view/i }));
  expect(
    screen.getByRole("button", { name: /compact banner view/i })
  ).toHaveAttribute("aria-pressed", "true");

  unmount();

  renderWithProviders(
    <Routes>
      <Route path="/search/:query" element={<SearchResults />} />
    </Routes>,
    { route: "/search/enschede" }
  );

  await screen.findByText("Search Banner");
  expect(
    screen.getByRole("button", { name: /compact banner view/i })
  ).toHaveAttribute("aria-pressed", "true");
});

test("shows place results before banner results finish loading", async () => {
  const bannerResponse = deferred();

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
      return bannerResponse.promise;
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
  expect(screen.queryByText("Search Banner")).not.toBeInTheDocument();

  bannerResponse.resolve({
    json: () =>
      Promise.resolve([
        {
          id: "search-banner",
          title: "Search Banner",
          picture: "/images/search.jpg",
          numberOfMissions: 12,
          lengthMeters: 3600,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
      ]),
  });

  expect(await screen.findByText("Search Banner")).toBeInTheDocument();
});

test("shows an empty state when search returns no places or banners", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("query=missing")) {
      return jsonResponse([]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/search/:query" element={<SearchResults />} />
    </Routes>,
    { route: "/search/missing" }
  );

  expect(await screen.findByText('No results found for "missing".')).toBeInTheDocument();
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

test("renders a single visible map for banner details even with multiple missions", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/large-banner")) {
      return jsonResponse({
        id: "large-banner",
        title: "Large Banner",
        picture: "/images/detail.jpg",
        numberOfMissions: 2,
        lengthMeters: 2100,
        formattedAddress: "Amsterdam, NL",
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
          "mission-2": {
            id: "mission-2",
            steps: {
              0: {
                poi: {
                  title: "Portal Two",
                  type: "portal",
                  latitude: 52.38,
                  longitude: 4.9,
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
    { route: "/banner/large-banner" }
  );

  expect(await screen.findByText("Large Banner")).toBeInTheDocument();
  expect(screen.getAllByTestId("map-container")).toHaveLength(1);
});

test("renders only mission start markers on the banner details overview map", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/overview-banner")) {
      return jsonResponse({
        id: "overview-banner",
        title: "Overview Banner",
        picture: "/images/detail.jpg",
        numberOfMissions: 2,
        lengthMeters: 2100,
        formattedAddress: "Amsterdam, NL",
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
              1: {
                poi: {
                  title: "Portal Two",
                  type: "portal",
                  latitude: 52.371,
                  longitude: 4.891,
                },
              },
            },
          },
          "mission-2": {
            id: "mission-2",
            steps: {
              0: {
                poi: {
                  title: "Portal Three",
                  type: "portal",
                  latitude: 52.38,
                  longitude: 4.9,
                },
              },
              1: {
                poi: {
                  title: "Portal Four",
                  type: "portal",
                  latitude: 52.381,
                  longitude: 4.901,
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
    { route: "/banner/overview-banner" }
  );

  expect(await screen.findByText("Overview Banner")).toBeInTheDocument();
  expect(screen.getByTestId("marker-52.37-4.89")).toBeInTheDocument();
  expect(screen.getByTestId("marker-52.38-4.9")).toBeInTheDocument();
  expect(screen.queryByTestId("marker-52.371-4.891")).not.toBeInTheDocument();
  expect(screen.queryByTestId("marker-52.381-4.901")).not.toBeInTheDocument();
  expect(screen.queryByText("Navigate to portal")).not.toBeInTheDocument();
});

test("renders the guider in overview mode before a mission is selected", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/guide-banner")) {
      return jsonResponse({
        id: "guide-banner",
        title: "Guide Banner",
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
              1: {
                poi: {
                  title: "Portal Two",
                  type: "portal",
                  latitude: 52.371,
                  longitude: 4.891,
                },
              },
            },
          },
          "mission-2": {
            id: "mission-2",
            steps: {
              0: {
                poi: {
                  title: "Portal Three",
                  type: "portal",
                  latitude: 52.38,
                  longitude: 4.9,
                },
              },
              1: {
                poi: {
                  title: "Portal Four",
                  type: "portal",
                  latitude: 52.381,
                  longitude: 4.901,
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
      <Route
        path="/bannerguiderwithoutlocation/:bannerId"
        element={<BannerGuiderWithoutLocation />}
      />
    </Routes>,
    { route: "/bannerguiderwithoutlocation/guide-banner" }
  );

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/bnrs/guide-banner")
    )
  );
  expect(screen.getByTestId("marker-52.37-4.89")).toBeInTheDocument();
  expect(screen.getByTestId("marker-52.38-4.9")).toBeInTheDocument();
  expect(screen.queryByTestId("marker-52.371-4.891")).not.toBeInTheDocument();
  expect(screen.queryByTestId("marker-52.381-4.901")).not.toBeInTheDocument();
  expect(screen.queryByText("Navigate to portal")).not.toBeInTheDocument();
});

test("shows a retryable error when banner details fail to load", async () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch.mockRejectedValue(new Error("network down"));

  renderWithProviders(
    <Routes>
      <Route path="/banner/:bannerId" element={<BannerDetailsPage />} />
    </Routes>,
    { route: "/banner/broken-banner" }
  );

  expect(
    await screen.findByText("Couldn't load this banner. Please try again.")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  consoleErrorSpy.mockRestore();
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
