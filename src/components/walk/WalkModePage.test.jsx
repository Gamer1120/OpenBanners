import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIngressMissionUrl } from "../../bannerDisplay";

const BANNER = {
  id: "demo-1",
  title: "Demo Banner",
  missions: {
    0: { id: "m1", title: "One", steps: [{ objective: "enterPassphrase", poi: { latitude: 52, longitude: 4, title: "Fountain" } }] },
    1: {
      id: "m2",
      title: "Two",
      steps: [
        { objective: "enterPassphrase", poi: { latitude: 52.001, longitude: 4, title: "Statue" } },
        { objective: "hack", poi: { latitude: 52.002, longitude: 4, title: "B" } },
        { objective: "enterPassphrase", poi: { latitude: 52.003, longitude: 4, title: "Plaque" } },
      ],
    },
    2: { id: "m3", title: "Three", steps: [{ objective: "hack", poi: { latitude: 52.004, longitude: 4, title: "C" } }] },
  },
};

const ANSWERS = [
  { missionId: "m1", stepIndex: 0, kind: "text", answer: "fish", status: "live" },
  { missionId: "m2", stepIndex: 0, kind: "text", answer: "lion", status: "live" },
];

vi.mock("../../bannergressSync", () => ({
  fetchBannergress: vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BANNER) })),
}));

vi.mock("../../passphraseApi", () => ({
  useBannerPassphrases: () => {
    const byStep = new Map();
    for (const answer of ANSWERS) {
      const key = answer.missionId + ":" + answer.stepIndex;
      byStep.set(key, [...(byStep.get(key) ?? []), answer]);
    }
    return { status: "ready", byStep, blocked: null };
  },
}));

const { default: WalkModePage, walkNavigation } = await import("./WalkModePage");

let events;
function setClipboard() {
  const writeText = vi.fn((text) => {
    events.push(["copy", text]);
    return Promise.resolve();
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

function setPosition(latitude, longitude) {
  Object.defineProperty(navigator, "permissions", {
    value: { query: () => Promise.resolve({ state: "granted" }) },
    configurable: true,
  });
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude, longitude, accuracy: 10 } }) },
    configurable: true,
  });
}

async function renderWalk() {
  render(
    <MemoryRouter initialEntries={["/banner/demo-1/walk"]}>
      <Routes>
        <Route path="/banner/:bannerId/walk" element={<WalkModePage />} />
      </Routes>
    </MemoryRouter>
  );
  return screen.findByRole("link", { name: /^open mission/i });
}

// Tap the big button and come back (the page is shown again).
async function openAndReturn() {
  const button = screen.getByRole("link", { name: /^open mission/i });
  await act(async () => {
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    window.dispatchEvent(new Event("pageshow"));
  });
}

describe("walk mode page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    events = [];
    setClipboard();
    setPosition(52, 4);
    vi.spyOn(walkNavigation, "go").mockImplementation((url) => events.push(["navigate", url]));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens mission 1 first: copies its passphrase, then opens it in Ingress in the same tab", async () => {
    const button = await renderWalk();
    expect(button).toHaveTextContent("Open mission 1");
    expect(button).toHaveAttribute("href", buildIngressMissionUrl("m1"));
    expect(button).not.toHaveAttribute("target");
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    await openAndReturn();
    expect(events).toEqual([
      ["copy", "fish"],
      ["navigate", buildIngressMissionUrl("m1")],
    ]);
  });

  it("after coming back: the next mission, and the passphrases of a mission with more than one", async () => {
    await renderWalk();
    await openAndReturn();
    const second = screen.getByRole("link", { name: /^open mission/i });
    expect(second).toHaveTextContent("Open mission 2");
    expect(second).toHaveAttribute("href", buildIngressMissionUrl("m2"));
    // Mission 1 has one passphrase: no rows.
    expect(screen.queryByText("Mission 1 passphrases")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reopen mission 1" })).toHaveAttribute("href", buildIngressMissionUrl("m1"));

    await openAndReturn();
    expect(events.filter((event) => event[0] === "copy").map((event) => event[1])).toEqual(["fish", "lion"]);
    expect(screen.getByRole("link", { name: /^open mission/i })).toHaveTextContent("Open mission 3");
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    const rows = screen.getByRole("region", { name: "Mission 2 passphrases" });
    expect(within(rows).getByText("Statue")).toBeInTheDocument();
    expect(within(rows).getByText("lion")).toBeInTheDocument();
    expect(within(rows).getByText("Plaque")).toBeInTheDocument();
    expect(within(rows).getByText("Answer unknown")).toBeInTheDocument();

    // A known row copies on tap and says so; the unknown one only offers the guess.
    events = [];
    await act(async () => {
      fireEvent.click(within(rows).getByRole("button", { name: /lion/ }));
    });
    expect(events).toEqual([["copy", "lion"]]);
    expect(within(rows).getByText("✓ Copied")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(rows).getByRole("button", { name: "Copy 2 (guess)" }));
    });
    expect(events).toEqual([
      ["copy", "lion"],
      ["copy", "2"],
    ]);
  });

  it("says the banner is complete after the last mission", async () => {
    await renderWalk();
    await openAndReturn();
    await openAndReturn();
    await openAndReturn();
    expect(screen.queryByRole("link", { name: /^open mission/i })).not.toBeInTheDocument();
    expect(screen.getByText("Banner complete")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reopen mission 3" })).toBeInTheDocument();
  });

  it("shows Navigate only when the mission starts more than 1 km away", async () => {
    await renderWalk();
    expect(screen.queryByRole("link", { name: /navigate/i })).not.toBeInTheDocument();
    window.localStorage.clear();
  });

  it("shows Navigate with the distance beyond 1 km", async () => {
    setPosition(52.0207, 4);
    await renderWalk();
    const navigate = await screen.findByRole("link", { name: /navigate · 2\.3 km/i });
    expect(navigate.getAttribute("href")).toContain("google.com/maps/dir/?api=1&destination=52,4&travelmode=walking");
  });

  it("asks for the location only from the Show distance link", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "permissions", { value: { query: () => Promise.resolve({ state: "prompt" }) }, configurable: true });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    await renderWalk();
    const link = await screen.findByRole("button", { name: "Show distance" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
