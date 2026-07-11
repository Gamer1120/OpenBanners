import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import App from "./App";

vi.mock("./components/TopMenu", () => ({
  default: () => <nav>OpenBanners menu</nav>,
}));

vi.mock("./components/BannerTogetherPage", () => ({
  default: ({ placeId, roomId }) => (
    <div>
      Banner Together route: {placeId} / {roomId ?? "new"}
    </div>
  ),
}));

vi.mock("./components/BannersNearMe", () => ({
  default: () => <div>Banners Near Me mounted</div>,
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.scrollTo = vi.fn();
});

test("routes place-scoped Banner Together links through Home", () => {
  window.history.replaceState({}, "", "/together/enschede-place");

  render(<App />);

  expect(
    screen.getByText("Banner Together route: enschede-place / new")
  ).toBeInTheDocument();
  expect(screen.queryByText("Banners Near Me mounted")).not.toBeInTheDocument();
});

test("routes short encrypted room links without mounting the nearby view", () => {
  window.history.replaceState(
    {},
    "",
    "/together/enschede-place/room/room-123"
  );

  render(<App />);

  expect(
    screen.getByText("Banner Together route: enschede-place / room-123")
  ).toBeInTheDocument();
  expect(screen.queryByText("Banners Near Me mounted")).not.toBeInTheDocument();
});
