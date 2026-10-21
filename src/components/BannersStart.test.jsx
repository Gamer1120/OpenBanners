import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BannersStart from "./BannersStartPage";
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

test("start page shows the 3 nearest banners and country / province / city buttons", async () => {
  mockPermission("granted");
  navigator.geolocation.getCurrentPosition = vi.fn((resolve) =>
    resolve({ coords: { latitude: 52.2215, longitude: 6.8937 } })
  );
  const nearby = Array.from({ length: 6 }, (_, index) => ({
    id: `near-${index}`,
    title: `Near ${index}`,
    numberOfMissions: 6,
    startPlaceId: "enschede-fe79",
  }));
  const enschede = {
    id: "enschede-fe79",
    type: "locality",
    longName: "Enschede",
    numberOfBanners: 94,
    boundaryMinLatitude: 52.1,
    boundaryMaxLatitude: 52.3,
    boundaryMinLongitude: 6.7,
    boundaryMaxLongitude: 7.0,
    parentPlace: {
      id: "overijssel-9f29",
      type: "administrative_area_level_1",
      longName: "Overijssel",
      parentPlace: { id: "netherlands-2585", type: "country", longName: "Netherlands" },
    },
  };
  global.fetch = vi.fn((input) => {
    const url = String(input);
    const body = url.includes("/bnrs?") ? nearby : url.includes("/places/enschede-fe79") ? enschede : null;
    return Promise.resolve({ ok: Boolean(body), status: body ? 200 : 404, json: () => Promise.resolve(body) });
  });

  renderStart();

  expect(await screen.findByText("Near 0")).toBeInTheDocument();
  expect(screen.getByText("Near 2")).toBeInTheDocument();
  expect(screen.queryByText("Near 3")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /more banners near you/i })).toHaveAttribute("href", "/near");
  expect(await screen.findByRole("link", { name: /netherlands/i })).toHaveAttribute(
    "href",
    "/browse/netherlands-2585"
  );
  expect(screen.getByRole("link", { name: /overijssel/i })).toHaveAttribute("href", "/browse/overijssel-9f29");
  expect(screen.getByRole("link", { name: /enschede/i })).toHaveAttribute("href", "/browse/enschede-fe79");
  const order = Array.from(screen.getByRole("navigation", { name: /where to look/i }).querySelectorAll("a")).map(
    (link) => link.getAttribute("href")
  );
  expect(order).toEqual([
    "/near",
    "/browse/",
    "/browse/netherlands-2585",
    "/browse/overijssel-9f29",
    "/browse/enschede-fe79",
  ]);
});

test("without location the start page uses the saved city's places", async () => {
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
          parentPlace: { id: "netherlands-2585", type: "country", longName: "Netherlands" },
        }),
    })
  );
  renderStart();

  expect(await screen.findByRole("link", { name: /netherlands/i })).toHaveAttribute(
    "href",
    "/browse/netherlands-2585"
  );
  expect(screen.getByRole("button", { name: /use my location/i })).toBeInTheDocument();
});

test("start page falls back to all countries", async () => {
  mockPermission("denied");
  renderStart();
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/browse\/$/));
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
