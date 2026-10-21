import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BannersScopeBar, { BannersStart } from "./BannersScope";
import SearchPage from "./SearchPage";
import { addRecentSearch, readRecentSearches } from "../recentSearches";

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}

function renderStart() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<BannersStart />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const originalPermissions = navigator.permissions;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  Object.defineProperty(navigator, "permissions", { value: originalPermissions, configurable: true });
});

function mockPermission(state) {
  if (!("geolocation" in navigator)) {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn() },
      configurable: true,
    });
  }

  Object.defineProperty(navigator, "permissions", {
    value: { query: vi.fn().mockResolvedValue({ state }) },
    configurable: true,
  });
}

test("start page opens Near you when location is allowed", async () => {
  mockPermission("granted");
  renderStart();
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/near"));
});

test("start page opens the saved city without location", async () => {
  mockPermission("prompt");
  window.localStorage.setItem(
    "openbanners-home-city",
    JSON.stringify({ picked: true, place: { id: "enschede-1", longName: "Enschede" }, savedAt: Date.now() })
  );
  renderStart();
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/browse/enschede-1"));
});

test("start page falls back to all countries", async () => {
  mockPermission("denied");
  renderStart();
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/browse\/$/));
});

test("scope bar offers city, province, country and All for the last city", async () => {
  mockPermission("prompt");
  window.localStorage.setItem(
    "openbanners-home-city",
    JSON.stringify({ picked: true, place: { id: "enschede-fe79", longName: "Enschede" }, savedAt: Date.now() })
  );
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: "enschede-fe79",
          type: "locality",
          longName: "Enschede",
          parentPlace: {
            id: "overijssel-9f29",
            type: "administrative_area_level_1",
            longName: "Overijssel",
            parentPlace: { id: "netherlands-2585", type: "country", longName: "Netherlands" },
          },
        }),
    })
  );

  render(
    <MemoryRouter initialEntries={["/browse/enschede-fe79"]}>
      <BannersScopeBar />
    </MemoryRouter>
  );

  const city = await screen.findByRole("link", { name: "Enschede" });
  expect(city).toHaveAttribute("href", "/browse/enschede-fe79");
  expect(city).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Overijssel" })).toHaveAttribute("href", "/browse/overijssel-9f29");
  expect(screen.getByRole("link", { name: "Netherlands" })).toHaveAttribute("href", "/browse/netherlands-2585");
  expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/browse/");
  expect(screen.getByRole("button", { name: /use my location/i })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /near/i })).not.toBeInTheDocument();
});

test("search page lists and clears recent searches", async () => {
  addRecentSearch("Enschede");
  addRecentSearch("halloween");
  addRecentSearch("enschede");
  expect(readRecentSearches()).toEqual(["enschede", "halloween"]);

  render(
    <MemoryRouter initialEntries={["/search"]}>
      <SearchPage />
    </MemoryRouter>
  );

  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(screen.getByRole("link", { name: "halloween" })).toHaveAttribute("href", "/search/halloween");
  await userEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(screen.queryByRole("link", { name: "halloween" })).not.toBeInTheDocument();
  expect(readRecentSearches()).toEqual([]);
});
