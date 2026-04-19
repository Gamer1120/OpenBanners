import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMediaQuery } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import * as bannergressSync from "./bannergressSync";
import BannersNearMe from "./components/BannersNearMe";
import BannerListItem from "./components/BannerListItem";
import BannerFilterButton from "./components/BannerFilterButton";
import BrowsingPage from "./components/BrowsingPage";
import SearchResults from "./components/SearchResults";
import BannerDetailsPage from "./components/BannerDetailsPage";
import BannerGuider from "./components/BannerGuider";
import BannerGuiderWithoutLocation from "./components/BannerGuiderWithoutLocation";
import Home from "./components/Home";
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
    point: vi.fn((x, y) => ({ x, y })),
    Browser: {
      mobile: false,
    },
  };

  globalThis.L = {
    ...leaflet,
    Control: {
      extend: vi.fn(() => vi.fn()),
    },
    control: {},
    DomUtil: {
      create: vi.fn(() => document.createElement("div")),
    },
    DomEvent: {
      addListener: vi.fn(),
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
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

  const createMapInstance = () => {
    const container = document.createElement("div");
    let containerRect = {
      left: 0,
      top: 0,
      right: 360,
      bottom: 640,
      width: 360,
      height: 640,
    };
    let currentCenter = { lat: 52.2, lng: 6.85 };
    let currentZoom = 15;
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => containerRect,
    });
    container.__setRect = (nextRect) => {
      containerRect = nextRect;
    };

    const normalizeLatLng = (value) => {
      if (Array.isArray(value)) {
        return {
          lat: value[0],
          lng: value[1],
        };
      }

      return value;
    };

    const getSize = () => ({
      x: containerRect.width,
      y: containerRect.height,
    });

    return {
      fitBounds: vi.fn(),
      getBounds: () => ({
        _southWest: { lat: 52.1, lng: 6.8 },
        _northEast: { lat: 52.3, lng: 6.9 },
      }),
      eachLayer: vi.fn(),
      on: vi.fn((event, handler) => {
        container.__handlers = container.__handlers ?? {};
        container.__handlers[event] = handler;
      }),
      off: vi.fn((event) => {
        if (container.__handlers) {
          delete container.__handlers[event];
        }
      }),
      locate: vi.fn(),
      invalidateSize: vi.fn(),
      setView: vi.fn((nextCenter, nextZoom = currentZoom) => {
        currentCenter = normalizeLatLng(nextCenter);
        currentZoom = nextZoom;
      }),
      panTo: vi.fn((nextCenter) => {
        currentCenter = normalizeLatLng(nextCenter);
      }),
      getCenter: vi.fn(() => currentCenter),
      getZoom: vi.fn(() => currentZoom),
      getContainer: vi.fn(() => container),
      getSize: vi.fn(() => getSize()),
      distance: vi.fn((a, b) => {
        const dx = (b.lng - a.lng) * 111000;
        const dy = (b.lat - a.lat) * 111000;
        return Math.sqrt(dx * dx + dy * dy);
      }),
      latLngToContainerPoint: ({ lat, lng }) => {
        const size = getSize();
        return {
          x: Math.round((lng - currentCenter.lng) * 1000 + size.x / 2),
          y: Math.round((currentCenter.lat - lat) * 1000 + size.y / 2),
        };
      },
      containerPointToLatLng: ({ x, y }) => {
        const size = getSize();
        return {
          lat: currentCenter.lat - (y - size.y / 2) / 1000,
          lng: currentCenter.lng + (x - size.x / 2) / 1000,
        };
      },
    };
  };

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
        data-testid={`marker-${Array.isArray(position) ? position.join("-") : `${position?.lat}-${position?.lng}`}`}
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
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
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


test("renders an agent page and fetches banners by author", async () => {
  global.fetch.mockImplementation((url) => {
    if (
      url.includes("/bnrs?") &&
      url.includes("author=Indicatrix") &&
      url.includes("orderBy=created")
    ) {
      return jsonResponse([
        {
          id: "agent-banner",
          title: "Agent Banner",
          picture: "/images/agent.jpg",
          numberOfMissions: 6,
          lengthMeters: 2400,
          formattedAddress: "Oulu, Finland",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <Routes>
      <Route path="/agent/:agentName" element={<Home />} />
    </Routes>,
    { route: "/agent/Indicatrix" }
  );

  expect(await screen.findByText("Indicatrix")).toBeInTheDocument();
  expect(await screen.findByText("Banners created by Indicatrix.")).toBeInTheDocument();
  expect(await screen.findByText("Agent Banner")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("author=Indicatrix"),
    expect.objectContaining({
      headers: expect.any(Headers),
    })
  );
});


test("browse results respect the minimum mission filter", async () => {
  global.fetch.mockImplementation((url) => {
    if (
      url.includes("/bnrs?") &&
      url.includes("author=MissionFilterAgent") &&
      url.includes("orderBy=created")
    ) {
      return jsonResponse([
        {
          id: "small-banner",
          title: "Small Banner",
          picture: "/images/small.jpg",
          numberOfMissions: 6,
          lengthMeters: 1200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
        {
          id: "big-banner",
          title: "Big Banner",
          picture: "/images/big.jpg",
          numberOfMissions: 18,
          lengthMeters: 4200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <BrowsingPage
      authorName="MissionFilterAgent"
      bannerFilters={{
        ...DEFAULT_BANNER_FILTERS,
        minimumMissions: 12,
      }}
      onBannerFiltersChange={vi.fn()}
    />
  );

  expect(await screen.findByText("Big Banner")).toBeInTheDocument();
  expect(screen.queryByText("Small Banner")).not.toBeInTheDocument();
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
});


test("browse results respect a custom mission range filter", async () => {
  global.fetch.mockImplementation((url) => {
    if (
      url.includes("/bnrs?") &&
      url.includes("author=MissionRangeAgent") &&
      url.includes("orderBy=created")
    ) {
      return jsonResponse([
        {
          id: "range-small-banner",
          title: "Range Small Banner",
          picture: "/images/range-small.jpg",
          numberOfMissions: 6,
          lengthMeters: 1200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
        {
          id: "range-middle-banner",
          title: "Range Middle Banner",
          picture: "/images/range-middle.jpg",
          numberOfMissions: 12,
          lengthMeters: 2400,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
        {
          id: "range-large-banner",
          title: "Range Large Banner",
          picture: "/images/range-large.jpg",
          numberOfMissions: 18,
          lengthMeters: 3600,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  renderWithProviders(
    <BrowsingPage
      authorName="MissionRangeAgent"
      bannerFilters={{
        ...DEFAULT_BANNER_FILTERS,
        missionCountFilterMode: "custom",
        customMinimumMissions: "7",
        customMaximumMissions: "12",
      }}
      onBannerFiltersChange={vi.fn()}
    />
  );

  expect(await screen.findByText("Range Middle Banner")).toBeInTheDocument();
  expect(screen.queryByText("Range Small Banner")).not.toBeInTheDocument();
  expect(screen.queryByText("Range Large Banner")).not.toBeInTheDocument();
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
});


test("browse mission filtering backfills extra pages before scroll gets sparse", async () => {
  const buildMostlyFilteredPage = (pageNumber, visibleBanner) => [
    ...Array.from({ length: 8 }, (_, itemIndex) => ({
      id: `backfill-small-${pageNumber}-${itemIndex + 1}`,
      title: `Backfill Small ${pageNumber}-${itemIndex + 1}`,
      picture: `/images/backfill-small-${pageNumber}-${itemIndex + 1}.jpg`,
      numberOfMissions: 6,
      lengthMeters: 1200 + itemIndex * 50,
      formattedAddress: "Enschede, NL",
      numberOfDisabledMissions: 0,
    })),
    visibleBanner,
  ];

  global.fetch.mockImplementation((url) => {
    if (
      url.includes("/bnrs?") &&
      url.includes("author=BackfillAgent") &&
      url.includes("offset=0")
    ) {
      return jsonResponse(
        buildMostlyFilteredPage(1, {
          id: "backfill-big-1",
          title: "Backfill Big 1",
          picture: "/images/backfill-big-1.jpg",
          numberOfMissions: 12,
          lengthMeters: 2200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        })
      );
    }

    if (
      url.includes("/bnrs?") &&
      url.includes("author=BackfillAgent") &&
      url.includes("offset=9")
    ) {
      return jsonResponse(
        buildMostlyFilteredPage(2, {
          id: "backfill-big-2",
          title: "Backfill Big 2",
          picture: "/images/backfill-big-2.jpg",
          numberOfMissions: 18,
          lengthMeters: 3200,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        })
      );
    }

    if (
      url.includes("/bnrs?") &&
      url.includes("author=BackfillAgent") &&
      url.includes("offset=18")
    ) {
      return jsonResponse([
        {
          id: "backfill-big-3",
          title: "Backfill Big 3",
          picture: "/images/backfill-big-3.jpg",
          numberOfMissions: 18,
          lengthMeters: 3600,
          formattedAddress: "Enschede, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error("Unhandled fetch: " + url);
  });

  renderWithProviders(
    <BrowsingPage
      authorName="BackfillAgent"
      bannerFilters={{
        ...DEFAULT_BANNER_FILTERS,
        minimumMissions: 12,
      }}
      onBannerFiltersChange={vi.fn()}
    />
  );

  expect(await screen.findByText("Backfill Big 3")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(3);
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


test("banner filter button exposes browse mission count thresholds and a custom range", async () => {
  function FilterHarness() {
    const [filters, setFilters] = React.useState(DEFAULT_BANNER_FILTERS);

    return (
      <BannerFilterButton
        filters={filters}
        onChange={setFilters}
        showMinimumMissionsFilter
      />
    );
  }

  const user = userEvent.setup();

  renderWithProviders(<FilterHarness />);

  await user.click(screen.getByRole("button", { name: /^filters$/i }));
  await user.click(screen.getByRole("button", { name: "Custom" }));

  expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await user.type(screen.getByLabelText("Minimum"), "7");
  await user.type(screen.getByLabelText("Maximum"), "12");

  expect(screen.getByText("Filters (1)", { selector: "button" })).toBeInTheDocument();
  expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  expect(screen.getByDisplayValue("12")).toBeInTheDocument();
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

test("polls the BannerGuider user location every 5 seconds and recenters after repeated identical fixes", async () => {
  const intervalCallbacks = [];
  const setIntervalSpy = vi
    .spyOn(window, "setInterval")
    .mockImplementation((callback, delay) => {
      intervalCallbacks.push({ callback, delay });
      return 1;
    });

  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/recenter-banner")) {
      return jsonResponse({
        id: "recenter-banner",
        title: "Recenter Banner",
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

  try {
    renderWithProviders(
      <Routes>
        <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
      </Routes>,
      { route: "/bannerguider/recenter-banner" }
    );

    await screen.findByTestId("map-container");

    expect(geolocation.getCurrentPosition).toHaveBeenCalled();
    expect(geoSuccessCallbacks.length).toBeGreaterThanOrEqual(1);
    expect(intervalCallbacks.length).toBeGreaterThanOrEqual(1);
    expect(intervalCallbacks.at(-1)?.delay).toBe(5000);

    const { useMap } = await import("react-leaflet");
    const map = useMap();
    const activeIntervalCallback = intervalCallbacks.at(-1)?.callback;

    await act(async () => {
      geoSuccessCallbacks.at(-1)({
        coords: {
          latitude: 52.37,
          longitude: 4.89,
          accuracy: 10,
          heading: null,
          speed: 0,
        },
      });
    });

    expect(map.invalidateSize).toHaveBeenCalledWith(false);
    expect(map.invalidateSize.mock.invocationCallOrder.at(-1)).toBeLessThan(
      map.setView.mock.invocationCallOrder.at(-1)
    );
    const initialCenter = map.setView.mock.calls.at(-1)?.[0];
    expect(initialCenter?.lat).toBeCloseTo(52.37, 5);
    expect(initialCenter?.lng).toBeCloseTo(4.89, 5);
    expect(map.setView.mock.calls.at(-1)?.[1]).toEqual(expect.any(Number));

    const initialPollCount = geolocation.getCurrentPosition.mock.calls.length;

    await act(async () => {
      activeIntervalCallback?.();
    });

    expect(geolocation.getCurrentPosition.mock.calls.length).toBe(
      initialPollCount + 1
    );
    expect(geoSuccessCallbacks.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      geoSuccessCallbacks.at(-1)({
        coords: {
          latitude: 52.37,
          longitude: 4.89,
          accuracy: 10,
          heading: null,
          speed: 0,
        },
      });
    });

    expect(map.invalidateSize).toHaveBeenCalledTimes(2);
    expect(map.invalidateSize.mock.invocationCallOrder.at(-1)).toBeLessThan(
      map.panTo.mock.invocationCallOrder.at(-1)
    );
    const repeatedCenter = map.panTo.mock.calls.at(-1)?.[0];
    expect(repeatedCenter?.lat).toBeCloseTo(52.37, 5);
    expect(repeatedCenter?.lng).toBeCloseTo(4.89, 5);
    expect(map.panTo.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        animate: true,
        duration: 0.35,
      })
    );
  } finally {
    setIntervalSpy.mockRestore();
  }
});

test("does not snap the BannerGuider back on the next stationary poll after a manual pan", async () => {
  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/manual-pan-banner")) {
      return jsonResponse({
        id: "manual-pan-banner",
        title: "Manual Pan Banner",
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
      <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
    </Routes>,
    { route: "/bannerguider/manual-pan-banner" }
  );

  await screen.findByTestId("map-container");

  const { useMap } = await import("react-leaflet");
  const map = useMap();
  const container = map.getContainer();

  expect(geoSuccessCallbacks.length).toBeGreaterThanOrEqual(1);

  await act(async () => {
    geoSuccessCallbacks.at(-1)({
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 10,
        heading: null,
        speed: 0,
      },
    });
  });

  expect(map.setView).toHaveBeenCalledTimes(1);

  container.__handlers.dragstart?.();

  await act(async () => {
    geoSuccessCallbacks.at(-1)({
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 10,
        heading: null,
        speed: 0,
      },
    });
  });

  expect(map.panTo).not.toHaveBeenCalled();
});

test("keeps the BannerGuider user marker visible in the safe area on small screens", async () => {
  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
    watchPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
      return 1;
    }),
    clearWatch: vi.fn(),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/safe-area-banner")) {
      return jsonResponse({
        id: "safe-area-banner",
        title: "Safe Area Banner",
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
      <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
    </Routes>,
    { route: "/bannerguider/safe-area-banner" }
  );

  await screen.findByTestId("map-container");

  const overlay = document.querySelector('[data-map-overlay="mission-controls"]');
  expect(overlay).toBeTruthy();
  Object.defineProperty(overlay, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 10, right: 150, bottom: 110, width: 140, height: 100 }),
  });

  expect(geoSuccessCallbacks.length).toBeGreaterThanOrEqual(1);

  await act(async () => {
    geoSuccessCallbacks[0]({
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 10,
        heading: null,
        speed: 0,
      },
    });
  });

  await act(async () => {
    geoSuccessCallbacks.at(-1)({
      coords: {
        latitude: 52.3702,
        longitude: 4.8902,
        accuracy: 8,
        heading: null,
        speed: 1,
      },
    });
  });

  const { useMap } = await import("react-leaflet");
  const map = useMap();
  expect(map.panTo).toHaveBeenCalled();
  const target = map.panTo.mock.calls.at(-1)?.[0];
  const point = map.latLngToContainerPoint(target);

  expect(point.x).toBeGreaterThan(150);
  expect(point.x).toBeLessThan(360);
  expect(point.y).toBeGreaterThan(110);
  expect(point.y).toBeLessThan(640);
});


test("keeps the BannerGuider centered within the visible viewport when the map container is wider than the window", async () => {
  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 220,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 520,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/split-screen-banner")) {
      return jsonResponse({
        id: "split-screen-banner",
        title: "Split Screen Banner",
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

  try {
    renderWithProviders(
      <Routes>
        <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
      </Routes>,
      { route: "/bannerguider/split-screen-banner" }
    );

    await screen.findByTestId("map-container");

    const overlay = document.querySelector('[data-map-overlay="mission-controls"]');
    expect(overlay).toBeTruthy();
    Object.defineProperty(overlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 10, top: 10, right: 130, bottom: 92, width: 120, height: 82 }),
    });

    const { useMap } = await import("react-leaflet");
    const map = useMap();
    const container = map.getContainer();
    container.__setRect({
      left: 0,
      top: 0,
      right: 360,
      bottom: 520,
      width: 360,
      height: 520,
    });
    map.getSize.mockReturnValue({ x: 360, y: 520 });

    await act(async () => {
      geoSuccessCallbacks[0]({
        coords: {
          latitude: 52.37,
          longitude: 4.89,
          accuracy: 10,
          heading: null,
          speed: 0,
        },
      });
    });

    await act(async () => {
      geoSuccessCallbacks.at(-1)({
        coords: {
          latitude: 52.3702,
          longitude: 4.8902,
          accuracy: 8,
          heading: null,
          speed: 1,
        },
      });
    });

    const target = map.panTo.mock.calls.at(-1)?.[0];
    const point = map.latLngToContainerPoint(target);

    expect(point.x).toBeGreaterThan(130);
    expect(point.x).toBeLessThan(220);
    expect(point.y).toBeGreaterThan(92);
    expect(point.y).toBeLessThan(520);
  } finally {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  }
});

test.skip("stops moving the map after the user manually zooms or pans", async () => {
  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
    watchPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
      return 1;
    }),
    clearWatch: vi.fn(),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/manual-interaction-banner")) {
      return jsonResponse({
        id: "manual-interaction-banner",
        title: "Manual Interaction Banner",
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
      <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
    </Routes>,
    { route: "/bannerguider/manual-interaction-banner" }
  );

  await screen.findByTestId("map-container");

  const { useMap } = await import("react-leaflet");
  const map = useMap();
  const container = map.getContainer();
  map.getCenter.mockImplementation(() => ({ lat: 52.25, lng: 6.8 }));

  await act(async () => {
    geoSuccessCallbacks[0]({
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 10,
        heading: null,
        speed: 0,
      },
    });
  });

  await act(async () => {
    container.__handlers.zoomend?.();
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  await act(async () => {
    geoSuccessCallbacks.at(-1)({
      coords: {
        latitude: 52.37018,
        longitude: 4.88995,
        accuracy: 8,
        heading: null,
        speed: 1,
      },
    });
  });

  expect(map.panTo).not.toHaveBeenCalled();
});

test.skip("repositions the BannerGuider center after resize and zoom so the user marker stays visible", async () => {
  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
    watchPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
      return 1;
    }),
    clearWatch: vi.fn(),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/responsive-safe-area-banner")) {
      return jsonResponse({
        id: "responsive-safe-area-banner",
        title: "Responsive Safe Area Banner",
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
      <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
    </Routes>,
    { route: "/bannerguider/responsive-safe-area-banner" }
  );

  await screen.findByTestId("map-container");

  const overlay = document.querySelector('[data-map-overlay="mission-controls"]');
  expect(overlay).toBeTruthy();

  const { useMap } = await import("react-leaflet");
  const map = useMap();
  const container = map.getContainer();

  Object.defineProperty(overlay, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 10, right: 150, bottom: 110, width: 140, height: 100 }),
    configurable: true,
  });

  await act(async () => {
    geoSuccessCallbacks[0]({
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 10,
        heading: null,
        speed: 0,
      },
    });
  });

  container.__setRect({
    left: 0,
    top: 0,
    right: 280,
    bottom: 520,
    width: 280,
    height: 520,
  });
  map.getSize.mockReturnValue({ x: 280, y: 520 });
  Object.defineProperty(overlay, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 10, right: 130, bottom: 100, width: 120, height: 90 }),
    configurable: true,
  });

  await act(async () => {
    container.__handlers.resize?.();
    container.__handlers.zoomend?.();
  });

  const resizedTarget = map.setView.mock.calls.at(-1)?.[0];
  const resizedPoint = map.latLngToContainerPoint(resizedTarget);

  expect(resizedPoint.x).toBeGreaterThan(130);
  expect(resizedPoint.x).toBeLessThan(280);
  expect(resizedPoint.y).toBeGreaterThan(100);
  expect(resizedPoint.y).toBeLessThan(520);
});

test.skip("keeps the BannerGuider user marker above the bottom reserved area on very short screens", async () => {
  const geoSuccessCallbacks = [];
  const geolocation = {
    getCurrentPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
    }),
    watchPosition: vi.fn((success) => {
      geoSuccessCallbacks.push(success);
      return 1;
    }),
    clearWatch: vi.fn(),
  };

  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });

  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/short-safe-area-banner")) {
      return jsonResponse({
        id: "short-safe-area-banner",
        title: "Short Safe Area Banner",
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
      <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
    </Routes>,
    { route: "/bannerguider/short-safe-area-banner" }
  );

  await screen.findByTestId("map-container");

  const overlay = document.querySelector('[data-map-overlay="mission-controls"]');
  expect(overlay).toBeTruthy();
  Object.defineProperty(overlay, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 10, right: 130, bottom: 92, width: 120, height: 82 }),
    configurable: true,
  });

  const { useMap } = await import("react-leaflet");
  const map = useMap();
  const container = map.getContainer();
  container.__setRect({
    left: 0,
    top: 0,
    right: 320,
    bottom: 180,
    width: 320,
    height: 180,
  });
  map.getSize.mockReturnValue({ x: 320, y: 180 });

  await act(async () => {
    geoSuccessCallbacks[0]({
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 10,
        heading: null,
        speed: 0,
      },
    });
  });

  await act(async () => {
    geoSuccessCallbacks.at(-1)({
      coords: {
        latitude: 52.3702,
        longitude: 4.8902,
        accuracy: 8,
        heading: null,
        speed: 1,
      },
    });
  });

  const target = map.panTo.mock.calls.at(-1)?.[0];
  const point = map.latLngToContainerPoint(target);

  expect(point.x).toBeGreaterThan(130);
  expect(point.x).toBeLessThan(320);
  expect(point.y).toBeLessThan(92);
  expect(point.y).toBeGreaterThan(40);
});

test("renders mission waypoint dots on the banner details overview map", async () => {
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
  expect(screen.getByTestId("marker-52.371-4.891")).toBeInTheDocument();
  expect(screen.getByTestId("marker-52.381-4.901")).toBeInTheDocument();
  expect(screen.getAllByText("Navigate to portal").length).toBeGreaterThan(0);
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


test("shows unique mission authors on the banner details page when the api returns them", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/authored-banner")) {
      return jsonResponse({
        id: "authored-banner",
        title: "Authored Banner",
        picture: "/images/detail.jpg",
        numberOfMissions: 3,
        lengthMeters: 1800,
        formattedAddress: "Oulu, Finland",
        missions: {
          "mission-1": {
            id: "mission-1",
            author: {
              name: "Indicatrix",
              faction: "resistance",
            },
            steps: {
              0: {
                poi: {
                  title: "Portal One",
                  type: "portal",
                  latitude: 65.01,
                  longitude: 25.47,
                },
              },
            },
          },
          "mission-2": {
            id: "mission-2",
            author: {
              name: "Indicatrix",
              faction: "resistance",
            },
            steps: {
              0: {
                poi: {
                  title: "Portal Two",
                  type: "portal",
                  latitude: 65.011,
                  longitude: 25.471,
                },
              },
            },
          },
          "mission-3": {
            id: "mission-3",
            author: {
              name: "SecondAgent",
              faction: "enlightened",
            },
            steps: {
              0: {
                poi: {
                  title: "Portal Three",
                  type: "portal",
                  latitude: 65.012,
                  longitude: 25.472,
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
    { route: "/banner/authored-banner" }
  );

  expect(await screen.findByText("Authored Banner")).toBeInTheDocument();
  expect(screen.getByText("Authors")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Indicatrix" })).toHaveAttribute(
    "href",
    "/agent/Indicatrix"
  );
  expect(screen.getByRole("link", { name: "SecondAgent" })).toHaveAttribute(
    "href",
    "/agent/SecondAgent"
  );
});

test("renders the guider with waypoint dots before a mission is selected", async () => {
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
  expect(screen.getByTestId("marker-52.371-4.891")).toBeInTheDocument();
  expect(screen.getByTestId("marker-52.381-4.901")).toBeInTheDocument();
  expect(screen.getAllByText("Navigate to portal").length).toBeGreaterThan(0);
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

test("home map view keeps discovery filters in the map panel instead of duplicating them in the top bar", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/bnrs?orderBy=proximityStartPoint")) {
      return jsonResponse([
        {
          id: "map-home-banner",
          title: "Map Home Banner",
          picture: "/images/map-home.jpg",
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

  renderWithProviders(
    <Routes>
      <Route path="*" element={<Home />} />
    </Routes>,
    { route: "/map" }
  );

  await screen.findByRole("link", { name: /open banner/i });

  expect(screen.getAllByRole("button", { name: /^filters$/i })).toHaveLength(1);
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

test("updates banner metadata tags when banner details load", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.endsWith("/bnrs/meta-banner")) {
      return jsonResponse({
        id: "meta-banner",
        title: "Meta Banner",
        picture: "/images/meta.jpg",
        numberOfMissions: 6,
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
    { route: "/banner/meta-banner" }
  );

  expect(await screen.findByText("Meta Banner")).toBeInTheDocument();

  await waitFor(() => {
    expect(document.title).toBe("Meta Banner");
    expect(
      document.head.querySelector('meta[property="og:title"]')
    ).toHaveAttribute("content", "Meta Banner");
    expect(
      document.head.querySelector('meta[property="og:description"]')
    ).toHaveAttribute("content", "6 Missions, 2.1 km, Amsterdam, NL");
    expect(
      document.head.querySelector('meta[property="og:image"]')
    ).toHaveAttribute("content", "https://api.bannergress.com/images/meta.jpg");
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "http://localhost:3000/banner/meta-banner"
    );
  });
});
