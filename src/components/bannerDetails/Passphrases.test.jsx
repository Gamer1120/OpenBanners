import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const submit = vi.fn(async () => ({ answers: [] }));
vi.mock("../../passphraseApi", async (importOriginal) => ({
  ...(await importOriginal()),
  submitPassphrases: (...args) => submit(...args),
  authorPassphraseAction: vi.fn(),
  voteOnPassphrase: vi.fn(),
}));

import { PassphrasePanel } from "./Passphrases";

const step = (objective, title) => ({ objective, poi: { title } });
const d = (passphrases) => ({
  isLoading: false,
  bannerId: "b",
  items: { id: "b" },
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
    data: { answers: [] },
    loggedIn: true,
    byStep: new Map(),
    blocked: null,
    isAuthor: false,
    pendingDays: 30,
    apply: vi.fn(),
    ...passphrases,
  },
});

describe("passphrase panel", () => {
  it("sends mission numbers and typed answers", async () => {
    const user = userEvent.setup();
    render(<PassphrasePanel d={d()} />);
    expect(screen.getByText("0 of 2 known")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add answers" }));
    await user.click(screen.getByRole("button", { name: "All answers are the mission number" }));
    const second = screen.getByRole("group", { name: "Answer for mission 2, waypoint 1" });
    await user.click(second.querySelector("button:nth-child(2)"));
    await user.type(screen.getByRole("textbox"), "Blue door");
    await user.click(screen.getByRole("button", { name: "Send 2 answers" }));
    expect(submit).toHaveBeenCalledWith("b", [
      { missionId: "m1", stepIndex: 1, kind: "number" },
      { missionId: "m2", stepIndex: 0, kind: "text", text: "Blue door" },
    ]);
    expect(await screen.findByText(/Mission numbers show now, the others after 30 days/)).toBeInTheDocument();
  });

  it("says when the author objected and offers no way to add", () => {
    render(<PassphrasePanel d={d({ blocked: "banner" })} />);
    expect(screen.getByText("The author asked not to publish passphrases for this banner.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add answers/i })).toBeNull();
  });

  it("gives authors the publish and object controls", () => {
    render(
      <PassphrasePanel
        d={d({
          isAuthor: true,
          data: { answers: [{ id: 7, missionIndex: 0, stepIndex: 1, status: "pending", answer: "Blue", visibleAt: "2026-11-21T00:00:00Z" }] },
        })}
      />
    );
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Don’t publish for any of my banners" })).toBeInTheDocument();
  });
});
