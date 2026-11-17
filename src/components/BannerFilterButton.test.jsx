import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect } from "vitest";
import BannerFilterButton from "./BannerFilterButton";
import { DEFAULT_BANNER_FILTERS, DEFAULT_MAP_BANNER_FILTERS } from "../bannerFilters";

function MapFilterHarness() {
  const [filters, setFilters] = useState(DEFAULT_MAP_BANNER_FILTERS);

  return (
    <BannerFilterButton
      filters={filters}
      onChange={setFilters}
      doneBannersFilterMode="show"
      showTodoListFilter
    />
  );
}

test("shows the map done banner filter as unchecked by default", async () => {
  const user = userEvent.setup();

  render(<MapFilterHarness />);

  expect(
    screen.getByRole("button", { name: /^filters$/i })
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^filters$/i }));

  const showDoneBanners = screen.getByRole("checkbox", {
    name: /show done banners/i,
  });

  expect(showDoneBanners).not.toBeChecked();

  await user.click(showDoneBanners);

  expect(showDoneBanners).toBeChecked();
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
});

test("shows the map to do list filter when enabled", async () => {
  const user = userEvent.setup();

  render(<MapFilterHarness />);

  await user.click(screen.getByRole("button", { name: /^filters$/i }));

  const showHiddenBanners = screen.getByRole("checkbox", {
    name: /show hidden banners/i,
  });
  const onlyTodoBanners = screen.getByRole("checkbox", {
    name: /only to do banners/i,
  });
  const showDoneBanners = screen.getByRole("checkbox", {
    name: /show done banners/i,
  });

  await user.click(onlyTodoBanners);

  expect(onlyTodoBanners).toBeChecked();
  expect(showHiddenBanners).toBeDisabled();
  expect(showDoneBanners).toBeDisabled();
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
});

function KilometerFilterHarness({ onFilters }) {
  const [filters, setFilters] = useState(DEFAULT_BANNER_FILTERS);

  return (
    <BannerFilterButton
      filters={filters}
      onChange={(nextFilters) => {
        setFilters(nextFilters);
        onFilters?.(nextFilters);
      }}
      showMinimumMissionsFilter
      showKilometerFilter
    />
  );
}

test("distance filter offers the map's presets and counts as one filter", async () => {
  const user = userEvent.setup();
  let latest = null;

  render(<KilometerFilterHarness onFilters={(filters) => (latest = filters)} />);

  await user.click(screen.getByRole("button", { name: /^filters$/i }));

  const distance = screen.getByRole("group", { name: "Distance" });
  for (const name of ["Any", "< 5 km", "< 10 km", "< 15 km", "< 20 km", "Custom"]) {
    expect(within(distance).getByRole("button", { name })).toBeInTheDocument();
  }
  expect(within(distance).getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByLabelText("Minimum km")).not.toBeInTheDocument();

  await user.click(within(distance).getByRole("button", { name: "< 5 km" }));

  expect(latest).toMatchObject({ kilometerFilterMode: "preset", minimumKilometers: "", maximumKilometers: "5" });
  expect(within(distance).getByRole("button", { name: "< 5 km" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();

  await user.click(within(distance).getByRole("button", { name: "Any" }));

  expect(latest).toMatchObject({ minimumKilometers: "", maximumKilometers: "" });
  expect(screen.getByText("Filters")).toBeInTheDocument();
});

test("distance filter takes a custom min–max range in km", async () => {
  const user = userEvent.setup();
  let latest = null;

  render(<KilometerFilterHarness onFilters={(filters) => (latest = filters)} />);

  await user.click(screen.getByRole("button", { name: /^filters$/i }));
  const distance = screen.getByRole("group", { name: "Distance" });
  await user.click(within(distance).getByRole("button", { name: "Custom" }));

  // Custom without limits filters nothing yet.
  expect(screen.getByText("Filters")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Minimum km"), "2.5");
  await user.type(screen.getByLabelText("Maximum km"), "8");

  expect(latest).toMatchObject({ kilometerFilterMode: "custom", minimumKilometers: "2.5", maximumKilometers: "8" });
  expect(within(distance).getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
});

test("a preset max picked while in Custom shows as that preset", async () => {
  const user = userEvent.setup();

  render(<KilometerFilterHarness />);

  await user.click(screen.getByRole("button", { name: /^filters$/i }));
  const distance = screen.getByRole("group", { name: "Distance" });
  await user.click(within(distance).getByRole("button", { name: "Custom" }));
  await user.type(screen.getByLabelText("Maximum km"), "3");
  await user.click(within(distance).getByRole("button", { name: "< 10 km" }));

  expect(within(distance).getByRole("button", { name: "< 10 km" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByLabelText("Maximum km")).not.toBeInTheDocument();
  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
});
