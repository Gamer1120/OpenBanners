// Walk mode (preview, test only, 2026-11-20 Michael: "Mock up some examples for
// an iPhone walk mode"). iOS can't draw over Ingress, so iPhone players would
// walk a banner with openbanners.org added to the home screen: a full-screen
// page with the next waypoint, its distance and direction, the passphrase and
// a Navigate link. This file is the pure logic (route, progress, simulation);
// the pages are in src/components/walk/.
import { getMissionList } from "./bannerMissions";
import { isPassphraseStep } from "./bannerFacts";
import { buildIngressMissionUrl } from "./bannerDisplay";

// Same as the OpenBanners Overlay (DistanceCalculation.isInRange): a waypoint
// counts as done once you are within hack range of it.
export const HACK_RANGE_METERS = 40;
export const WALK_VARIANTS = ["a", "b", "c"];
export const WALK_PROGRESS_PREFIX = "openbanners-walk-progress:";
// A real banner with passphrases, for the mockup index.
export const DEFAULT_WALK_BANNER = "green-dragon-1ece";

export const stepKey = (missionId, stepIndex) => `${missionId}:${stepIndex}`;

export function normalizeVariant(value) {
  const variant = String(value ?? "").toLowerCase();
  return WALK_VARIANTS.includes(variant) ? variant : "a";
}

// The walk page shows its preview entry point only off the production site.
export function isWalkPreviewHost(hostname = typeof window === "undefined" ? "" : window.location.hostname) {
  return hostname !== "openbanners.org" && hostname !== "www.openbanners.org";
}

function positionOf(step) {
  if (step?.poi?.type === "unavailable") {
    return null;
  }
  const latitude = Number(step?.poi?.latitude);
  const longitude = Number(step?.poi?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude || longitude)
    ? { latitude, longitude }
    : null;
}

// Every waypoint you can walk to, in banner order: missions in banner order
// (filler slots left out), steps in mission order. Waypoints without a
// position (unavailable portals) can't be walked to and are left out.
export function buildWalkRoute(missionsByPosition) {
  const missions = getMissionList(missionsByPosition);
  const waypoints = [];
  const missionInfo = missions.map((mission, missionIndex) => {
    const steps = Array.isArray(mission?.steps) ? mission.steps : Object.values(mission?.steps ?? {});
    const indexes = [];
    steps.forEach((step, stepIndex) => {
      const position = positionOf(step);
      if (!position) {
        return;
      }
      indexes.push(waypoints.length);
      waypoints.push({
        index: waypoints.length,
        key: stepKey(mission?.id ?? "m" + missionIndex, stepIndex),
        missionIndex,
        missionId: mission?.id ?? null,
        stepIndex,
        ...position,
        title: step?.poi?.title || "",
        objective: step?.objective || "",
        passphrase: isPassphraseStep(step),
      });
    });
    return {
      index: missionIndex,
      id: mission?.id ?? null,
      title: mission?.title || "",
      picture: mission?.picture || "",
      anyOrder: mission?.type === "anyOrder",
      waypoints: indexes,
    };
  });
  return { missions: missionInfo, waypoints };
}

export function distanceMeters(from, to) {
  if (!from || !to) {
    return null;
  }
  const values = [from.latitude, from.longitude, to.latitude, to.longitude];
  if (!values.every(Number.isFinite)) {
    return null;
  }
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compass bearing from "from" to "to": 0 = north, clockwise, 0…360.
export function bearingDegrees(from, to) {
  if (!from || !to) {
    return null;
  }
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = rad(from.latitude);
  const lat2 = rad(to.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// How far to turn the arrow: the bearing relative to where the phone points
// (heading), or the plain bearing (north up) when there is no compass.
export function arrowRotation(bearing, heading) {
  if (!Number.isFinite(bearing)) {
    return 0;
  }
  return Number.isFinite(heading) ? (bearing - heading + 360) % 360 : bearing;
}

// The mission you are on: the first one with a waypoint that isn't done. -1 when all are done.
export function currentMissionIndex(route, done) {
  return route.missions.findIndex((mission) => mission.waypoints.some((index) => !done.has(route.waypoints[index].key)));
}

// The waypoint to walk to next (an index into route.waypoints), or -1 when the
// banner is done. Missions go in banner order; inside a mission steps go in
// order, except "any order" missions, where it's the nearest open waypoint.
// With "missionIndex" (the mission picked for the Ingress button) only that
// mission's waypoints count: -1 when it has none open.
export function nextWaypointIndex(route, done, position = null, missionIndex = null) {
  if (missionIndex === null || missionIndex === undefined) {
    missionIndex = currentMissionIndex(route, done);
  }
  if (missionIndex < 0 || !route.missions[missionIndex]) {
    return -1;
  }
  const mission = route.missions[missionIndex];
  const open = mission.waypoints.filter((index) => !done.has(route.waypoints[index].key));
  if (mission.anyOrder && position) {
    let best = open[0];
    let bestDistance = Infinity;
    for (const index of open) {
      const distance = distanceMeters(position, route.waypoints[index]);
      if (distance !== null && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }
  return open.length ? open[0] : -1;
}

// Ticks off what you're standing at: the next waypoint while it is within
// range (repeated, so several steps at one portal go at once). Returns the new
// set and the keys it added (nothing added: the same set).
export function tickInRange(route, done, position, range = HACK_RANGE_METERS, missionIndex = null) {
  if (!position) {
    return { done, ticked: [] };
  }
  const next = new Set(done);
  const ticked = [];
  for (let guard = 0; guard < route.waypoints.length; guard += 1) {
    const index = nextWaypointIndex(route, next, position, missionIndex);
    if (index < 0) {
      break;
    }
    const waypoint = route.waypoints[index];
    const distance = distanceMeters(position, waypoint);
    if (distance === null || distance > range) {
      break;
    }
    next.add(waypoint.key);
    ticked.push(waypoint.key);
  }
  return ticked.length ? { done: next, ticked } : { done, ticked };
}

export function progressCounts(route, done) {
  const total = route.waypoints.length;
  const completed = route.waypoints.filter((waypoint) => done.has(waypoint.key)).length;
  const missionsDone = route.missions.filter((mission) => missionComplete(route, done, mission.index)).length;
  return { total, completed, missionsDone, missions: route.missions.length };
}

// ---------------------------------------------------------------------------
// The Ingress button (2026-11-20 Michael: opening the next mission in Ingress
// is the most important thing walk mode can offer). On iPhone the page can't
// see anything while Ingress is in front, so the flow is: do the mission in
// Ingress, switch back, one tap "Mission 4 done, open mission 5 in Ingress".
//
// Walk state: { done: Set of keys, selected: mission index or null, history }.
// "done" holds waypoint keys and, for missions marked done as a whole,
// missionKey(id) (so a mission without walkable waypoints can be done too).
// "selected" is the mission the button opens when the player picked one (or
// "done, open next" moved on); null = the first mission that isn't done.
// "history" is what Undo takes back: [{ added: [keys], selected }].

export const missionKey = (missionId, missionIndex) => "mission:" + (missionId ?? "m" + missionIndex);
const HISTORY_LIMIT = 30;

export function missionComplete(route, done, missionIndex) {
  const mission = route.missions[missionIndex];
  if (!mission) {
    return false;
  }
  if (done.has(missionKey(mission.id, mission.index))) {
    return true;
  }
  return mission.waypoints.length > 0 && mission.waypoints.every((index) => done.has(route.waypoints[index].key));
}

export function isBannerComplete(route, done) {
  return route.missions.length > 0 && route.missions.every((mission) => missionComplete(route, done, mission.index));
}

// The first mission after "after" that isn't done, else the first one before
// it that isn't done (a skipped mission), else -1.
export function nextOpenMission(route, done, after = -1) {
  const count = route.missions.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = after + offset;
    const wrapped = index >= count ? index - count : index;
    if (wrapped >= 0 && wrapped < count && !missionComplete(route, done, wrapped)) {
      return wrapped;
    }
  }
  return -1;
}

// Which mission the big button opens: the picked one, else mission 1 before
// starting / the mission in progress / the first one that isn't done. -1 when
// the whole banner is done (and nothing is picked).
export function targetMissionIndex(route, done, selected = null) {
  if (Number.isInteger(selected) && selected >= 0 && selected < route.missions.length) {
    return selected;
  }
  return nextOpenMission(route, done, -1);
}

export function ingressMissionLink(route, missionIndex) {
  const mission = route.missions[missionIndex];
  if (!mission?.id) {
    return null;
  }
  return {
    missionIndex,
    number: missionIndex + 1,
    title: mission.title,
    url: buildIngressMissionUrl(mission.id),
    intelUrl: "https://intel.ingress.com/mission/" + mission.id,
  };
}

export function emptyWalkState() {
  return { done: new Set(), selected: null, history: [] };
}

// Adds keys to "done" (an Undo step). When that finishes the picked mission,
// the button moves on to the next mission that isn't done.
export function addDone(route, state, keys) {
  const added = keys.filter((key) => !state.done.has(key));
  if (!added.length) {
    return state;
  }
  const done = new Set(state.done);
  added.forEach((key) => done.add(key));
  let selected = state.selected;
  if (Number.isInteger(selected) && !missionComplete(route, state.done, selected) && missionComplete(route, done, selected)) {
    const next = nextOpenMission(route, done, selected);
    selected = next >= 0 ? next : null;
  }
  const history = [...state.history, { added, selected: state.selected }].slice(-HISTORY_LIMIT);
  return { done, selected, history };
}

// Marks a whole mission done (all its waypoints too) and points the button at
// the next mission that isn't done (null when the banner is done).
export function completeMission(route, state, missionIndex) {
  const mission = route.missions[missionIndex];
  if (!mission) {
    return state;
  }
  const keys = [missionKey(mission.id, mission.index), ...mission.waypoints.map((index) => route.waypoints[index].key)];
  const done = new Set(state.done);
  keys.forEach((key) => done.add(key));
  const next = nextOpenMission(route, done, missionIndex);
  const added = keys.filter((key) => !state.done.has(key));
  const selected = next >= 0 ? next : null;
  if (!added.length && selected === state.selected) {
    return state;
  }
  return {
    done,
    selected,
    history: [...state.history, { added, selected: state.selected }].slice(-HISTORY_LIMIT),
  };
}

// "Mission 4 done, open mission 5 in Ingress": marks the button's mission
// done and returns the new state plus the link of the mission to open now
// (null when that was the last one).
export function doneAndOpenNext(route, state) {
  const current = targetMissionIndex(route, state.done, state.selected);
  if (current < 0) {
    return { state, done: -1, next: null };
  }
  const nextState = completeMission(route, state, current);
  const nextIndex = targetMissionIndex(route, nextState.done, nextState.selected);
  return { state: nextState, done: current, next: nextIndex >= 0 ? ingressMissionLink(route, nextIndex) : null };
}

// Picks the mission the button opens (the number row or − / +).
export function selectMission(route, state, missionIndex) {
  const index = Math.max(0, Math.min(route.missions.length - 1, Math.round(missionIndex)));
  return Number.isFinite(index) && route.missions[index] ? { ...state, selected: index } : state;
}

// Takes back the last step (a ticked waypoint or a mission marked done). With
// no history (older saved progress) the last done waypoint in route order.
export function undoWalk(route, state) {
  if (state.history.length) {
    const last = state.history[state.history.length - 1];
    const done = new Set(state.done);
    last.added.forEach((key) => done.delete(key));
    return { done, selected: last.selected ?? null, history: state.history.slice(0, -1) };
  }
  const last = [...route.waypoints].reverse().find((waypoint) => state.done.has(waypoint.key));
  if (!last) {
    return state;
  }
  const done = new Set(state.done);
  done.delete(last.key);
  done.delete(missionKey(last.missionId, last.missionIndex));
  return { ...state, done };
}

// A point "meters" from "from" towards "to" (or "to" itself when it is closer).
// Straight line in degrees: fine over the tens of metres between waypoints.
export function moveToward(from, to, meters) {
  const distance = distanceMeters(from, to);
  if (distance === null || distance <= meters || distance === 0) {
    return { latitude: to.latitude, longitude: to.longitude };
  }
  const share = meters / distance;
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * share,
    longitude: from.longitude + (to.longitude - from.longitude) * share,
  };
}

// Where a simulated walk starts: about 125 m south-west of the next waypoint,
// so the distance visibly goes down.
export function simulationStart(route, done, missionIndex = null) {
  const index = nextWaypointIndex(route, done, null, missionIndex);
  const target = route.waypoints[index] ?? route.waypoints[0];
  if (!target) {
    return null;
  }
  return { latitude: target.latitude - 0.00078, longitude: target.longitude - 0.001 };
}

// One step of the simulated walk: "meters" towards the next waypoint.
export function simulateStep(route, done, position, meters) {
  const from = position ?? simulationStart(route, done);
  const index = nextWaypointIndex(route, done, from);
  if (!from || index < 0) {
    return from;
  }
  return moveToward(from, route.waypoints[index], meters);
}

// Progress per banner, on this device only.
function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const strings = (value) => (Array.isArray(value) ? value.filter((key) => typeof key === "string") : []);

export function loadWalkState(bannerId) {
  try {
    const raw = storage()?.getItem(WALK_PROGRESS_PREFIX + bannerId);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      done: new Set(strings(parsed?.done)),
      selected: Number.isInteger(parsed?.selected) && parsed.selected >= 0 ? parsed.selected : null,
      history: Array.isArray(parsed?.history)
        ? parsed.history
            .filter((entry) => entry && Array.isArray(entry.added))
            .map((entry) => ({ added: strings(entry.added), selected: Number.isInteger(entry.selected) ? entry.selected : null }))
            .slice(-HISTORY_LIMIT)
        : [],
    };
  } catch {
    return emptyWalkState();
  }
}

// Written straight away (not after a render), so it is saved before a tap
// navigates to Ingress.
export function saveWalkState(bannerId, state) {
  try {
    if (!state.done.size && state.selected === null && !state.history.length) {
      storage()?.removeItem(WALK_PROGRESS_PREFIX + bannerId);
      return;
    }
    storage()?.setItem(
      WALK_PROGRESS_PREFIX + bannerId,
      JSON.stringify({ done: [...state.done], selected: state.selected, history: state.history, updatedAt: Date.now() })
    );
  } catch {
    // Private mode or full storage: progress just isn't kept.
  }
}

export function loadWalkProgress(bannerId) {
  return loadWalkState(bannerId).done;
}

export function saveWalkProgress(bannerId, done) {
  saveWalkState(bannerId, { done, selected: null, history: [] });
}

// The banner page's Google Maps directions link (walking); Apple Maps on iPhone.
export function googleDirectionsUrl({ latitude, longitude }) {
  return "https://www.google.com/maps/dir/?api=1&destination=" + latitude + "," + longitude + "&travelmode=walking";
}

export function appleDirectionsUrl({ latitude, longitude }) {
  return "https://maps.apple.com/?daddr=" + latitude + "," + longitude + "&dirflg=w";
}

// What "Copy passphrase" copies at a waypoint, like the Overlay's card
// (Passphrases.java): the best live answer (the passphrase service lists the
// most confirmed first); none known: the mission number, marked as a guess.
// Nothing when it isn't a passphrase step or the authors opted out.
export function passphraseFor(waypoint, byStep, blocked = null) {
  if (!waypoint?.passphrase || (Array.isArray(blocked) ? blocked.length : blocked)) {
    return null;
  }
  const answers = byStep?.get?.(stepKey(waypoint.missionId, waypoint.stepIndex)) ?? [];
  const missionNumber = String(waypoint.missionIndex + 1);
  const best = answers.find(
    (answer) => answer?.status === "live" && (answer.kind === "number" || String(answer.answer ?? "").trim())
  );
  if (best) {
    return { text: best.kind === "number" ? missionNumber : String(best.answer).trim(), known: true };
  }
  return { text: missionNumber, known: false };
}

// Compass heading from a deviceorientation event: iOS gives
// webkitCompassHeading; Chrome on Android an absolute alpha
// (deviceorientationabsolute), counter-clockwise from north.
export function headingFromOrientation(event, screenAngle = 0) {
  if (!event) {
    return null;
  }
  if (Number.isFinite(event.webkitCompassHeading)) {
    return (event.webkitCompassHeading + screenAngle + 360) % 360;
  }
  if (event.absolute && Number.isFinite(event.alpha)) {
    return (360 - event.alpha + screenAngle + 360) % 360;
  }
  return null;
}
