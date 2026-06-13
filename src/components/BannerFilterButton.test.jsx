import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect } from "vitest";
import BannerFilterButton from "./BannerFilterButton";
import { DEFAULT_MAP_BANNER_FILTERS } from "../bannerFilters";

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

test("shows map route length kilometer filters when enabled", async () => {
  const user = userEvent.setup();

  function KilometerFilterHarness() {
    const [filters, setFilters] = useState(DEFAULT_MAP_BANNER_FILTERS);

    return (
      <BannerFilterButton
        filters={filters}
        onChange={setFilters}
        doneBannersFilterMode="show"
        showKilometerFilter
      />
    );
  }

  render(<KilometerFilterHarness />);

  await user.click(screen.getByRole("button", { name: /^filters$/i }));
  await user.type(screen.getByLabelText("Minimum km"), "2.5");
  await user.type(screen.getByLabelText("Maximum km"), "5");

  expect(screen.getByText("Filters (1)")).toBeInTheDocument();
  expect(screen.getByDisplayValue("2.5")).toBeInTheDocument();
  expect(screen.getByDisplayValue("5")).toBeInTheDocument();
});
