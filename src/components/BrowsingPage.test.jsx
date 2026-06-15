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

test("restores browse sort, loaded banners, and scroll after remount", async () => {
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
  await user.click(screen.getByRole("button", { name: /^a-z$/i }));
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
  await waitFor(() => {
    expect(window.scrollTo).toHaveBeenCalledWith(0, 420);
  });
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

    if (url.includes("/bnrs?orderBy=relevance")) {
      return jsonResponse([]);
    }

    if (url.includes("/places?used=true&type=country")) {
      return jsonResponse([]);
    }

    if (url.includes("/bnrs?limit=9&offset=0&orderBy=created")) {
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

  expect(await screen.findByText("Search: reset")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^browse$/i }));

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

    if (url.includes("/bnrs?orderBy=relevance")) {
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
