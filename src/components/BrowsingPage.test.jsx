import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import BrowsingPage from "./BrowsingPage";
import Home from "./Home";
import SearchResults from "./SearchResults";
import { DEFAULT_BANNER_FILTERS } from "../bannerFilters";
import {
  getBrowseStateScope,
  readBrowseState,
  saveBrowseState,
} from "../browseState";
import { clearHistoryEntryState } from "../scrollRestoration";
import {
  createMemoryEfficiencyCacheBackend,
  setEfficiencyCacheBackend,
} from "../efficiencyCache";

let efficiencyCache;

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

function renderWithProviders(ui, { route = "/browse/restored-place" } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </ThemeProvider>
  );
}

function getBannerFetchCalls() {
  return global.fetch.mock.calls.filter(([url]) => url.includes("/bnrs?"));
}

beforeEach(() => {
  let scrollY = 0;

  global.fetch = vi.fn();
  window.localStorage.clear();
  efficiencyCache = createMemoryEfficiencyCacheBackend();
  setEfficiencyCacheBackend(efficiencyCache);
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => scrollY,
  });
  Object.defineProperty(window, "pageYOffset", {
    configurable: true,
    get: () => scrollY,
  });
  window.scrollTo = vi.fn((_, nextScrollY) => {
    scrollY = nextScrollY;
  });
  window.requestAnimationFrame = vi.fn((callback) =>
    window.setTimeout(callback, 0)
  );
  window.cancelAnimationFrame = vi.fn((id) => window.clearTimeout(id));
  global.IntersectionObserver = class MockIntersectionObserver {
    observe() {}

    disconnect() {}
  };
});

test("restores browse sort and loaded banners after remount", async () => {
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/restored-place")) {
      return jsonResponse({
        id: "restored-place",
        formattedAddress: "Restored Place",
        numberOfBanners: 2,
      });
    }

    if (url.includes("/places?used=true&parentPlaceId=restored-place")) {
      return jsonResponse([]);
    }

    if (
      url.includes("/bnrs?") &&
      url.includes("placeId=restored-place") &&
      url.includes("orderBy=created")
    ) {
      return jsonResponse([
        {
          id: "initial-browse-banner",
          title: "Initial Browse Banner",
          picture: "/images/initial-browse.jpg",
          numberOfMissions: 6,
          lengthMeters: 2400,
          formattedAddress: "Utrecht, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    if (
      url.includes("/bnrs?") &&
      url.includes("placeId=restored-place") &&
      url.includes("orderBy=title") &&
      url.includes("orderDirection=DESC")
    ) {
      return jsonResponse([
        {
          id: "sorted-browse-banner",
          title: "Sorted Browse Banner",
          picture: "/images/sorted-browse.jpg",
          numberOfMissions: 12,
          lengthMeters: 3600,
          formattedAddress: "Leiden, NL",
          numberOfDisabledMissions: 0,
        },
      ]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const user = userEvent.setup();
  const firstRender = renderWithProviders(
    <BrowsingPage placeId="restored-place" />
  );

  expect(await screen.findByText("Initial Browse Banner")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /together/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^sort:/i }));
  await user.click(screen.getByRole("menuitem", { name: /^a-z$/i }));
  expect(await screen.findByText("Sorted Browse Banner")).toBeInTheDocument();
  expect(screen.queryByText("Initial Browse Banner")).not.toBeInTheDocument();
  expect(getBannerFetchCalls()).toHaveLength(2);

  window.scrollTo(0, 420);
  await user.click(screen.getByRole("link", { name: /sorted browse banner/i }));
  window.scrollTo(0, 0);
  firstRender.unmount();
  global.fetch.mockClear();
  window.scrollTo.mockClear();

  renderWithProviders(<BrowsingPage placeId="restored-place" />);

  expect(await screen.findByText("Sorted Browse Banner")).toBeInTheDocument();
  expect(getBannerFetchCalls()).toHaveLength(0);
});

test("top browse navigation resets saved root browse filters", async () => {
  const rootScope = getBrowseStateScope();

  saveBrowseState(rootScope, {
    filters: {
      ...DEFAULT_BANNER_FILTERS,
      minimumMissions: 12,
    },
    hasLoaded: true,
    banners: [
      {
        id: "stale-root-banner",
        title: "Stale Root Banner",
        numberOfMissions: 12,
        numberOfDisabledMissions: 0,
      },
    ],
  });

  global.fetch.mockImplementation((url) => {
    if (url.includes("/places?used=true&collapsePlaces=true")) {
      return jsonResponse([]);
    }

    if (url.includes("/bnrs?") && url.includes("orderBy=relevance")) {
      return jsonResponse([]);
    }

    if (url.includes("/places?used=true&type=country")) {
      return jsonResponse([]);
    }

    if (url.includes("/bnrs?limit=24&offset=0&orderBy=created")) {
      return jsonResponse([]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const user = userEvent.setup();

  renderWithProviders(
    <Routes>
      <Route path="/search/:query" element={<Home />} />
      <Route path="/browse/" element={<Home />} />
    </Routes>,
    { route: "/search/reset" }
  );

  expect(await screen.findByDisplayValue("reset")).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: /^banners$/i }));

  await waitFor(() => {
    expect(readBrowseState(rootScope).filters).toEqual(DEFAULT_BANNER_FILTERS);
  });
  expect(readBrowseState(rootScope).banners).toEqual([]);
});

test("search place links reset the target browse filters", async () => {
  const placeScope = getBrowseStateScope({ placeId: "search-place" });

  saveBrowseState(placeScope, {
    filters: {
      ...DEFAULT_BANNER_FILTERS,
      missionCountFilterMode: "custom",
      customMinimumMissions: "7",
      customMaximumMissions: "12",
    },
    hasLoaded: true,
    banners: [
      {
        id: "stale-place-banner",
        title: "Stale Place Banner",
        numberOfMissions: 12,
        numberOfDisabledMissions: 0,
      },
    ],
  });

  global.fetch.mockImplementation((url) => {
    if (url.includes("/places?used=true&collapsePlaces=true")) {
      return jsonResponse([
        {
          id: "search-place",
          shortName: "Search Place",
          type: "CITY",
          numberOfBanners: 4,
        },
      ]);
    }

    if (url.includes("/bnrs?") && url.includes("orderBy=relevance")) {
      return jsonResponse([]);
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const user = userEvent.setup();

  renderWithProviders(
    <Routes>
      <Route path="/search/:query" element={<SearchResults />} />
      <Route path="/browse/:placeId" element={<div>Browse target</div>} />
    </Routes>,
    { route: "/search/search-place" }
  );

  await user.click(
    await screen.findByRole("link", { name: /search place/i })
  );

  expect(readBrowseState(placeScope).filters).toEqual(DEFAULT_BANNER_FILTERS);
  expect(readBrowseState(placeScope).banners).toEqual([]);
});

test("Efficiency shows how many banners are fetched while it loads them all", async () => {
  const makeBanners = (offset, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `eff-${offset + index}`,
      title: `Efficiency Banner ${offset + index}`,
      picture: "/images/eff.jpg",
      numberOfMissions: 6 + ((offset + index) % 30),
      lengthMeters: 1000 + offset + index,
      formattedAddress: "Utrecht, NL",
      numberOfDisabledMissions: 0,
    }));
  const pending = {};
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/efficiency-place")) {
      return jsonResponse({ id: "efficiency-place", formattedAddress: "Efficiency Place", numberOfBanners: 612 });
    }

    if (url.includes("/places?used=true&parentPlaceId=efficiency-place")) {
      return jsonResponse([]);
    }

    if (url.includes("/bnrs?") && url.includes("orderBy=created")) {
      return jsonResponse(makeBanners(0, 1));
    }

    if (url.includes("/bnrs?") && url.includes("limit=100")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return new Promise((resolve) => {
        pending[offset] = () => resolve({ json: () => Promise.resolve(makeBanners(offset, offset < 500 ? 100 : offset === 500 ? 12 : 0)) });
      });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  const user = userEvent.setup();
  renderWithProviders(<BrowsingPage placeId="efficiency-place" />, { route: "/browse/efficiency-place" });

  expect(await screen.findByText("Efficiency Banner 0")).toBeInTheDocument();
  await screen.findByText(/612 banners/);
  await user.click(screen.getByRole("button", { name: /^sort:/i }));
  await user.click(screen.getByRole("menuitem", { name: /^efficiency$/i }));

  expect(await screen.findByText("Fetched 0 of up to 612 banners")).toHaveAttribute("role", "status");
  await waitFor(() => expect(pending[0]).toBeTypeOf("function"));
  pending[0]();
  expect(await screen.findByText("Fetched 100 of up to 612 banners")).toBeInTheDocument();
  await waitFor(() => expect(pending[100]).toBeTypeOf("function"));
  pending[100]();
  expect(await screen.findByText("Fetched 200 of up to 612 banners")).toBeInTheDocument();

  for (const offset of [200, 300, 400, 500, 600]) {
    await waitFor(() => expect(pending[offset]).toBeTypeOf("function"));
    pending[offset]();
  }

  expect(await screen.findByText("Efficiency Banner 29")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/^Fetched /)).not.toBeInTheDocument());
});

function mockEfficiencyPlace() {
  const makeBanners = (offset, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `cache-${offset + index}`,
      title: `Cache Banner ${offset + index}`,
      picture: "/images/eff.jpg",
      numberOfMissions: 6 + ((offset + index) % 30),
      lengthMeters: 1000 + offset + index,
      formattedAddress: "Utrecht, NL",
      numberOfDisabledMissions: 0,
    }));
  const pending = {};
  let holdPages = false;
  global.fetch.mockImplementation((url) => {
    if (url.includes("/places/cache-place")) {
      return jsonResponse({ id: "cache-place", formattedAddress: "Cache Place", numberOfBanners: 150 });
    }

    if (url.includes("/places?used=true&parentPlaceId=cache-place")) {
      return jsonResponse([]);
    }

    if (url.includes("/bnrs?") && url.includes("orderBy=created")) {
      return jsonResponse(makeBanners(0, 1));
    }

    if (url.includes("/bnrs?") && url.includes("limit=100")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const page = makeBanners(offset, offset === 0 ? 100 : offset === 100 ? 50 : 0);
      if (!holdPages) {
        return jsonResponse(page);
      }
      return new Promise((resolve) => {
        pending[offset] = () => resolve({ json: () => Promise.resolve(page) });
      });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  return {
    pending,
    holdPages: (value) => {
      holdPages = value;
    },
    efficiencyFetches: () =>
      global.fetch.mock.calls.filter(([url]) => url.includes("/bnrs?") && url.includes("limit=100")).length,
  };
}

async function chooseEfficiency(user) {
  await user.click(await screen.findByRole("button", { name: /^sort:/i }));
  await user.click(screen.getByRole("menuitem", { name: /^efficiency$/i }));
}

test("Efficiency keeps its banners for an hour and says when they come from the cache", async () => {
  const api = mockEfficiencyPlace();
  const user = userEvent.setup();
  const first = renderWithProviders(<BrowsingPage placeId="cache-place" />, { route: "/browse/cache-place" });

  expect(await screen.findByText("Cache Banner 0")).toBeInTheDocument();
  await chooseEfficiency(user);
  expect(await screen.findByText("Cache Banner 149")).toBeInTheDocument();
  // Fresh fetch: no note. offsets 0, 100, 200 (empty page ends it).
  expect(api.efficiencyFetches()).toBe(3);
  expect(screen.queryByText(/^Cached results/)).not.toBeInTheDocument();
  await waitFor(() => expect(efficiencyCache.entries.size).toBe(1));
  const [entry] = efficiencyCache.entries.values();
  expect(entry.banners).toHaveLength(150);

  // The other direction sorts the same set: no new requests.
  await user.click(screen.getByRole("button", { name: /^sort:/i }));
  await user.click(screen.getByRole("menuitem", { name: /^efficiency$/i }));
  expect(await screen.findByRole("button", { name: /fewest missions per km/i })).toBeInTheDocument();
  expect(api.efficiencyFetches()).toBe(3);

  // A reload (no in-memory history state): the list comes from the cache at
  // once, with its age.
  first.unmount();
  clearHistoryEntryState();
  entry.savedAt = Date.now() - 12 * 60 * 1000 - 5000;
  renderWithProviders(<BrowsingPage placeId="cache-place" />, { route: "/browse/cache-place" });
  expect(await screen.findByText("Cached results from 12 minutes ago")).toBeInTheDocument();
  expect(screen.getByText("Cache Banner 149")).toBeInTheDocument();
  expect(api.efficiencyFetches()).toBe(3);

  // Refresh drops the entry and fetches again, with the progress line.
  api.holdPages(true);
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText("Fetched 0 of up to 150 banners")).toBeInTheDocument();
  expect(screen.queryByText(/^Cached results/)).not.toBeInTheDocument();
  for (const offset of [0, 100, 200]) {
    await waitFor(() => expect(api.pending[offset]).toBeTypeOf("function"));
    api.pending[offset]();
  }
  await waitFor(() => expect(screen.queryByText(/^Fetched /)).not.toBeInTheDocument());
  expect(api.efficiencyFetches()).toBe(6);
  expect(screen.queryByText(/^Cached results/)).not.toBeInTheDocument();
  await waitFor(() => expect([...efficiencyCache.entries.values()][0].savedAt).toBeGreaterThan(Date.now() - 60 * 1000));
});

test("Efficiency fetches again once the cached banners are an hour old", async () => {
  const api = mockEfficiencyPlace();
  const user = userEvent.setup();
  const first = renderWithProviders(<BrowsingPage placeId="cache-place" />, { route: "/browse/cache-place" });

  await chooseEfficiency(user);
  expect(await screen.findByText("Cache Banner 149")).toBeInTheDocument();
  await waitFor(() => expect(efficiencyCache.entries.size).toBe(1));
  first.unmount();
  clearHistoryEntryState();

  [...efficiencyCache.entries.values()][0].savedAt = Date.now() - 61 * 60 * 1000;
  renderWithProviders(<BrowsingPage placeId="cache-place" />, { route: "/browse/cache-place" });
  expect(await screen.findByText("Cache Banner 149")).toBeInTheDocument();
  await waitFor(() => expect(api.efficiencyFetches()).toBe(6));
  expect(screen.queryByText(/^Cached results/)).not.toBeInTheDocument();
});
