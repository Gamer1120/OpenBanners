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
