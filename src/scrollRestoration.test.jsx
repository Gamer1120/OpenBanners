import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { Link, MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BrowsingPage from "./components/BrowsingPage";
import ListsPage from "./components/ListsPage";
import SearchResults from "./components/SearchResults";
import { BANNERGRESS_AUTH_STORAGE_KEY } from "./bannergressSync";
import { ScrollManager } from "./scrollRestoration";

const theme = createTheme();
const TILE_HEIGHT = 100;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

function json(data) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

function makeBanners(from, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `b${from + index}`,
    title: `Banner ${from + index}`,
    picture: `/images/b${from + index}.jpg`,
    numberOfMissions: 6,
    lengthMeters: 2400,
    formattedAddress: "Enschede, NL",
    numberOfDisabledMissions: 0,
  }));
}

function bannerFetches() {
  return global.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/bnrs?"));
}

function BrowseRoute() {
  const { placeId } = useParams();
  return <BrowsingPage placeId={placeId} />;
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      test-back
    </button>
  );
}

function renderApp(route) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[route]}>
        <ScrollManager />
        <BackButton />
        <Routes>
          <Route path="/browse/:placeId" element={<BrowseRoute />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/search/:query" element={<SearchResults />} />
          <Route
            path="/banner/:bannerId"
            element={
              <div>
                <p>Banner page</p>
                <Link to="/browse/test-place">Fresh browse</Link>
              </div>
            }
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

function scrollWindowTo(y) {
  act(() => {
    window.scrollTo(0, y);
    fireEvent.scroll(window);
  });
}

function openBanner(title) {
  fireEvent.click(screen.getAllByRole("link", { name: new RegExp(title) })[0]);
}

beforeEach(() => {
  let scrollY = 0;

  window.localStorage.clear();
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "pageYOffset", { configurable: true, get: () => scrollY });
  window.scrollTo = vi.fn((_, nextScrollY) => {
    scrollY = Math.max(0, nextScrollY);
  });
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  // Tile n sits at n * TILE_HEIGHT on the page.
  Element.prototype.getBoundingClientRect = function getRect() {
    const match = this.getAttribute?.("href")?.match(/^\/banner\/b(\d+)$/);
    const top = (match ? Number(match[1]) * TILE_HEIGHT : 0) - scrollY;
    return { top, bottom: top + TILE_HEIGHT, left: 0, right: 400, width: 400, height: TILE_HEIGHT, x: 0, y: top };
  };
  global.fetch = vi.fn((input) => {
    const url = String(input);

    if (url.includes("/bnrs?") && url.includes("placeId=test-place")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json(offset === 0 ? makeBanners(0, 24) : offset === 24 ? makeBanners(24, 10) : []);
    }

    if (url.includes("/bnrs?") && url.includes("listTypes=done")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json(offset === 0 ? makeBanners(100, 24) : offset === 24 ? makeBanners(124, 6) : []);
    }

    if (url.includes("/bnrs?") && url.includes("query=")) {
      return json(makeBanners(200, 40));
    }

    if (url.includes("/places/test-place")) {
      return json({ id: "test-place", formattedAddress: "Test Place", numberOfBanners: 34 });
    }

    return json([]);
  });
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  vi.restoreAllMocks();
});

test("Back to Browse restores the loaded pages and the scroll position without refetching", async () => {
  renderApp("/browse/test-place");

  // Infinite scroll loaded the second page too.
  expect(await screen.findByText("Banner 30")).toBeInTheDocument();
  scrollWindowTo(3000);

  openBanner("Banner 30");
  expect(await screen.findByText("Banner page")).toBeInTheDocument();
  expect(window.scrollY).toBe(0);

  // Only the in-memory copy for this history entry may bring the list back.
  window.localStorage.clear();
  global.fetch.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "test-back" }));

  expect(screen.getByText("Banner 0")).toBeInTheDocument();
  expect(screen.getByText("Banner 33")).toBeInTheDocument();
  await waitFor(() => expect(window.scrollY).toBe(3000));
  expect(bannerFetches()).toEqual([]);
});

test("Back lands on the opened tile even when the layout moved", async () => {
  renderApp("/browse/test-place");

  expect(await screen.findByText("Banner 30")).toBeInTheDocument();
  scrollWindowTo(2950);
  openBanner("Banner 30");
  expect(await screen.findByText("Banner page")).toBeInTheDocument();

  // Tiles come back 20 px lower (e.g. a taller header).
  const shiftedRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getShiftedRect() {
    const rect = shiftedRect.call(this);
    return this.getAttribute?.("href")?.startsWith("/banner/") ? { ...rect, top: rect.top + 20 } : rect;
  };
  fireEvent.click(screen.getByRole("button", { name: "test-back" }));

  await waitFor(() => expect(window.scrollY).toBe(2970));
});

test("a fresh visit (PUSH) starts at the top", async () => {
  renderApp("/browse/test-place");

  expect(await screen.findByText("Banner 30")).toBeInTheDocument();
  scrollWindowTo(3000);
  openBanner("Banner 30");
  expect(await screen.findByText("Banner page")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("link", { name: "Fresh browse" }));

  expect(await screen.findByText("Banner 0")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(window.scrollY).toBe(0);
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
});

test("Back to Lists keeps the tab, the loaded pages and the scroll position", async () => {
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
  renderApp("/lists");

  fireEvent.click(await screen.findByRole("button", { name: /^done$/i }));
  expect(await screen.findByText("Banner 128")).toBeInTheDocument();
  scrollWindowTo(2800);
  openBanner("Banner 128");
  expect(await screen.findByText("Banner page")).toBeInTheDocument();

  global.fetch.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "test-back" }));

  expect(screen.getByRole("button", { name: /^done$/i })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Banner 100")).toBeInTheDocument();
  expect(screen.getByText("Banner 129")).toBeInTheDocument();
  await waitFor(() => expect(window.scrollY).toBe(2800));
  expect(bannerFetches()).toEqual([]);
});

test("Back to search results shows them again without a new search", async () => {
  renderApp("/search/enschede");

  expect(await screen.findByText("Banner 235")).toBeInTheDocument();
  scrollWindowTo(3500);
  openBanner("Banner 235");
  expect(await screen.findByText("Banner page")).toBeInTheDocument();

  global.fetch.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "test-back" }));

  expect(screen.getByText("Banner 235")).toBeInTheDocument();
  await waitFor(() => expect(window.scrollY).toBe(3500));
  expect(global.fetch).not.toHaveBeenCalled();
});
