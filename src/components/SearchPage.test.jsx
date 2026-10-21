import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SearchPage from "./SearchPage";
import SearchForm from "./SearchForm";
import { readRecentSearches } from "../recentSearches";

const theme = createTheme();

function json(data) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

function bannersFor(query, count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${query}-${index}`,
    title: `${query} banner ${index}`,
    picture: `/images/${query}-${index}.jpg`,
    numberOfMissions: 6,
    lengthMeters: 2400,
    formattedAddress: "Enschede, NL",
    numberOfDisabledMissions: 0,
  }));
}

function placesFor(query) {
  return [
    {
      id: `place-${query}`,
      shortName: `Place ${query}`,
      formattedAddress: `Place ${query}, NL`,
      type: "locality",
      numberOfBanners: 3,
    },
  ];
}

function queryOf(url) {
  return new URL(String(url)).searchParams.get("query");
}

// Mirrors what a data router exposes: the current location, how we got
// there (PUSH/REPLACE/POP) and navigate(-1) for Back.
function RouterProbe({ router }) {
  const location = useLocation();
  router.state = { location, historyAction: useNavigationType() };
  router.navigateRef = useNavigate();
  return null;
}

function renderSearch(route = "/search") {
  const router = { state: null, navigate: (to) => router.navigateRef(to) };

  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={["/start", route]} initialIndex={1}>
        <RouterProbe router={router} />
        <Routes>
          <Route path="/search/:query?" element={<SearchPage />} />
          <Route path="/banner/:bannerId" element={<p>Banner page</p>} />
          <Route path="/" element={<SearchForm placeholder="Top search" />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );

  return router;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  global.fetch = vi.fn((input) => {
    const url = String(input);
    const query = queryOf(url);

    if (url.includes("/places?")) {
      return json(placesFor(query));
    }

    if (url.includes("/bnrs?")) {
      return json(new URL(url).searchParams.get("offset") === "0" ? bannersFor(query) : []);
    }

    return json([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("typing updates the results page live, without a suggestions dropdown", async () => {
  const user = userEvent.setup();
  const router = renderSearch();
  const input = screen.getByRole("searchbox");

  expect(input).toHaveFocus();
  await user.type(input, "ensch");

  expect(await screen.findByText("ensch banner 0")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /place ensch/i })).toHaveAttribute(
    "href",
    "/browse/place-ensch"
  );
  expect(router.state.location.pathname).toBe("/search/ensch");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByText(/all results for/i)).not.toBeInTheDocument();
  // Debounced: no request per keystroke.
  const searched = global.fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/bnrs?"))
    .map(queryOf);
  expect(searched).toEqual(["ensch"]);

  await user.type(input, "ede");
  expect(await screen.findByText("enschede banner 0")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/search/enschede");
  expect(input).toHaveFocus();
  expect(input).toHaveValue("enschede");
});

test("typing replaces the history entry, so Back leaves search in one step", async () => {
  const user = userEvent.setup();
  const router = renderSearch();
  const input = screen.getByRole("searchbox");

  await user.type(input, "ens");
  await waitFor(() => expect(router.state.location.pathname).toBe("/search/ens"));
  expect(router.state.historyAction).toBe("REPLACE");
  await user.type(input, "ch");
  await waitFor(() => expect(router.state.location.pathname).toBe("/search/ensch"));
  expect(router.state.historyAction).toBe("REPLACE");

  await act(() => router.navigate(-1));
  expect(router.state.location.pathname).toBe("/start");
});

test("Back from a banner returns to the last query's results", async () => {
  const user = userEvent.setup();
  const router = renderSearch();

  await user.type(screen.getByRole("searchbox"), "ensch");
  await user.click(await screen.findByRole("link", { name: /ensch banner 1/i }));
  expect(await screen.findByText("Banner page")).toBeInTheDocument();
  expect(router.state.historyAction).toBe("PUSH");

  await act(() => router.navigate(-1));
  expect(router.state.location.pathname).toBe("/search/ensch");
  expect(screen.getByRole("searchbox")).toHaveValue("ensch");
  expect(await screen.findByText("ensch banner 1")).toBeInTheDocument();
});

test("older responses never overwrite newer results", async () => {
  const pending = [];
  global.fetch = vi.fn((input, init) => {
    const url = String(input);
    const query = queryOf(url);
    const data = url.includes("/places?")
      ? placesFor(query)
      : new URL(url).searchParams.get("offset") === "0"
        ? bannersFor(query)
        : [];

    // "en" answers last.
    if (query === "en") {
      return new Promise((resolve) => {
        pending.push({ resolve: () => resolve(json(data)), signal: init?.signal });
      });
    }

    return json(data);
  });

  const user = userEvent.setup();
  const router = renderSearch("/search/en");
  const input = screen.getByRole("searchbox");

  await user.clear(input);
  await user.type(input, "ens");
  expect(await screen.findByText("ens banner 0")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/search/ens");

  expect(pending.length).toBeGreaterThan(0);
  expect(pending.every(({ signal }) => signal?.aborted)).toBe(true);
  await act(async () => {
    pending.forEach(({ resolve }) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(screen.queryByText("en banner 0")).not.toBeInTheDocument();
  expect(screen.queryByText("Place en")).not.toBeInTheDocument();
  expect(screen.getByText("ens banner 0")).toBeInTheDocument();
});

test("the current results stay visible while the next query loads", async () => {
  const user = userEvent.setup();
  const router = renderSearch("/search/ens");

  expect(await screen.findByText("ens banner 0")).toBeInTheDocument();

  global.fetch.mockImplementation(() => {
    // Never answers: the next results are still loading.
    return new Promise(() => {});
  });

  await user.type(screen.getByRole("searchbox"), "c");
  await waitFor(() => expect(router.state.location.pathname).toBe("/search/ensc"));
  expect(screen.getByText("ens banner 0")).toBeInTheDocument();
  expect(screen.getByText("Place ens")).toBeInTheDocument();
  expect(screen.queryByText(/loading places/i)).not.toBeInTheDocument();
});

test("Recent searches only get the finished query, not every prefix", async () => {
  const user = userEvent.setup();
  renderSearch();

  await user.type(screen.getByRole("searchbox"), "enschede");
  await waitFor(() => expect(readRecentSearches()).toEqual(["enschede"]), { timeout: 3000 });
});

test("opening a result records the search right away", async () => {
  const user = userEvent.setup();
  renderSearch();

  await user.type(screen.getByRole("searchbox"), "ensch");
  await user.click(await screen.findByRole("link", { name: /ensch banner 0/i }));
  expect(readRecentSearches()).toEqual(["ensch"]);
});

test("an empty search shows Recent searches", async () => {
  window.localStorage.setItem("openbanners-recent-searches", JSON.stringify(["halloween"]));
  const user = userEvent.setup();
  const router = renderSearch("/search/ens");

  expect(await screen.findByText("ens banner 0")).toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/search"));
  expect(screen.getByRole("link", { name: "halloween" })).toHaveAttribute("href", "/search/halloween");
  expect(screen.queryByText("ens banner 0")).not.toBeInTheDocument();
});

test("typing in a search box elsewhere opens the results and keeps focus and caret", async () => {
  const user = userEvent.setup();
  const router = renderSearch("/");

  await user.type(screen.getByPlaceholderText("Top search"), "ensch");
  await waitFor(() => expect(router.state.location.pathname).toBe("/search/ensch"));
  expect(router.state.historyAction).toBe("PUSH");

  const input = screen.getByRole("searchbox");
  expect(input).toHaveFocus();
  expect(input).toHaveValue("ensch");
  expect(input.selectionStart).toBe(5);

  await user.type(input, "ede");
  await waitFor(() => expect(router.state.location.pathname).toBe("/search/enschede"));
  expect(router.state.historyAction).toBe("REPLACE");
});
