import { beforeEach, describe, expect, it } from "vitest";
import {
  arrowRotation,
  bearingDegrees,
  buildWalkRoute,
  currentMissionIndex,
  distanceMeters,
  headingFromOrientation,
  isWalkPreviewHost,
  loadWalkProgress,
  moveToward,
  nextWaypointIndex,
  normalizeVariant,
  passphraseFor,
  progressCounts,
  saveWalkProgress,
  simulateStep,
  tickInRange,
  WALK_PROGRESS_PREFIX,
  addDone,
  completeMission,
  doneAndOpenNext,
  emptyWalkState,
  isBannerComplete,
  loadWalkState,
  missionComplete,
  missionKey,
  nextOpenMission,
  saveWalkState,
  selectMission,
  targetMissionIndex,
  undoWalk,
} from "./walkMode";
import { buildIngressMissionUrl } from "./bannerDisplay";
import { parseBannerInput } from "./components/walk/WalkMockups";

// ~0.0003° latitude ≈ 33 m.
const poi = (latitude, longitude, title, type = "portal") => ({ latitude, longitude, title, type });
const missions = {
  0: {
    id: "m1",
    title: "One",
    type: "sequential",
    steps: [
      { objective: "hack", poi: poi(52, 4, "A") },
      { objective: "enterPassphrase", poi: poi(52, 4, "A") },
      { objective: "hack", poi: poi(52.001, 4, "B") },
    ],
  },
  // Position 1 is a filler slot (left out on purpose).
  2: {
    id: "m2",
    title: "Two",
    type: "anyOrder",
    steps: [
      { objective: "hack", poi: poi(52.003, 4, "C") },
      { objective: "hack", poi: { type: "unavailable" } },
      { objective: "hack", poi: poi(52.002, 4, "D") },
    ],
  },
};

describe("walk mode route", () => {
  it("lists walkable waypoints in banner order, without filler slots or unavailable portals", () => {
    const route = buildWalkRoute(missions);
    expect(route.missions.map((mission) => mission.title)).toEqual(["One", "Two"]);
    expect(route.waypoints.map((waypoint) => waypoint.title)).toEqual(["A", "A", "B", "C", "D"]);
    expect(route.waypoints[1]).toMatchObject({ key: "m1:1", passphrase: true, missionIndex: 0, stepIndex: 1 });
    expect(route.waypoints[4]).toMatchObject({ key: "m2:2", missionIndex: 1 });
    expect(route.missions[1].anyOrder).toBe(true);
  });

  it("walks missions in order and steps in order", () => {
    const route = buildWalkRoute(missions);
    expect(nextWaypointIndex(route, new Set())).toBe(0);
    expect(nextWaypointIndex(route, new Set(["m1:0"]))).toBe(1);
    expect(currentMissionIndex(route, new Set(["m1:0", "m1:1", "m1:2"]))).toBe(1);
  });

  it("takes the nearest open waypoint in an any-order mission", () => {
    const route = buildWalkRoute(missions);
    const done = new Set(["m1:0", "m1:1", "m1:2"]);
    expect(route.waypoints[nextWaypointIndex(route, done, { latitude: 52.0021, longitude: 4 })].title).toBe("D");
    expect(route.waypoints[nextWaypointIndex(route, done, { latitude: 52.0031, longitude: 4 })].title).toBe("C");
  });

  it("ticks off the next waypoints within 40 m, several at one portal at once", () => {
    const route = buildWalkRoute(missions);
    const far = tickInRange(route, new Set(), { latitude: 51.999, longitude: 4 });
    expect(far.ticked).toEqual([]);
    const near = tickInRange(route, new Set(), { latitude: 52.0002, longitude: 4 });
    expect(near.ticked).toEqual(["m1:0", "m1:1"]);
    expect(progressCounts(route, near.done)).toEqual({ total: 5, completed: 2, missionsDone: 0, missions: 2 });
    const all = new Set(route.waypoints.map((waypoint) => waypoint.key));
    expect(nextWaypointIndex(route, all)).toBe(-1);
    expect(progressCounts(route, all).missionsDone).toBe(2);
  });

  it("simulates walking: reaches and ticks off the next waypoint", () => {
    const route = buildWalkRoute(missions);
    let done = new Set();
    let position = simulateStep(route, done, null, 6);
    expect(distanceMeters(position, route.waypoints[0])).toBeGreaterThan(100);
    for (let tick = 0; tick < 40 && !done.size; tick += 1) {
      position = simulateStep(route, done, position, 6);
      done = tickInRange(route, done, position).done;
    }
    expect(done.has("m1:0")).toBe(true);
  });

  it("moves towards a point and stops on it", () => {
    const from = { latitude: 52, longitude: 4 };
    const to = { latitude: 52.001, longitude: 4 };
    const step = moveToward(from, to, 50);
    expect(distanceMeters(from, step)).toBeCloseTo(50, 0);
    expect(moveToward(step, to, 500)).toEqual(to);
  });

  it("points the arrow by bearing and heading", () => {
    expect(bearingDegrees({ latitude: 52, longitude: 4 }, { latitude: 53, longitude: 4 })).toBeCloseTo(0, 3);
    expect(bearingDegrees({ latitude: 0, longitude: 4 }, { latitude: 0, longitude: 5 })).toBeCloseTo(90, 3);
    expect(arrowRotation(90, null)).toBe(90);
    expect(arrowRotation(90, 120)).toBe(330);
    expect(headingFromOrientation({ webkitCompassHeading: 45 })).toBe(45);
    expect(headingFromOrientation({ absolute: true, alpha: 90 })).toBe(270);
    expect(headingFromOrientation({ absolute: false, alpha: 90 })).toBeNull();
  });
});

describe("walk mode passphrases", () => {
  const route = buildWalkRoute(missions);
  const waypoint = route.waypoints[1];

  it("copies the best live answer, else the mission number as a guess", () => {
    const byStep = new Map([
      ["m1:1", [{ status: "pending", answer: "nope" }, { status: "live", answer: " dragon " }, { status: "live", answer: "x" }]],
    ]);
    expect(passphraseFor(waypoint, byStep)).toEqual({ text: "dragon", known: true });
    expect(passphraseFor(waypoint, new Map([["m1:1", [{ status: "live", kind: "number" }]]]))).toEqual({ text: "1", known: true });
    expect(passphraseFor(waypoint, new Map())).toEqual({ text: "1", known: false });
  });

  it("offers nothing on other steps or when the authors opted out", () => {
    expect(passphraseFor(route.waypoints[0], new Map())).toBeNull();
    expect(passphraseFor(waypoint, new Map(), [{ scope: "banner" }])).toBeNull();
  });
});

describe("walk mode progress and links", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps progress per banner in localStorage", () => {
    saveWalkProgress("b1", new Set(["m1:0"]));
    expect([...loadWalkProgress("b1")]).toEqual(["m1:0"]);
    expect(loadWalkProgress("b2").size).toBe(0);
    saveWalkProgress("b1", new Set());
    expect(window.localStorage.getItem(WALK_PROGRESS_PREFIX + "b1")).toBeNull();
    window.localStorage.setItem(WALK_PROGRESS_PREFIX + "b3", "{broken");
    expect(loadWalkProgress("b3").size).toBe(0);
  });

  it("parses the picker and variants", () => {
    expect(normalizeVariant("B")).toBe("b");
    expect(normalizeVariant("x")).toBe("a");
    expect(parseBannerInput("https://bannergress.com/banner/green-dragon-1ece")).toBe("green-dragon-1ece");
    expect(parseBannerInput(" green-dragon-1ece ")).toBe("green-dragon-1ece");
    expect(parseBannerInput("a b")).toBe("");
    expect(isWalkPreviewHost("test.openbanners.org")).toBe(true);
    expect(isWalkPreviewHost("openbanners.org")).toBe(false);
  });
});

describe("walk mode Ingress button", () => {
  // Four missions; mission 3 has no waypoint with a position.
  const four = {
    0: { id: "a1", title: "Dragon 01/04", steps: [{ objective: "hack", poi: poi(52, 4, "A") }, { objective: "hack", poi: poi(52.001, 4, "B") }] },
    1: { id: "a2", title: "Dragon 02/04", steps: [{ objective: "hack", poi: poi(52.002, 4, "C") }] },
    2: { id: "a3", title: "Dragon 03/04", steps: [{ objective: "hack", poi: { type: "unavailable" } }] },
    3: { id: "a4", title: "Dragon 04/04", steps: [{ objective: "hack", poi: poi(52.004, 4, "D") }] },
  };
  const route = buildWalkRoute(four);
  const open = (state) => targetMissionIndex(route, state.done, state.selected);

  it("opens mission 1 before starting and the mission in progress after that", () => {
    const start = emptyWalkState();
    expect(open(start)).toBe(0);
    const halfway = addDone(route, start, ["a1:0"]);
    expect(open(halfway)).toBe(0);
    const firstDone = addDone(route, halfway, ["a1:1"]);
    expect(missionComplete(route, firstDone.done, 0)).toBe(true);
    expect(open(firstDone)).toBe(1);
  });

  it("goes on to the next mission that isn't done, skipping done ones and coming back for skipped ones", () => {
    const done = new Set(["a2:0", missionKey("a3", 2)]);
    expect(nextOpenMission(route, done, 0)).toBe(3);
    expect(nextOpenMission(route, new Set(["a4:0"]), 3)).toBe(0);
    const all = new Set(["a1:0", "a1:1", "a2:0", missionKey("a3", 2), "a4:0"]);
    expect(nextOpenMission(route, all, 0)).toBe(-1);
    expect(isBannerComplete(route, all)).toBe(true);
    expect(targetMissionIndex(route, all, null)).toBe(-1);
  });

  it("opens a picked mission, and moves on once the picked mission is ticked off", () => {
    const picked = selectMission(route, emptyWalkState(), 3);
    expect(open(picked)).toBe(3);
    expect(selectMission(route, picked, 99).selected).toBe(3);
    expect(selectMission(route, picked, -5).selected).toBe(0);
    const ticked = addDone(route, picked, ["a4:0"]);
    // Mission 4 done by walking: back to the first mission that isn't done.
    expect(open(ticked)).toBe(0);
  });

  it("done, open next: marks the mission done, advances and links the next mission", () => {
    const result = doneAndOpenNext(route, emptyWalkState());
    expect(result.done).toBe(0);
    expect(missionComplete(route, result.state.done, 0)).toBe(true);
    expect(result.state.done.has("a1:0") && result.state.done.has("a1:1")).toBe(true);
    expect(open(result.state)).toBe(1);
    expect(result.next).toMatchObject({ missionIndex: 1, number: 2, title: "Dragon 02/04" });
    expect(result.next.url).toBe(buildIngressMissionUrl("a2"));
    expect(result.next.url).toMatch(/^https:\/\/link\.ingress\.com\/\?link=https%3A%2F%2Fintel\.ingress\.com%2Fmission%2Fa2&/);
    expect(result.next.intelUrl).toBe("https://intel.ingress.com/mission/a2");

    // A mission without walkable waypoints can be done too.
    const second = doneAndOpenNext(route, result.state);
    const third = doneAndOpenNext(route, second.state);
    expect(third.done).toBe(2);
    expect(third.next.number).toBe(4);
    const last = doneAndOpenNext(route, third.state);
    expect(last.next).toBeNull();
    expect(isBannerComplete(route, last.state.done)).toBe(true);
    expect(open(last.state)).toBe(-1);
  });

  it("undo takes back done, open next as one step", () => {
    const after = doneAndOpenNext(route, selectMission(route, emptyWalkState(), 1)).state;
    expect(open(after)).toBe(2);
    const back = undoWalk(route, after);
    expect(back.done.size).toBe(0);
    expect(open(back)).toBe(1);
    // Old saved progress without history: the last done waypoint.
    expect([...undoWalk(route, { done: new Set(["a1:0", "a1:1"]), selected: null, history: [] }).done]).toEqual(["a1:0"]);
  });

  it("saves the state for when the page comes back from Ingress", () => {
    window.localStorage.clear();
    const state = completeMission(route, emptyWalkState(), 0);
    saveWalkState("b9", state);
    const loaded = loadWalkState("b9");
    expect(loaded.selected).toBe(1);
    expect([...loaded.done].sort()).toEqual([...state.done].sort());
    expect(loaded.history).toEqual(state.history);
    saveWalkState("b9", emptyWalkState());
    expect(window.localStorage.getItem(WALK_PROGRESS_PREFIX + "b9")).toBeNull();
  });
});
