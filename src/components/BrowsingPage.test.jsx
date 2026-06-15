import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import BrowsingPage from "./BrowsingPage";

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
