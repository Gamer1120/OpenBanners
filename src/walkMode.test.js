import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWalkMissions,
  doneCount,
  emptyWalkState,
  canStepTarget,
  isBannerComplete,
  isWalkFinished,
  isWalkPreviewHost,
  loadWalkState,
  missionPassphrases,
  navigateTarget,
  openMission,
  openMissionTap,
  parseFromMission,
  passphraseAnswer,
  passphraseToCopy,
  pickMission,
  stepTarget,
  saveWalkState,
  startAtMission,
  targetMissionIndex,
  undoWalk,
  writeClipboard,
  writeClipboardLater,
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
    expect(missions[0]).not.toHaveProperty("intelUrl");
  });

  it("leaves out passphrases on deleted portals (Ingress skips them)", () => {
    const gone = { objective: "enterPassphrase", poi: { latitude: 52.01, longitude: 4, title: "Big Chilis", type: "unavailable" } };
    const walk = buildWalkMissions({
      0: { id: "g1", title: "Only gone", steps: [gone, hack(52.011, "D")] },
      1: { id: "g2", title: "Mixed", steps: [gone, pass(52.012, "Gate")] },
    });
    expect(walk[0].passphrases).toEqual([]);
    expect(walk[1].passphrases).toEqual([{ stepIndex: 1, title: "Gate" }]);
    // The button copies the passphrase still asked for, not the deleted one's answer.
    const byStep = byStepOf([live("g2", 0, "old"), live("g2", 1, "gate")]);
    expect(passphraseToCopy(missionPassphrases(walk[1], byStep))).toBe("gate");
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

  it("− / + also work once the banner is complete: − picks the last mission, + from it comes back", () => {
    let state = emptyWalkState();
    missions.forEach((mission, index) => {
      state = openMission(missions, state, index);
    });
    const history = state.history.length;
    expect(isBannerComplete(missions, state)).toBe(true);
    expect(canStepTarget(missions, state, 1)).toBe(false);
    expect(stepTarget(missions, state, 1)).toBe(state);
    expect(canStepTarget(missions, state, -1)).toBe(true);

    state = stepTarget(missions, state, -1);
    expect(targetMissionIndex(missions, state)).toBe(3);
    expect(isBannerComplete(missions, state)).toBe(false);
    expect(isWalkFinished(missions, state)).toBe(true);
    // Still all done: picking a mission marks nothing.
    expect(doneCount(missions, state)).toBe(4);
    state = stepTarget(missions, state, -1);
    expect(targetMissionIndex(missions, state)).toBe(2);
    state = stepTarget(missions, state, 1);
    expect(targetMissionIndex(missions, state)).toBe(3);
    expect(canStepTarget(missions, state, 1)).toBe(true);
    state = stepTarget(missions, state, 1);
    expect(state.pick).toBe(null);
    expect(isBannerComplete(missions, state)).toBe(true);
    expect(state.history.length).toBe(history);
    expect(state.current).toBe("m4");
  });

  it("opening a mission picked on the complete screen ends complete again", () => {
    let state = emptyWalkState();
    missions.forEach((mission, index) => {
      state = openMission(missions, state, index);
    });
    state = stepTarget(missions, state, -1);
    state = stepTarget(missions, state, -1);
    state = openMission(missions, state, targetMissionIndex(missions, state));
    expect(state.current).toBe("m3");
    expect(isBannerComplete(missions, state)).toBe(true);
    expect(doneCount(missions, state)).toBe(4);
  });

  it("+ at the last mission stays put while the banner isn't complete", () => {
    let state = openMission(missions, emptyWalkState(), 0);
    state = pickMission(missions, state, 3);
    expect(canStepTarget(missions, state, 1)).toBe(false);
    expect(stepTarget(missions, state, 1)).toBe(state);
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

describe("starting walk mode at mission N (?from=N)", () => {
  const missions = buildWalkMissions(banner);

  it("reads only plain mission numbers from the address", () => {
    expect(parseFromMission("5")).toBe(5);
    expect(parseFromMission(" 12 ")).toBe(12);
    for (const bad of [null, undefined, "", "0", "-1", "1.5", "abc", "5x", "1e2", "999999"]) {
      expect(parseFromMission(bad)).toBeNull();
    }
  });

  it("points the big button at mission N without marking anything done (like + N−1 times)", () => {
    const fresh = emptyWalkState();
    const state = startAtMission(missions, fresh, 3);
    expect(targetMissionIndex(missions, state)).toBe(2);
    expect([...state.done]).toEqual([]);
    expect(state.current).toBeNull();
    expect(state.history).toEqual([]);
    expect(doneCount(missions, state)).toBe(0);
    let pressed = fresh;
    pressed = stepTarget(missions, pressed, 1);
    pressed = stepTarget(missions, pressed, 1);
    expect(state).toEqual(pressed);
    // − / + go on from there.
    expect(targetMissionIndex(missions, stepTarget(missions, state, -1))).toBe(1);
    expect(targetMissionIndex(missions, stepTarget(missions, state, 1))).toBe(3);
  });

  it("leaves the state alone for mission 1 of a new walk, and for numbers that aren't a mission", () => {
    const fresh = emptyWalkState();
    expect(startAtMission(missions, fresh, 1)).toBe(fresh);
    for (const bad of [0, -2, 5, 99, null, undefined, NaN, 1.5]) {
      expect(startAtMission(missions, fresh, bad)).toBe(fresh);
    }
  });

  it("keeps saved progress: done marks, the mission in progress and Undo stay, only the target moves", () => {
    let saved = openMission(missions, emptyWalkState(), 0);
    saved = openMission(missions, saved, 1);
    // Mission 1 done, mission 2 in progress, the big button on mission 3.
    expect(targetMissionIndex(missions, saved)).toBe(2);
    const back = startAtMission(missions, saved, 1);
    expect(targetMissionIndex(missions, back)).toBe(0);
    expect([...back.done]).toEqual(["m1"]);
    expect(back.current).toBe("m2");
    expect(back.history).toEqual(saved.history);
    expect(doneCount(missions, back)).toBe(1);
    const ahead = startAtMission(missions, saved, 4);
    expect(targetMissionIndex(missions, ahead)).toBe(3);
    expect([...ahead.done]).toEqual(["m1"]);
    // Already the target: nothing changes.
    expect(startAtMission(missions, saved, 3)).toBe(saved);
    // Out of range: nothing changes either.
    expect(startAtMission(missions, saved, 9)).toBe(saved);
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

describe("writeClipboardLater (tap before the answers loaded)", () => {
  const original = navigator.clipboard;
  const hadItem = "ClipboardItem" in globalThis;
  const originalItem = globalThis.ClipboardItem;
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
    if (hadItem) {
      globalThis.ClipboardItem = originalItem;
    } else {
      delete globalThis.ClipboardItem;
    }
  });

  function fakeClipboardItem() {
    globalThis.ClipboardItem = class {
      constructor(items) {
        this.items = items;
      }
    };
    const written = [];
    const write = vi.fn(async ([item]) => {
      const blob = await item.items["text/plain"];
      // jsdom's Blob has no text(): read it the old way.
      const text = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(blob);
      });
      written.push(text);
    });
    const writeText = vi.fn(() => Promise.reject(new Error("not allowed")));
    Object.defineProperty(navigator, "clipboard", { value: { write, writeText }, configurable: true });
    return { write, writeText, written };
  }

  it("starts the write inside the tap with a promised blob, and writes the text when it arrives", async () => {
    const { write, written } = fakeClipboardItem();
    let resolveText;
    const result = writeClipboardLater(new Promise((resolve) => (resolveText = resolve)));
    expect(write).toHaveBeenCalledTimes(1);
    resolveText("fish");
    await expect(result).resolves.toBe(true);
    expect(written).toEqual(["fish"]);
  });

  it("copies nothing when the answer is unknown (null)", async () => {
    const { written, writeText } = fakeClipboardItem();
    await expect(writeClipboardLater(Promise.resolve(null))).resolves.toBe(false);
    expect(written).toEqual([]);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("without ClipboardItem: writeText once the text is there", async () => {
    delete globalThis.ClipboardItem;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await expect(writeClipboardLater(Promise.resolve("lion"))).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("lion");
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
