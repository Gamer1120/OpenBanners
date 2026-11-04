import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BANNERGRESS_AUTH_STORAGE_KEY } from "../bannergressSync";
import ListsPage from "./ListsPage";

const theme = createTheme();

function json(data, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
}

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={["/lists"]}>
        <ListsPage />
      </MemoryRouter>
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
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
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockApi({ user, yours = [] }) {
  global.fetch = vi.fn((input) => {
    const url = String(input);

    if (url === "https://api.bannergress.com/user") {
      return json(user);
    }

    if (url.includes("author=")) {
      return json(yours);
    }

    return json([]);
  });
}

test("Yours lists the banners of the linked agent, newest first", async () => {
  mockApi({
    user: { agent: { name: "Gamer1120", faction: "enlightened" } },
    yours: [
      { id: "own-1", title: "My Own Banner", numberOfMissions: 6, lengthMeters: 1000, listType: "blacklist" },
    ],
  });
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole("button", { name: /^yours$/i }));

  expect(await screen.findByText("My Own Banner")).toBeInTheDocument();
  const bannerCall = global.fetch.mock.calls
    .map(([input]) => String(input))
    .find((url) => url.includes("author="));
  const params = new URL(bannerCall).searchParams;
  expect(params.get("author")).toBe("Gamer1120");
  expect(params.get("orderBy")).toBe("created");
  expect(params.get("orderDirection")).toBe("DESC");
  expect(params.get("listTypes")).toBeNull();
});

test("Yours explains how to link an agent when none is linked", async () => {
  mockApi({ user: {} });
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole("button", { name: /^yours$/i }));

  expect(await screen.findByText(/link your ingress agent first/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /bannergress account page/i })).toHaveAttribute(
    "href",
    "https://bannergress.com/account"
  );
});

test("Yours shows an empty state with a link to create a banner", async () => {
  mockApi({ user: { agent: { name: "Gamer1120" } }, yours: [] });
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole("button", { name: /^yours$/i }));

  expect(await screen.findByText(/haven’t created any banners yet/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /create the banner on bannergress/i })).toHaveAttribute(
    "href",
    "https://bannergress.com/new-banner"
  );
});

test("opening Lists runs a fresh sync and the tabs show no counts", async () => {
  const lists = { todo: ["t-1", "t-2", "t-3"], done: ["d-1", "d-2"], blacklist: ["h-1"] };
  global.fetch = vi.fn((input) => {
    const url = new URL(String(input));
    const listType = url.searchParams.get("listTypes");

    // Bannergress refusing the id-only request must not break the sync.
    if (url.searchParams.getAll("attributes").length) {
      return json({ error: "Bad Request" }, 400);
    }

    return json((lists[listType] ?? []).map((id) => ({ id, title: id, listType })));
  });
  vi.resetModules();
  const { default: FreshListsPage } = await import("./ListsPage");
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={["/lists"]}>
        <FreshListsPage />
      </MemoryRouter>
    </ThemeProvider>
  );

  await screen.findByText(/synced/i);
  expect(screen.getByRole("button", { name: /^to do$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^hidden$/i })).toBeInTheDocument();
});

test("a failed list sync shows the error with Retry", async () => {
  vi.resetModules();
  const { default: FreshListsPage } = await import("./ListsPage");
  let syncStatus = 500;
  global.fetch = vi.fn((input) => {
    const url = new URL(String(input));

    if (url.searchParams.has("attributes") || url.searchParams.get("limit") === "100") {
      return syncStatus === 200
        ? json(url.searchParams.get("listTypes") === "todo" ? [{ id: "a" }, { id: "b" }] : [])
        : json(null, syncStatus);
    }

    return json([]);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const user = userEvent.setup();
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={["/lists"]}>
        <FreshListsPage />
      </MemoryRouter>
    </ThemeProvider>
  );

  expect(
    await screen.findByText(/Couldn’t load your lists from Bannergress \(HTTP 500\)/)
  ).toBeInTheDocument();
  expect(screen.queryByText("…")).not.toBeInTheDocument();

  syncStatus = 200;
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await screen.findByText(/synced/i);
  expect(screen.queryByText(/Couldn’t load your lists/)).not.toBeInTheDocument();
});

function listCalls() {
  return global.fetch.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === "/bnrs" && url.searchParams.get("limit") === "24");
}

function lastListParams() {
  const calls = listCalls();
  return calls[calls.length - 1]?.searchParams;
}

function mockListApi() {
  global.fetch = vi.fn((input) => {
    const url = new URL(String(input));
    return json(
      url.searchParams.get("limit") === "24"
        ? [{ id: "b-1", title: "Banner One", numberOfMissions: 6, lengthMeters: 1000 }]
        : []
    );
  });
}

function mockGeolocation(result) {
  const getCurrentPosition = vi.fn((onSuccess, onError) =>
    result ? onSuccess({ coords: result }) : onError({ code: 1, message: "denied" })
  );
  Object.defineProperty(global.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

test("lists sort by date added by default and show every banner", async () => {
  window.sessionStorage.clear();
  mockListApi();
  renderPage();

  expect(await screen.findByText("Banner One")).toBeInTheDocument();
  const params = lastListParams();
  expect(params.get("listTypes")).toBe("todo");
  expect(params.get("orderBy")).toBe("listAdded");
  expect(params.get("orderDirection")).toBe("DESC");
  expect(params.has("online")).toBe(false);
  expect(params.has("query")).toBe(false);
  expect(screen.getByRole("button", { name: /sort: recently added/i })).toBeInTheDocument();
});

test("Closest and Furthest sort by distance from the current location", async () => {
  window.sessionStorage.clear();
  mockListApi();
  const getCurrentPosition = mockGeolocation({ latitude: 52.1, longitude: 5.2 });
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Banner One");

  await user.click(screen.getByRole("button", { name: /sort:/i }));
  await user.click(screen.getByRole("menuitem", { name: /closest first/i }));

  await waitFor(() => expect(lastListParams().get("orderBy")).toBe("proximityStartPoint"));
  let params = lastListParams();
  expect(params.get("orderDirection")).toBe("ASC");
  expect(params.get("proximityLatitude")).toBe("52.1");
  expect(params.get("proximityLongitude")).toBe("5.2");
  expect(getCurrentPosition).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: /sort: closest first/i }));
  await user.click(screen.getByRole("menuitem", { name: /furthest first/i }));

  await waitFor(() => expect(lastListParams().get("orderDirection")).toBe("DESC"));
  params = lastListParams();
  expect(params.get("orderBy")).toBe("proximityStartPoint");
  expect(JSON.parse(window.localStorage.getItem("openbanners-lists-view")).sort).toBe("furthest");
});

test("without a location the list keeps its sort and says why", async () => {
  window.sessionStorage.clear();
  mockListApi();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGeolocation(null);
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Banner One");
  const callsBefore = listCalls().length;

  await user.click(screen.getByRole("button", { name: /sort:/i }));
  await user.click(screen.getByRole("menuitem", { name: /closest first/i }));

  expect(
    await screen.findByText(/couldn’t get your location, so the list stays sorted by “recently added”/i)
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /sort: recently added/i })).toBeInTheDocument();
  expect(listCalls()).toHaveLength(callsBefore);
  expect(screen.getByText("Banner One")).toBeInTheDocument();
});

test("a remembered Closest sort falls back when the location is denied", async () => {
  window.sessionStorage.clear();
  window.localStorage.setItem(
    "openbanners-lists-view",
    JSON.stringify({ sort: "closest", yoursSort: "created-desc", status: "all" })
  );
  mockListApi();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGeolocation(null);
  renderPage();

  expect(await screen.findByText("Banner One")).toBeInTheDocument();
  expect(screen.getByText(/couldn’t get your location/i)).toBeInTheDocument();
  expect(listCalls().every((url) => url.searchParams.get("orderBy") === "listAdded")).toBe(true);
});

test("status filter and search go to Bannergress and are remembered", async () => {
  window.sessionStorage.clear();
  mockListApi();
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Banner One");

  await user.click(screen.getByRole("button", { name: /^offline$/i }));
  await waitFor(() => expect(lastListParams().get("online")).toBe("false"));

  await user.click(screen.getByRole("button", { name: /^online$/i }));
  await waitFor(() => expect(lastListParams().get("online")).toBe("true"));
  expect(JSON.parse(window.localStorage.getItem("openbanners-lists-view")).status).toBe("online");

  await user.type(screen.getByRole("searchbox", { name: /search this list/i }), "amst");
  await waitFor(() => expect(lastListParams().get("query")).toBe("amst*"));
  expect(lastListParams().get("listTypes")).toBe("todo");
});

test("Yours has no date-added sorts", async () => {
  window.sessionStorage.clear();
  mockApi({ user: { agent: { name: "Gamer1120" } }, yours: [{ id: "own-1", title: "Mine" }] });
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole("button", { name: /^yours$/i }));
  await screen.findByText("Mine");
  await user.click(screen.getByRole("button", { name: /sort: newest banners/i }));

  expect(screen.queryByRole("menuitem", { name: /recently added/i })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /closest first/i })).toBeInTheDocument();
});
