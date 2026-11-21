import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

// What useBannerPassphrases returns; setAnswers() changes it for every mounted page.
const answerStore = vi.hoisted(() => ({ state: null, listeners: new Set() }));
const READY = () => ({ status: "ready", answers: ANSWERS });
function setAnswers(next) {
  answerStore.state = next;
  answerStore.listeners.forEach((listener) => listener());
}

vi.mock("../../passphraseApi", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useBannerPassphrases: () => {
      const [, rerender] = useReducer((count) => count + 1, 0);
      useEffect(() => {
        answerStore.listeners.add(rerender);
        return () => answerStore.listeners.delete(rerender);
      }, []);
      const { status, answers } = answerStore.state;
      const data = status === "ready" ? { answers } : null;
      const byStep = new Map();
      for (const answer of data?.answers ?? []) {
        const key = answer.missionId + ":" + answer.stepIndex;
        byStep.set(key, [...(byStep.get(key) ?? []), answer]);
      }
      return { status, data, byStep, blocked: null };
    },
  };
});

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

let currentUrl;
function LocationProbe() {
  const location = useLocation();
  currentUrl = location.pathname + location.search;
  return null;
}

async function renderWalk(url = "/banner/demo-1/walk") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
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
    answerStore.state = READY();
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
    expect(screen.queryByText(/reopen mission/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/open on intel/i)).not.toBeInTheDocument();

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

  it("− / + above the big button choose the mission it opens, and the big button then opens that one", async () => {
    const button = await renderWalk();
    const minus = screen.getByRole("button", { name: "Previous mission" });
    const plus = screen.getByRole("button", { name: "Next mission" });
    // The row sits directly above the big button.
    expect(minus.parentElement.nextElementSibling).toBe(button);
    expect(minus.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(minus).toBeDisabled();
    expect(plus).not.toBeDisabled();

    fireEvent.click(plus);
    let big = screen.getByRole("link", { name: /^open mission/i });
    expect(big).toHaveTextContent("Open mission 2");
    expect(big).toHaveTextContent("Two");
    expect(big).toHaveAttribute("href", buildIngressMissionUrl("m2"));
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    expect(minus).not.toBeDisabled();

    fireEvent.click(plus);
    big = screen.getByRole("link", { name: /^open mission/i });
    expect(big).toHaveTextContent("Open mission 3");
    expect(plus).toBeDisabled();
    fireEvent.click(plus);
    expect(screen.getByRole("link", { name: /^open mission/i })).toHaveTextContent("Open mission 3");

    fireEvent.click(minus);
    expect(screen.getByRole("link", { name: /^open mission/i })).toHaveTextContent("Open mission 2");
    // Nothing copied or opened, nothing marked done.
    expect(events).toEqual([]);
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();

    // The big button now opens mission 2 (copying its passphrase), and points at 3 on return.
    await openAndReturn();
    expect(events).toEqual([
      ["copy", "lion"],
      ["navigate", buildIngressMissionUrl("m2")],
    ]);
    expect(screen.getByRole("link", { name: /^open mission/i })).toHaveTextContent("Open mission 3");
  });

  it("?from=N starts with the big button on mission N, nothing done, and drops ?from from the address", async () => {
    const button = await renderWalk("/banner/demo-1/walk?from=3");
    expect(button).toHaveTextContent("Open mission 3");
    expect(button).toHaveAttribute("href", buildIngressMissionUrl("m3"));
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    expect(currentUrl).toBe("/banner/demo-1/walk");
    // − / + still work from there.
    const minus = screen.getByRole("button", { name: "Previous mission" });
    const plus = screen.getByRole("button", { name: "Next mission" });
    expect(plus).toBeDisabled();
    fireEvent.click(minus);
    expect(screen.getByRole("link", { name: /^open mission/i })).toHaveTextContent("Open mission 2");
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    expect(events).toEqual([]);

    // A reload (no ?from any more) keeps the mission − chose instead of jumping back to 3.
    cleanup();
    expect(await renderWalk()).toHaveTextContent("Open mission 2");
  });

  it("?from=N that isn't a mission of the banner starts as usual and is dropped too", async () => {
    for (const from of ["9", "0", "abc"]) {
      const button = await renderWalk("/banner/demo-1/walk?from=" + from);
      expect(button).toHaveTextContent("Open mission 1");
      expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
      expect(currentUrl).toBe("/banner/demo-1/walk");
      cleanup();
    }
    expect(window.localStorage.getItem("openbanners-walk:demo-1")).toBeNull();
  });

  it("?from=N with saved progress: jumps to mission N and keeps the done marks", async () => {
    await renderWalk();
    await openAndReturn();
    await openAndReturn();
    expect(screen.getByRole("link", { name: /^open mission/i })).toHaveTextContent("Open mission 3");
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    cleanup();

    const button = await renderWalk("/banner/demo-1/walk?from=1");
    expect(button).toHaveTextContent("Open mission 1");
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(currentUrl).toBe("/banner/demo-1/walk");
    // Mission 2 is still the one in progress (its passphrase rows stay).
    expect(screen.getByRole("region", { name: "Mission 2 passphrases" })).toBeInTheDocument();
  });

  it("has no Pick mission in the ⋯ menu any more; Undo, Reset and Banner page stay", async () => {
    await renderWalk();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const menu = screen.getByRole("dialog", { name: "Menu" });
    expect(within(menu).queryByText(/pick mission/i)).not.toBeInTheDocument();
    expect(within(menu).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /undo/i })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Banner page" })).toBeInTheDocument();
  });

  it("says the banner is complete after the last mission", async () => {
    await renderWalk();
    await openAndReturn();
    await openAndReturn();
    await openAndReturn();
    expect(screen.queryByRole("link", { name: /^open mission/i })).not.toBeInTheDocument();
    expect(screen.getByText("Banner complete")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
    expect(screen.queryByText(/reopen mission/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/open on intel/i)).not.toBeInTheDocument();
  });

  it("keeps − / + on the complete screen: − brings back Open mission N, + returns to complete", async () => {
    await renderWalk();
    await openAndReturn();
    await openAndReturn();
    await openAndReturn();
    events.length = 0;
    const minus = screen.getByRole("button", { name: "Previous mission" });
    const plus = screen.getByRole("button", { name: "Next mission" });
    // Same place as on the normal screen: directly above the card that replaces the big button.
    expect(minus.parentElement.nextElementSibling).toBe(screen.getByRole("status"));
    expect(screen.getByRole("status")).toHaveTextContent("Banner complete");
    expect(minus).not.toBeDisabled();
    expect(plus).toBeDisabled();

    fireEvent.click(minus);
    let big = screen.getByRole("link", { name: /^open mission/i });
    expect(big).toHaveTextContent("Open mission 3");
    expect(minus.parentElement.nextElementSibling).toBe(big);
    expect(screen.queryByText("Banner complete")).not.toBeInTheDocument();
    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
    expect(plus).not.toBeDisabled();

    fireEvent.click(minus);
    big = screen.getByRole("link", { name: /^open mission/i });
    expect(big).toHaveTextContent("Open mission 2");
    expect(big).toHaveAttribute("href", buildIngressMissionUrl("m2"));

    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(screen.getByText("Banner complete")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^open mission/i })).not.toBeInTheDocument();
    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
    // Nothing copied, opened or marked.
    expect(events).toEqual([]);

    // − then the big button: opens that mission, and comes back complete.
    fireEvent.click(minus);
    fireEvent.click(minus);
    await openAndReturn();
    expect(events).toEqual([
      ["copy", "lion"],
      ["navigate", buildIngressMissionUrl("m2")],
    ]);
    expect(screen.getByText("Banner complete")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
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

  describe("while the passphrase answers are still loading", () => {
    const passphraseText = /\(guess\)|unknown|copies (the )?passphrase|loading passphrases/i;

    it("shows nothing about the passphrase, then the hint once the answer is there (no guess)", async () => {
      answerStore.state = { status: "loading" };
      const button = await renderWalk();
      expect(button).toHaveTextContent("Open mission 1");
      expect(document.body.textContent).not.toMatch(passphraseText);
      // The hint line and the slot under the button keep their place.
      expect(button.querySelector(".wk-open-hint").textContent).toBe("\u00a0");
      expect(document.querySelector(".wk-guess-slot")).toBeInTheDocument();

      act(() => setAnswers(READY()));
      expect(button).toHaveTextContent("Copies the passphrase");
      expect(document.body.textContent).not.toMatch(/\(guess\)|unknown/i);
    });

    it("shows unknown + the guess only once loading has finished without an answer", async () => {
      answerStore.state = { status: "loading" };
      await renderWalk();
      expect(document.body.textContent).not.toMatch(passphraseText);
      act(() => setAnswers({ status: "ready", answers: [] }));
      expect(screen.getByText("Passphrase answer unknown")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy 1 (guess)" })).toBeInTheDocument();
    });

    it("treats a failed request as unknown, after it failed", async () => {
      answerStore.state = { status: "loading" };
      await renderWalk();
      expect(screen.queryByRole("button", { name: /guess/ })).not.toBeInTheDocument();
      act(() => setAnswers({ status: "error" }));
      expect(screen.getByText("Passphrase answer unknown")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy 1 (guess)" })).toBeInTheDocument();
    });

    it("a tap waits for the answers and copies the real one", async () => {
      answerStore.state = { status: "loading" };
      const button = await renderWalk();
      await act(async () => {
        fireEvent.click(button);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(events).toEqual([]);
      await act(async () => {
        setAnswers(READY());
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(events).toEqual([
        ["copy", "fish"],
        ["navigate", buildIngressMissionUrl("m1")],
      ]);
    });

    it("a tap copies nothing (no guess) when the answer turns out unknown or doesn't come", async () => {
      answerStore.state = { status: "loading" };
      const button = await renderWalk();
      await act(async () => {
        fireEvent.click(button);
        await new Promise((resolve) => setTimeout(resolve, 20));
        setAnswers({ status: "ready", answers: [] });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(events).toEqual([["navigate", buildIngressMissionUrl("m1")]]);
    });

    it("a tap gives up waiting after a second and opens the mission without copying", async () => {
      answerStore.state = { status: "loading" };
      const button = await renderWalk();
      await act(async () => {
        fireEvent.click(button);
        await new Promise((resolve) => setTimeout(resolve, 900));
      });
      expect(events).toEqual([]);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(events).toEqual([["navigate", buildIngressMissionUrl("m1")]]);
    });

    it("the rows of a mission with 2+ passphrases show no unknown or guess until loaded", async () => {
      await renderWalk();
      await openAndReturn();
      await openAndReturn();
      cleanup();
      answerStore.state = { status: "loading" };
      await renderWalk();
      const rows = screen.getByRole("region", { name: "Mission 2 passphrases" });
      expect(within(rows).getByText("Statue")).toBeInTheDocument();
      expect(within(rows).getByText("Plaque")).toBeInTheDocument();
      expect(rows.textContent).not.toMatch(/unknown|guess|lion/i);
      expect(within(rows).queryByRole("button")).not.toBeInTheDocument();
      act(() => setAnswers(READY()));
      expect(within(rows).getByText("lion")).toBeInTheDocument();
      expect(within(rows).getByText("Answer unknown")).toBeInTheDocument();
      expect(within(rows).getByRole("button", { name: "Copy 2 (guess)" })).toBeInTheDocument();
    });
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

  it("keeps the space for Show distance from the start, so the big button doesn't change size", async () => {
    let answer;
    Object.defineProperty(navigator, "permissions", {
      value: { query: () => new Promise((resolve) => (answer = resolve)) },
      configurable: true,
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: vi.fn() }, configurable: true });
    await renderWalk();
    // Permission not known yet: the slot is there, empty.
    const slot = screen.getByTestId("wk-nav-slot");
    expect(slot).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Show distance" })).toBeNull();
    await act(async () => answer({ state: "prompt" }));
    // The link appears inside the same slot.
    expect(within(slot).getByRole("button", { name: "Show distance" })).toBeInTheDocument();
    expect(screen.getByTestId("wk-nav-slot")).toBe(slot);
  });
});
