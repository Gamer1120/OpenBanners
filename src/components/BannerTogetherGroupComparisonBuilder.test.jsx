import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import {
  BANNER_TOGETHER_GROUP_PRESET_IDS,
  getBannerTogetherGroupPresetClauses,
} from "../bannerTogetherGroupComparison";
import BannerTogetherGroupComparisonBuilder from "./BannerTogetherGroupComparisonBuilder";

const participants = [
  { id: "alice", label: "Alice", lists: { todo: ["one"] } },
  { id: "bob", label: "Bob", lists: { done: ["one"] } },
  { id: "cara", label: "Cara", lists: { blacklist: ["one"] } },
];

function GroupBuilderHarness({
  localParticipantId = "alice",
  initialClauses = getBannerTogetherGroupPresetClauses(
    BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO,
    participants,
    localParticipantId
  ),
}) {
  const [clauses, setClauses] = useState(initialClauses);

  return (
    <>
      <BannerTogetherGroupComparisonBuilder
        participants={participants}
        localParticipantId={localParticipantId}
        clauses={clauses}
        onChange={setClauses}
        resultCount={7}
      />
      <output data-testid="clauses">{JSON.stringify(clauses)}</output>
    </>
  );
}

function readClauses() {
  return JSON.parse(screen.getByTestId("clauses").textContent);
}

function getSelect(container, label) {
  return within(container).getByRole("button", {
    name: new RegExp(`^${label}(?:\\s|$)`),
  });
}

async function choosePreset(user, label) {
  await user.click(
    screen.getByRole("button", { name: /^Comparison(?:\s|$)/ })
  );
  await user.click(screen.getByRole("option", { name: label }));
}

describe("BannerTogetherGroupComparisonBuilder", () => {
  test("shows participant labels, viewer context, and explicit AND rules", () => {
    render(<GroupBuilderHarness />);

    const alternative = screen.getByRole("group", {
      name: "Comparison alternative 1",
    });

    expect(getSelect(alternative, "Alice \\(you\\)")).toBeInTheDocument();
    expect(getSelect(alternative, "Bob")).toBeInTheDocument();
    expect(getSelect(alternative, "Cara")).toBeInTheDocument();
    expect(within(alternative).getAllByText("AND")).toHaveLength(2);
    expect(screen.getByText("Everyone to-do")).toBeInTheDocument();
    expect(screen.getByText("7 banners")).toBeInTheDocument();
  });

  test("moves the viewer label and applies local-participant presets", async () => {
    const user = userEvent.setup();
    render(<GroupBuilderHarness localParticipantId="bob" />);

    const alternative = screen.getByRole("group", {
      name: "Comparison alternative 1",
    });
    expect(getSelect(alternative, "Alice")).toBeInTheDocument();
    expect(getSelect(alternative, "Bob \\(you\\)")).toBeInTheDocument();

    await choosePreset(user, "My to-do, everyone else not listed");

    expect(readClauses()).toEqual([
      {
        participantStatuses: {
          alice: ["unlisted"],
          bob: ["todo"],
          cara: ["unlisted"],
        },
      },
    ]);
  });

  test("expands the at-least-two preset into OR alternatives", async () => {
    const user = userEvent.setup();
    render(<GroupBuilderHarness />);

    await choosePreset(user, "At least two to-do");

    expect(readClauses()).toHaveLength(3);
    expect(
      screen.getByRole("group", { name: "Comparison alternative 3" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("OR")).toHaveLength(2);
  });

  test("adds and removes accessible alternatives", async () => {
    const user = userEvent.setup();
    render(<GroupBuilderHarness />);

    expect(
      screen.getByRole("button", { name: "Remove comparison alternative 1" })
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add alternative" }));
    expect(readClauses()).toHaveLength(2);
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

  test("marks an empty participant selection invalid and switches to Custom", async () => {
    const user = userEvent.setup();
    render(<GroupBuilderHarness />);

    const alternative = screen.getByRole("group", {
      name: "Comparison alternative 1",
    });
    const aliceSelect = getSelect(alternative, "Alice \\(you\\)");
    await user.click(aliceSelect);
    await user.click(screen.getByRole("option", { name: "To do" }));
    await user.keyboard("{Escape}");

    expect(readClauses()[0].participantStatuses.alice).toEqual([]);
    expect(aliceSelect).toHaveAttribute("aria-invalid", "true");
    expect(
      within(alternative).getByText("Choose at least one status.")
    ).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  test("recovers from an externally emptied alternative list", async () => {
    const user = userEvent.setup();
    render(<GroupBuilderHarness initialClauses={[]} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at least one comparison alternative."
    );

    await user.click(screen.getByRole("button", { name: "Add alternative" }));

    expect(readClauses()).toEqual([
      {
        participantStatuses: {
          alice: ["todo"],
          bob: ["unlisted"],
          cara: ["unlisted"],
        },
      },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
