import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMediaQuery } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import * as bannergressSync from "./bannergressSync";
import BannersNearMe from "./components/BannersNearMe";
import BannerListItem from "./components/BannerListItem";
import BrowsingPage from "./components/BrowsingPage";
import SearchResults from "./components/SearchResults";
import BannerDetailsPage from "./components/BannerDetailsPage";
import BannerGuiderWithoutLocation from "./components/BannerGuiderWithoutLocation";
import Map, { __resetDiscoveryMapCacheForTests } from "./components/Map";
import PlacesList from "./components/PlacesList";
import TopMenu from "./components/TopMenu";
import { getFlagForPlace } from "./components/CountryFlags";
import { applyBannerFilters, DEFAULT_BANNER_FILTERS } from "./bannerFilters";
import {
  BANNERGRESS_AUTH_STORAGE_KEY,
  BANNERGRESS_SYNC_STORAGE_KEY,
} from "./bannergressSync";
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
    latLngToContainerPoint: ({ lat, lng }) => ({
      x: Math.round((lng - 6.8) * 1000),
      y: Math.round((52.3 - lat) * 1000),
    }),
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
    Marker: ({ children, position, eventHandlers }) => (
      <div
        data-testid={`marker-${position?.join("-")}`}
        onClick={() =>
          eventHandlers?.click?.({
            latlng: { lat: position?.[0], lng: position?.[1] },
            containerPoint: mapInstance?.latLngToContainerPoint({
              lat: position?.[0],
              lng: position?.[1],
            }),
          })
        }
      >
        {children}
      </div>
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
  __resetDiscoveryMapCacheForTests();
  global.fetch = vi.fn();
  useMediaQuery.mockReturnValue(false);
  global.IntersectionObserver = class MockIntersectionObserver {
    constructor() {}

    observe() {}

    disconnect() {}

    unobserve() {}
  };
  global.Image = class MockImage {
    constructor() {
      this.naturalWidth = 2;
      this.naturalHeight = 3;
      this.onload = null;
      this.onerror = null;
    }

    set src(_value) {
      this._src = _value;
      setTimeout(() => {
        this.onload?.();
      }, 0);
    }

    get src() {
      return this._src;
    }
  };
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
    expect.stringContaining("orderBy=proximityStartPoint"),
    expect.objectContaining({
      headers: expect.any(Headers),
    })
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

    if (url.includes("/bnrs?limit=9&offset=0&orderBy=created")) {
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

test("compact list actions update the Bannergress list through the API", async () => {
  const updateBannerListSpy = vi
    .spyOn(bannergressSync, "updateBannergressBannerListType")
    .mockImplementation(async (bannerId, listType) => {
      return bannergressSync.saveBannergressBannerListType(bannerId, listType);
    });

  renderWithProviders(
    <BannerListItem
      banner={{
        id: "list-action-banner",
        title: "Action Banner",
        picture: "/images/action-banner.jpg",
        numberOfMissions: 6,
        lengthMeters: 2400,
        formattedAddress: "Enschede, NL",
        numberOfDisabledMissions: 0,
      }}
    />
  );

  await userEvent.click(screen.getByRole("button", { name: /to do/i }));

  await waitFor(() => {
    expect(updateBannerListSpy).toHaveBeenCalledWith(
      "list-action-banner",
      "todo",
      {
        keepHiddenVisible: false,
      }
    );
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /to do/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  expect(
    JSON.parse(window.localStorage.getItem(BANNERGRESS_SYNC_STORAGE_KEY))
  ).toMatchObject({
    bannerLists: {
      "list-action-banner": "todo",
    },
  });
});

test("compact list actions toggle todo banners back to none", async () => {
  bannergressSync.saveBannergressSyncData({
    bannerLists: {
      "toggle-banner": "todo",
    },
  });

  const updateBannerListSpy = vi
    .spyOn(bannergressSync, "updateBannergressBannerListType")
    .mockImplementation(async (bannerId, listType, options) => {
      return bannergressSync.saveBannergressBannerListType(
        bannerId,
        listType,
        options
      );
    });

  renderWithProviders(
    <BannerListItem
      banner={{
        id: "toggle-banner",
        title: "Toggle Banner",
        picture: "/images/toggle-banner.jpg",
        numberOfMissions: 6,
        lengthMeters: 2400,
        formattedAddress: "Enschede, NL",
        numberOfDisabledMissions: 0,
      }}
    />
  );

  expect(screen.getByRole("button", { name: /to do/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await userEvent.click(screen.getByRole("button", { name: /to do/i }));

  await waitFor(() => {
    expect(updateBannerListSpy).toHaveBeenCalledWith("toggle-banner", "none", {
      keepHiddenVisible: false,
    });
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /to do/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  expect(
    JSON.parse(window.localStorage.getItem(BANNERGRESS_SYNC_STORAGE_KEY))
  ).toMatchObject({
    bannerLists: {
      "toggle-banner": "none",
    },
  });
});

test("newly hidden banners stay visible in the current filtered results", () => {
  bannergressSync.saveBannergressBannerListType("hidden-banner", "blacklist", {
    keepHiddenVisible: true,
  });

  const filteredBanners = applyBannerFilters(
    [
      {
        id: "hidden-banner",
        title: "Hidden Banner",
        numberOfDisabledMissions: 0,
      },
    ],
    bannergressSync.loadBannergressSyncData(),
    DEFAULT_BANNER_FILTERS
  );

  expect(filteredBanners).toHaveLength(1);
  expect(filteredBanners[0].id).toBe("hidden-banner");
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

test("top menu shows authenticate when bannergress auth has no valid session", async () => {
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <TopMenu
            onBrowseClick={vi.fn()}
            onTitleClick={vi.fn()}
            onSearch={vi.fn()}
          />
        }
      />
    </Routes>
  );

  expect(
    await screen.findByRole("button", { name: /authenticate/i }, { timeout: 3000 })
  ).toBeInTheDocument();
});

test("top menu shows authenticated when bannergress auth is stored locally", async () => {
  vi.spyOn(bannergressSync, "requestBannergressSyncData").mockResolvedValue({
    syncedAt: new Date().toISOString(),
    bannerLists: {},
  });

  window.localStorage.setItem(
    BANNERGRESS_AUTH_STORAGE_KEY,
    JSON.stringify({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      accessExpiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: Date.now() + 30 * 60 * 1000,
      updatedAt: Date.now(),
    })
  );

  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <TopMenu
            onBrowseClick={vi.fn()}
            onTitleClick={vi.fn()}
            onSearch={vi.fn()}
          />
        }
      />
    </Routes>
  );

  expect(
    await screen.findByRole("button", { name: /authenticated/i }, { timeout: 3000 })
  ).toBeInTheDocument();
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

    if (url.includes("/bnrs?limit=9&offset=0&orderBy=created")) {
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

test("shows separate overview and map tabs for banner details on mobile", async () => {
  useMediaQuery.mockReturnValue(true);

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/mobile-detail-banner")) {
      return jsonResponse({
        id: "mobile-detail-banner",
        title: "Mobile Detail Banner",
        picture: "/images/detail.jpg",
        numberOfMissions: 6,
        lengthMeters: 2100,
        formattedAddress: "Amsterdam, NL",
        description: "A banner used for mobile layout testing.",
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

  const user = userEvent.setup();

  renderWithProviders(
    <Routes>
      <Route path="/banner/:bannerId" element={<BannerDetailsPage />} />
    </Routes>,
    { route: "/banner/mobile-detail-banner" }
  );

  expect(await screen.findByText("Mobile Detail Banner")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /overview/i })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.queryByTestId("map-container")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /map/i }));

  expect(screen.getByRole("tab", { name: /map/i })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.getByTestId("map-container")).toBeInTheDocument();
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

test("shows bannergress list action buttons on the banner overview page", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/overview-actions-banner")) {
      return jsonResponse({
        id: "overview-actions-banner",
        title: "Overview Actions Banner",
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
        },
      });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/banner/:bannerId" element={<BannerDetailsPage />} />
    </Routes>,
    { route: "/banner/overview-actions-banner" }
  );

  expect(await screen.findByText("Overview Actions Banner")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /to do/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /hide/i })).toBeInTheDocument();
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
      expect.stringContaining("/bnrs/guide-banner"),
      expect.objectContaining({
        headers: expect.any(Headers),
      })
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

test("renders a discovery map with proximity-sorted poster markers and preview links", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "map-banner",
          title: "Map Banner",
          picture: "/images/map.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  const bannerLink = await screen.findByRole("link", { name: /open banner/i });
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("orderBy=proximityStartPoint"),
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    )
  );
  expect(bannerLink).toHaveAttribute("href", "/banner/map-banner");
  expect(L.icon).not.toHaveBeenCalled();
  expect(L.divIcon).toHaveBeenCalledWith(
    expect.objectContaining({
      className: "banner-map-icon",
      iconSize: expect.any(Array),
      iconAnchor: expect.any(Array),
      html: expect.stringContaining("box-shadow"),
    })
  );
  expect(L.divIcon).toHaveBeenCalledWith(
    expect.objectContaining({
      html: expect.stringContaining("https://api.bannergress.com/images/map.jpg"),
    })
  );
  expect(screen.getByText("Map Banner")).toBeInTheDocument();
  expect(screen.getByText(/away/i)).toBeInTheDocument();
});

test("lets you change discovery map poster size with presets and a custom slider", async () => {
  const user = userEvent.setup();

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "map-banner",
          title: "Map Banner",
          picture: "/images/map.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  await screen.findByRole("link", { name: /open banner/i });

  const imageSizeButton = screen.getByRole("button", {
    name: /image size: medium/i,
  });

  await user.click(imageSizeButton);
  await user.click(screen.getByRole("menuitem", { name: /large/i }));

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /image size: large/i })
    ).toBeInTheDocument()
  );

  await user.click(screen.getByRole("button", { name: /image size: large/i }));
  await user.click(screen.getByRole("menuitem", { name: /custom/i }));

  const customSlider = screen.getByRole("slider", {
    name: /custom image size/i,
  });
  fireEvent.change(customSlider, { target: { value: "1.6" } });

  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: /image size: custom \(160%\)/i,
        hidden: true,
      })
    ).toBeInTheDocument()
  );

  const bannerIconCalls = L.divIcon.mock.calls
    .map(([options]) => options)
    .filter((options) => options.className === "banner-map-icon");

  expect(
    bannerIconCalls.some((options) => options.html?.includes("width:172px"))
  ).toBe(true);
});

test("reuses cached discovery map results for the same view", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "cached-map-banner",
          title: "Cached Map Banner",
          picture: "/images/cached-map.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const firstRender = renderWithProviders(<Map />);
  expect(
    await screen.findByRole("link", { name: /open banner/i })
  ).toHaveAttribute("href", "/banner/cached-map-banner");
  expect(global.fetch).toHaveBeenCalledTimes(1);

  firstRender.unmount();
  global.fetch.mockClear();

  renderWithProviders(<Map />);

  expect(
    await screen.findByRole("link", { name: /open banner/i })
  ).toHaveAttribute("href", "/banner/cached-map-banner");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("renders every fetched discovery map banner in the current view", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "map-banner-1",
          title: "Map Banner One",
          picture: "/images/map-1.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
        {
          id: "map-banner-2",
          title: "Map Banner Two",
          picture: "/images/map-2.jpg",
          numberOfMissions: 12,
          lengthMeters: 2200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.225",
          startLongitude: "6.895",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  expect(await screen.findByText("2 banners in view")).toBeInTheDocument();
  expect(screen.queryByText(/showing the nearest/i)).not.toBeInTheDocument();
});

test("opens a disambiguation picker when overlapping map banners share a tap target", async () => {
  const user = userEvent.setup();

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "map-banner-1",
          title: "Map Banner One",
          picture: "/images/map-1.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
        {
          id: "map-banner-2",
          title: "Map Banner Two",
          picture: "/images/map-2.jpg",
          numberOfMissions: 12,
          lengthMeters: 2200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.225",
          startLongitude: "6.895",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  expect(await screen.findByText("2 banners in view")).toBeInTheDocument();

  await user.click(screen.getByTestId("marker-52.22-6.89"));

  expect(await screen.findByText("Pick the banner you meant.")).toBeInTheDocument();
  expect(screen.getAllByText("Map Banner One").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Map Banner Two").length).toBeGreaterThan(0);

  await user.click(
    screen.getByRole("button", { name: /map banner two/i })
  );

  await waitFor(() =>
    expect(screen.getByRole("link", { name: /open banner/i })).toHaveAttribute(
      "href",
      "/banner/map-banner-2"
    )
  );
  expect(screen.queryByText("Pick the banner you meant.")).not.toBeInTheDocument();
});

test("renders discovery map markers even before banner image ratios load", async () => {
  global.Image = class PendingImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    set src(_value) {
      this._src = _value;
    }

    get src() {
      return this._src;
    }
  };

  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "pending-map-banner-1",
          title: "Pending Map Banner One",
          picture: "/images/pending-map-1.jpg",
          numberOfMissions: 6,
          lengthMeters: 1800,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.22",
          startLongitude: "6.89",
        },
        {
          id: "pending-map-banner-2",
          title: "Pending Map Banner Two",
          picture: "/images/pending-map-2.jpg",
          numberOfMissions: 12,
          lengthMeters: 2200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
          startLatitude: "52.225",
          startLongitude: "6.895",
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(<Map />);

  expect(await screen.findByText("2 banners in view")).toBeInTheDocument();

  await waitFor(() => {
    const bannerIconCalls = L.divIcon.mock.calls
      .map(([options]) => options)
      .filter((options) => options.className === "banner-map-icon");

    expect(bannerIconCalls.length).toBeGreaterThanOrEqual(2);
  });
});
