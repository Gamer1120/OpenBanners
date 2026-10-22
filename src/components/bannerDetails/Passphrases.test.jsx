import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.fn(async () => ({ answers: [] }));
vi.mock("../../passphraseApi", async (importOriginal) => ({
  ...(await importOriginal()),
  submitPassphrases: (...args) => submit(...args),
  authorPassphraseAction: vi.fn(),
  voteOnPassphrase: vi.fn(),
}));

import { stepKey } from "../../passphraseApi";
import { PassphrasePanel, WaypointAnswer } from "./Passphrases";

const step = (objective, title) => ({ objective, poi: { title } });
const d = (passphrases = {}) => {
  const answers = passphrases.data?.answers ?? [];
  const byStep = new Map();
  for (const answer of answers) {
    const key = stepKey(answer.missionId, answer.stepIndex);
    byStep.set(key, [...(byStep.get(key) ?? []), answer]);
  }
  return {
    isLoading: false,
    bannerId: "b",
    items: { id: "b" },
    showPassphrases: vi.fn(),
    missions: [
      { id: "m1", title: "One", steps: [step("hack", "A"), step("enterPassphrase", "Sign")] },
      { id: "m2", title: "Two", steps: [step("enterPassphrase", "Plaque")] },
    ],
    passphraseMissions: [
      { index: 0, steps: [1] },
      { index: 1, steps: [0] },
    ],
    passphrases: {
      status: "ready",
      data: { answers },
      loggedIn: true,
      blocked: null,
      isAuthor: false,
      pendingDays: 30,
      apply: vi.fn(),
      ...passphrases,
      byStep,
    },
  };
};
const live = { id: 1, missionId: "m1", missionIndex: 0, stepIndex: 1, kind: "number", status: "live", answer: "1", confirms: 2, wrongs: 0 };

beforeEach(() => submit.mockClear());

describe("passphrase card", () => {
  it("asks once whether every answer is the mission number", async () => {
    const user = userEvent.setup();
    render(<PassphrasePanel d={d()} />);
    expect(screen.getByText("0 of 2 answers known")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, fill them in" }));
    expect(submit).toHaveBeenCalledWith("b", [
      { missionId: "m1", stepIndex: 1, kind: "number" },
      { missionId: "m2", stepIndex: 0, kind: "number" },
    ]);
  });

  it("stops asking once answers exist and points to the open waypoints", () => {
    const banner = d({ data: { answers: [live] } });
    render(<PassphrasePanel d={banner} />);
    expect(screen.queryByRole("button", { name: /fill them in/ })).toBeNull();
    screen.getByRole("button", { name: "Show the 1 without an answer" }).click();
    expect(banner.showPassphrases).toHaveBeenCalled();
  });

  it("says when the author objected and offers no way to add", () => {
    render(<PassphrasePanel d={d({ blocked: "banner" })} />);
    expect(screen.getByText("The author asked not to publish passphrases for this banner.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fill/i })).toBeNull();
  });

  it("gives authors the publish and object controls", () => {
    render(
      <PassphrasePanel
        d={d({
          isAuthor: true,
          data: { answers: [{ id: 7, missionId: "m1", missionIndex: 0, stepIndex: 1, status: "pending", answer: "Blue", visibleAt: "2026-11-21T00:00:00Z" }] },
        })}
      />
    );
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Don’t publish for any of my banners" })).toBeInTheDocument();
  });
});

describe("answer at the waypoint", () => {
  it("saves a typed answer for that waypoint only", async () => {
    const user = userEvent.setup();
    render(<WaypointAnswer d={d()} missionId="m2" missionIndex={1} stepIndex={0} />);
    await user.click(screen.getByRole("button", { name: "Add answer" }));
    await user.type(screen.getByRole("textbox", { name: "Answer for mission 2, waypoint 1" }), "Blue door{Enter}");
    expect(submit).toHaveBeenCalledWith("b", [{ missionId: "m2", stepIndex: 0, kind: "text", text: "Blue door" }]);
  });

  it("treats the mission number as such and offers to fill in the rest", async () => {
    const user = userEvent.setup();
    render(<WaypointAnswer d={d()} missionId="m2" missionIndex={1} stepIndex={0} />);
    await user.click(screen.getByRole("button", { name: "Add answer" }));
    await user.type(screen.getByRole("textbox"), "2{Enter}");
    expect(submit).toHaveBeenCalledWith("b", [{ missionId: "m2", stepIndex: 0, kind: "number" }]);
    expect(await screen.findByText(/That’s the mission number/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yes, fill in \d more/ })).toBeInTheDocument();
  });

  it("hides a known answer until asked", async () => {
    const user = userEvent.setup();
    render(<WaypointAnswer d={d({ data: { answers: [live] } })} missionId="m1" missionIndex={0} stepIndex={1} />);
    expect(screen.queryByText("1")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/2 confirmed/)).toBeInTheDocument();
  });

  it("asks to log in first", async () => {
    render(<WaypointAnswer d={d({ loggedIn: false })} missionId="m2" missionIndex={1} stepIndex={0} />);
    expect(screen.getByRole("button", { name: "Log in to add the answer" })).toBeInTheDocument();
  });
});
