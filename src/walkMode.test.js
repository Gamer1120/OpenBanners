import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWalkMissions,
  doneCount,
  emptyWalkState,
  isBannerComplete,
  isWalkPreviewHost,
  loadWalkState,
  missionPassphrases,
  navigateTarget,
  openMission,
  openMissionTap,
  passphraseAnswer,
  passphraseToCopy,
  pickMission,
  stepTarget,
  saveWalkState,
  targetMissionIndex,
  undoWalk,
  writeClipboard,
  WALK_STATE_PREFIX,
} from "./walkMode";
import { buildIngressMissionUrl } from "./bannerDisplay";
import { parseBannerInput } from "./components/walk/WalkMockups";

const poi = (latitude, longitude, title) => ({ latitude, longitude, title, type: "portal" });
const hack = (latitude, title) => ({ objective: "hack", poi: poi(latitude, 4, title) });
const pass = (latitude, title) => ({ objective: "enterPassphrase", poi: poi(latitude, 4, title) });

// Mission 1: one passphrase. (Position 1: a filler slot.) Mission 2: two
// passphrases. Mission 3: none. Mission 4: one passphrase.
const banner = {
  0: { id: "m1", title: "One", steps: [hack(52, "A"), pass(52.001, "Fountain")] },
  2: { id: "m2", title: "Two", steps: [pass(52.002, "Statue"), hack(52.003, "B"), pass(52.004, "Plaque")] },
  3: { id: "m3", title: "Three", steps: [hack(52.005, "C")] },
  4: { id: "m4", title: "Four", steps: [pass(52.006, "Gate")] },
};
const live = (missionId, stepIndex, answer, kind = "text") => ({ missionId, stepIndex, answer, kind, status: "live" });
const byStepOf = (answers) => {
  const map = new Map();
  for (const answer of answers) {
    const key = answer.missionId + ":" + answer.stepIndex;
    map.set(key, [...(map.get(key) ?? []), answer]);
  }
  return map;
};

describe("walk missions", () => {
  const missions = buildWalkMissions(banner);

  it("lists the missions in banner order without filler slots, with start and passphrase steps", () => {
    expect(missions.map((mission) => [mission.number, mission.id])).toEqual([
      [1, "m1"],
      [2, "m2"],
      [3, "m3"],
      [4, "m4"],
    ]);
    expect(missions[0].start).toEqual({ latitude: 52, longitude: 4 });
    expect(missions[1].passphrases).toEqual([
      { stepIndex: 0, title: "Statue" },
      { stepIndex: 2, title: "Plaque" },
    ]);
    expect(missions[2].passphrases).toEqual([]);
    expect(missions[0].url).toBe(buildIngressMissionUrl("m1"));
    expect(missions[0].intelUrl).toBe("https://intel.ingress.com/mission/m1");
  });

  it("answers like the Overlay: best live answer, the mission number for a number answer, a guess when unknown", () => {
    const byStep = byStepOf([
      { ...live("m2", 0, "older"), status: "pending" },
      live("m2", 0, " lion "),
      live("m2", 0, "tiger"),
      live("m1", 1, "x", "number"),
    ]);
    expect(passphraseAnswer(missions[1], 0, byStep)).toEqual({ text: "lion", known: true, guess: null });
    expect(passphraseAnswer(missions[0], 1, byStep)).toEqual({ text: "1", known: true, guess: null });
    expect(passphraseAnswer(missions[1], 2, byStep)).toEqual({ text: null, known: false, guess: "2" });
    // Authors opted out: no answer and no guess.
    expect(passphraseAnswer(missions[1], 0, byStep, [{ scope: "banner" }])).toEqual({ text: null, known: false, guess: null });
  });

  it("copies the only passphrase, the first of several, and nothing when that answer is unknown", () => {
    const byStep = byStepOf([live("m1", 1, "fish"), live("m2", 0, "lion"), live("m2", 2, "bear"), live("m4", 9, "wrong step")]);
    expect(passphraseToCopy(missionPassphrases(missions[0], byStep))).toBe("fish");
    expect(passphraseToCopy(missionPassphrases(missions[1], byStep))).toBe("lion");
    expect(passphraseToCopy(missionPassphrases(missions[2], byStep))).toBe(null);
    expect(passphraseToCopy(missionPassphrases(missions[3], byStep))).toBe(null);
    // First unknown, second known: copies nothing (pasting the second at the first would be wrong).
    expect(passphraseToCopy(missionPassphrases(missions[1], byStepOf([live("m2", 2, "bear")])))).toBe(null);
  });
});

describe("which mission the big button opens", () => {
  const missions = buildWalkMissions(banner);

  it("starts at mission 1, then the mission after the one opened last", () => {
    let state = emptyWalkState();
    expect(targetMissionIndex(missions, state)).toBe(0);
    state = openMission(missions, state, 0);
    expect(state.current).toBe("m1");
    expect(targetMissionIndex(missions, state)).toBe(1);
    expect(doneCount(missions, state)).toBe(0);
    state = openMission(missions, state, 1);
    expect([...state.done]).toEqual(["m1"]);
    expect(targetMissionIndex(missions, state)).toBe(2);
    expect(doneCount(missions, state)).toBe(1);
  });

  it("marks every mission before the one opened done (starting in the middle)", () => {
    const state = openMission(missions, emptyWalkState(), 2);
    expect([...state.done].sort()).toEqual(["m1", "m2"]);
    expect(targetMissionIndex(missions, state)).toBe(3);
    expect(doneCount(missions, state)).toBe(2);
  });

  it("− / + move the big button's mission within the banner, without marking anything", () => {
    let state = openMission(missions, emptyWalkState(), 0);
    const done = [...state.done];
    const history = state.history.length;
    expect(targetMissionIndex(missions, state)).toBe(1);
    state = stepTarget(missions, state, 1);
    expect(targetMissionIndex(missions, state)).toBe(2);
    state = stepTarget(missions, state, 1);
    expect(targetMissionIndex(missions, state)).toBe(3);
    // Last mission: + stays put.
    expect(stepTarget(missions, state, 1)).toBe(state);
    state = stepTarget(missions, state, -1);
    state = stepTarget(missions, state, -1);
    state = stepTarget(missions, state, -1);
    expect(targetMissionIndex(missions, state)).toBe(0);
    // First mission: − stays put.
    expect(stepTarget(missions, state, -1)).toBe(state);
    expect([...state.done]).toEqual(done);
    expect(state.current).toBe("m1");
    expect(state.history.length).toBe(history);
  });

  it("opens the mission picked in the menu, and goes on after it", () => {
    let state = openMission(missions, emptyWalkState(), 0);
    state = pickMission(missions, state, 3);
    expect(targetMissionIndex(missions, state)).toBe(3);
    state = openMission(missions, state, 3);
    expect(state.pick).toBe(null);
    // m1..m3 are done now, m4 is in progress: banner complete.
    expect(isBannerComplete(missions, state)).toBe(true);
  });

  it("is complete after opening the last mission, counting it as done", () => {
    let state = emptyWalkState();
    for (let index = 0; index < missions.length; index += 1) {
      expect(isBannerComplete(missions, state)).toBe(false);
      state = openMission(missions, state, index);
    }
    expect(targetMissionIndex(missions, state)).toBe(-1);
    expect(isBannerComplete(missions, state)).toBe(true);
    expect(doneCount(missions, state)).toBe(4);
  });

  it("undoes step by step", () => {
    let state = openMission(missions, emptyWalkState(), 0);
    state = openMission(missions, state, 1);
    state = undoWalk(state);
    expect(state.current).toBe("m1");
    expect(state.done.size).toBe(0);
    state = undoWalk(state);
    expect(state.current).toBe(null);
    expect(undoWalk(state)).toBe(state);
  });
});

describe("tapping Open mission N", () => {
  const missions = buildWalkMissions(banner);
  const byStep = byStepOf([live("m1", 1, "fish"), live("m2", 0, "lion")]);

  function tap(index, state = emptyWalkState(), clipboardResult = true) {
    const calls = [];
    const result = openMissionTap({
      missions,
      state,
      index,
      passphrases: missionPassphrases(missions[index], byStep),
      writeClipboard: (text) => {
        calls.push(["copy", text]);
        return Promise.resolve(clipboardResult);
      },
      save: (next) => calls.push(["save", next.current]),
      navigate: (url) => calls.push(["navigate", url]),
    });
    return { calls, result };
  }

  it("copies the answer first, then saves, then opens the mission's Ingress link", async () => {
    const { calls, result } = tap(0);
    expect((await result).copied).toBe("fish");
    expect(calls).toEqual([
      ["copy", "fish"],
      ["save", "m1"],
      ["navigate", buildIngressMissionUrl("m1")],
    ]);
  });

  it("copies the first of two passphrases", async () => {
    const { calls } = tap(1, openMission(missions, emptyWalkState(), 0));
    await Promise.resolve();
    expect(calls[0]).toEqual(["copy", "lion"]);
  });

  it("copies nothing for an unknown answer or a mission without passphrases, and still opens Ingress", async () => {
    for (const index of [2, 3]) {
      const { calls, result } = tap(index);
      expect((await result).copied).toBe(null);
      expect(calls).toEqual([
        ["save", missions[index].id],
        ["navigate", buildIngressMissionUrl(missions[index].id)],
      ]);
    }
  });

  it("still opens Ingress when the clipboard refuses", async () => {
    const { calls, result } = tap(0, emptyWalkState(), false);
    expect((await result).copied).toBe(null);
    expect(calls.map((call) => call[0])).toEqual(["copy", "save", "navigate"]);
  });
});

describe("writeClipboard", () => {
  const original = navigator.clipboard;
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
    vi.useRealTimers();
  });

  it("calls writeText at once and gives up after the timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const result = writeClipboard("fish", 600);
    expect(writeText).toHaveBeenCalledWith("fish");
    vi.advanceTimersByTime(600);
    await expect(result).resolves.toBe(false);
  });

  it("resolves true once written", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    await expect(writeClipboard("fish")).resolves.toBe(true);
  });
});

describe("walk state on this device", () => {
  const missions = buildWalkMissions(banner);
  beforeEach(() => window.localStorage.clear());

  it("comes back as it was saved: the next mission, and the passphrases of the one in progress", () => {
    const state = openMission(missions, openMission(missions, emptyWalkState(), 0), 1);
    saveWalkState("b1", state);
    const back = loadWalkState("b1");
    expect(back.current).toBe("m2");
    expect([...back.done]).toEqual(["m1"]);
    expect(targetMissionIndex(missions, back)).toBe(2);
    expect(undoWalk(back).current).toBe("m1");
  });

  it("removes the entry when reset, and survives broken data", () => {
    saveWalkState("b1", openMission(missions, emptyWalkState(), 0));
    saveWalkState("b1", emptyWalkState());
    expect(window.localStorage.getItem(WALK_STATE_PREFIX + "b1")).toBe(null);
    window.localStorage.setItem(WALK_STATE_PREFIX + "b2", "{nope");
    expect(loadWalkState("b2")).toEqual(emptyWalkState());
  });
});

describe("Navigate", () => {
  const [mission] = buildWalkMissions(banner);

  it("shows only when the mission starts more than 1 km away", () => {
    // 0.009° latitude ≈ 1 km.
    expect(navigateTarget(mission, { latitude: 52.005, longitude: 4 })).toBe(null);
    expect(navigateTarget(mission, null)).toBe(null);
    const far = navigateTarget(mission, { latitude: 52.0207, longitude: 4 });
    expect(Math.round(far.distance / 100)).toBe(23);
    expect(far.start).toEqual({ latitude: 52, longitude: 4 });
  });
});

describe("walk mode helpers", () => {
  it("shows the preview entry point off openbanners.org only", () => {
    expect(isWalkPreviewHost("openbanners.org")).toBe(false);
    expect(isWalkPreviewHost("www.openbanners.org")).toBe(false);
    expect(isWalkPreviewHost("test.openbanners.org")).toBe(true);
  });

  it("reads a banner id from an id or a link", () => {
    expect(parseBannerInput(" riddle-me-this-7592 ")).toBe("riddle-me-this-7592");
    expect(parseBannerInput("https://openbanners.org/banner/abc-12?x=1")).toBe("abc-12");
    expect(parseBannerInput("bad id!")).toBe("");
  });
});
