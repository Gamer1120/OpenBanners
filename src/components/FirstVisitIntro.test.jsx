import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import FirstVisitIntro, { INTRO_DISMISSED_STORAGE_KEY, shouldShowIntro } from "./FirstVisitIntro";
import { BANNERGRESS_AUTH_STORAGE_KEY } from "../bannergressSync";

const renderIntro = () =>
  render(
    <MemoryRouter>
      <FirstVisitIntro />
    </MemoryRouter>
  );

describe("first-visit intro on the home page", () => {
  beforeEach(() => window.localStorage.clear());

  it("tells a new visitor what OpenBanners is, with the map, planner and Overlay", async () => {
    renderIntro();
    expect(screen.getByRole("heading", { name: "New to OpenBanners?" })).toBeInTheDocument();
    expect(screen.getByText(/Bannergress account/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Banner map" })).toHaveAttribute("href", "/map");
    expect(screen.getByRole("link", { name: "Mission Day planner" })).toHaveAttribute("href", "/planner");

    await userEvent.click(screen.getByRole("button", { name: "Overlay app for Android" }));
    expect(await screen.findByRole("dialog", { name: "Download OpenBanners Overlay" })).toBeInTheDocument();
  });

  it("stays away once closed", async () => {
    renderIntro();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "New to OpenBanners?" })).toBeNull();
    expect(window.localStorage.getItem(INTRO_DISMISSED_STORAGE_KEY)).toBe("1");
    expect(shouldShowIntro()).toBe(false);
  });

  it("isn't shown to people who have used the site before", () => {
    window.localStorage.setItem(BANNERGRESS_AUTH_STORAGE_KEY, "{}");
    expect(shouldShowIntro()).toBe(false);
    window.localStorage.clear();
    window.localStorage.setItem("openbanners.discoveryMap.state", "{}");
    expect(shouldShowIntro()).toBe(false);
    window.localStorage.clear();
    expect(shouldShowIntro()).toBe(true);
  });
});
