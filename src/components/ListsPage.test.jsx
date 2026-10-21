import React from "react";
import { render, screen } from "@testing-library/react";
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

test("To do / Done / Hidden counts come from a fresh sync when Lists opens", async () => {
  const lists = { todo: ["t-1", "t-2", "t-3"], done: ["d-1", "d-2"], blacklist: ["h-1"] };
  global.fetch = vi.fn((input) => {
    const url = new URL(String(input));
    const listType = url.searchParams.get("listTypes");

    // Bannergress refusing the id-only request must not leave the counts at 0.
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

  expect(await screen.findByRole("button", { name: /to do\s*3/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /done\s*2/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /hidden\s*1/i })).toBeInTheDocument();
});
