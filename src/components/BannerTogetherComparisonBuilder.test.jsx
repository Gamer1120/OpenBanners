import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import {
  BANNER_TOGETHER_COMPARISON_PRESET_IDS,
  getBannerTogetherComparisonPresetClauses,
} from "../bannerTogetherComparison";
import BannerTogetherComparisonBuilder from "./BannerTogetherComparisonBuilder";

function ComparisonBuilderHarness({
  viewerRole = "creator",
  initialClauses = getBannerTogetherComparisonPresetClauses(
    BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO
  ),
}) {
  const [clauses, setClauses] = useState(initialClauses);

  return (
    <>
      <BannerTogetherComparisonBuilder
        viewerRole={viewerRole}
        clauses={clauses}
        onChange={setClauses}
        resultCount={3}
      />
      <output data-testid="clauses">{JSON.stringify(clauses)}</output>
    </>
  );
}

function readClauses() {
  return JSON.parse(screen.getByTestId("clauses").textContent);
}

function getSelect(label) {
  return screen.getByRole("button", {
    name: new RegExp(`^${label}(?:\\s|$)`),
  });
}

async function selectComparisonPreset(user, optionName) {
  await user.click(getSelect("Comparison"));
  await user.click(screen.getByRole("option", { name: optionName }));
}

describe("BannerTogetherComparisonBuilder", () => {
  test("uses viewer-aware role and preset labels", () => {
    const { rerender } = render(
      <ComparisonBuilderHarness viewerRole="creator" />
    );

    expect(getSelect("Mine")).toBeInTheDocument();
    expect(getSelect("Theirs")).toBeInTheDocument();
    expect(screen.getByText("Both to do")).toBeInTheDocument();
    expect(screen.getByText("3 banners")).toBeInTheDocument();

    rerender(<ComparisonBuilderHarness viewerRole="recipient" />);

    expect(getSelect("Inviter")).toBeInTheDocument();
    expect(getSelect("Mine")).toBeInTheDocument();
  });

  test("applies a preset and switches to Custom after a status edit", async () => {
    const user = userEvent.setup();
    render(<ComparisonBuilderHarness />);

    await selectComparisonPreset(user, "My to-do only");

    expect(readClauses()).toEqual([
      { creator: ["todo"], recipient: ["unlisted"] },
    ]);
    expect(screen.getByText("My to-do only")).toBeInTheDocument();

    await user.click(getSelect("Theirs"));
    await user.click(screen.getByRole("option", { name: "Done" }));
    await user.keyboard("{Escape}");

    expect(readClauses()).toEqual([
      { creator: ["todo"], recipient: ["done", "unlisted"] },
    ]);
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  test("adds and removes accessible comparison alternatives", async () => {
    const user = userEvent.setup();
    render(<ComparisonBuilderHarness />);

    expect(
      screen.getByRole("button", { name: "Remove comparison alternative 1" })
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add alternative" }));

    expect(readClauses()).toHaveLength(2);
    expect(screen.getByText("OR")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Comparison alternative 2" })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove comparison alternative 2" })
    );

    expect(readClauses()).toHaveLength(1);
    expect(
      screen.queryByRole("group", { name: "Comparison alternative 2" })
    ).not.toBeInTheDocument();
  });

  test("marks an empty status selection invalid and describes the error", async () => {
    const user = userEvent.setup();
    render(<ComparisonBuilderHarness />);

    const creatorSelect = getSelect("Mine");
    await user.click(creatorSelect);
    const listbox = screen.getByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "To do" }));
    await user.keyboard("{Escape}");

    expect(readClauses()).toEqual([
      { creator: [], recipient: ["todo"] },
    ]);
    expect(creatorSelect).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose at least one status.")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  test("shows a recoverable error when no alternatives exist", async () => {
    const user = userEvent.setup();
    render(<ComparisonBuilderHarness initialClauses={[]} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at least one comparison alternative."
    );

    await user.click(screen.getByRole("button", { name: "Add alternative" }));

    expect(readClauses()).toEqual([
      { creator: ["todo"], recipient: ["unlisted"] },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
