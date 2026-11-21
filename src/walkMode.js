// Walk mode (/banner/:id/walk; live since 2026-11-20, offered on iPhone/iPad
// instead of "Start with Overlay", see src/walkDevice.js). Michael: a player
// is in Ingress the whole time and only switches to the browser for a few seconds; Ingress
// already shows the map, portals, steps and progress. So walk mode is one
// screen with one huge button, "Open mission N", which copies the mission's
// passphrase and opens the mission in Ingress in the same tap. Coming back,
// the button is the next mission, and a mission with several passphrases
// shows its answers to copy (you come back mid-mission for the second one).
// This file is the pure logic; the page is src/components/walk/.
import { getMissionList } from "./bannerMissions";
import { isRequiredPassphraseStep } from "./bannerFacts";
import { buildIngressMissionUrl } from "./bannerDisplay";

export const WALK_STATE_PREFIX = "openbanners-walk:";
// The Navigate button only shows when the mission starts further away than this.
export const NAVIGATE_MIN_METERS = 1000;
// How long a tap waits for the clipboard before it opens Ingress anyway.
export const CLIPBOARD_TIMEOUT_MS = 600;
// A tap before the passphrase answers have loaded waits this long for them.
export const PASSPHRASE_WAIT_MS = 1000;
const HISTORY_LIMIT = 30;

export const stepKey = (missionId, stepIndex) => missionId + ":" + stepIndex;

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

// The banner's missions in banner order (filler slots left out), numbered
// 1…n like the banner page, with where each starts and its passphrase steps.
export function buildWalkMissions(missionsByPosition) {
  return getMissionList(missionsByPosition).map((mission, index) => {
    const steps = Array.isArray(mission?.steps) ? mission.steps : Object.values(mission?.steps ?? {});
    let start = null;
    const passphrases = [];
    steps.forEach((step, stepIndex) => {
      start = start ?? positionOf(step);
      // Not passphrases on deleted portals: Ingress skips those waypoints, so
      // the button copies the first passphrase still asked for.
      if (isRequiredPassphraseStep(step)) {
        passphrases.push({ stepIndex, title: step?.poi?.title || "" });
      }
    });
    return {
      index,
      number: index + 1,
      id: mission?.id ?? "m" + index,
      title: mission?.title || "",
      start,
      passphrases,
      url: mission?.id ? buildIngressMissionUrl(mission.id) : null,
    };
  });
}

// The answer for one passphrase step, like the Overlay's card
// (Passphrases.java): the best live answer (the passphrase service lists the
// best first): { text, known: true }. None known: { text: null, known: false,
// guess: <mission number> }; no guess either when the authors opted out.
export function passphraseAnswer(mission, stepIndex, byStep, blocked = null) {
  const optedOut = Array.isArray(blocked) ? blocked.length > 0 : Boolean(blocked);
  if (optedOut) {
    return { text: null, known: false, guess: null };
  }
  const answers = byStep?.get?.(stepKey(mission.id, stepIndex)) ?? [];
  const best = answers.find(
    (answer) => answer?.status === "live" && (answer.kind === "number" || String(answer.answer ?? "").trim())
  );
  if (best) {
    return { text: best.kind === "number" ? String(mission.number) : String(best.answer).trim(), known: true, guess: null };
  }
  return { text: null, known: false, guess: String(mission.number) };
}

// Every passphrase of a mission with its answer, in step order.
export function missionPassphrases(mission, byStep, blocked = null) {
  if (!mission) {
    return [];
  }
  return mission.passphrases.map((entry, order) => ({
    ...entry,
    order,
    ...passphraseAnswer(mission, entry.stepIndex, byStep, blocked),
  }));
}

// What the big button copies: the mission's only (or first) passphrase, when
// its answer is known. Never a guess, never a later passphrase.
export function passphraseToCopy(passphrases) {
  const first = passphrases?.[0];
  return first?.known ? first.text : null;
}

// ---------------------------------------------------------------------------
// State, per banner on this device: { current, done, pick, history }.
// current = id of the mission last opened (in progress); done = ids of the
// missions done; pick = id picked in the menu for the big button (null: the
// next one); history = earlier states, for Undo.

export function emptyWalkState() {
  return { current: null, done: new Set(), pick: null, history: [] };
}

const indexOf = (missions, id) => (id === null || id === undefined ? -1 : missions.findIndex((mission) => mission.id === id));

// The mission the big button opens (an index), -1 when the banner is done:
// the picked one, else the first mission after the one in progress that
// isn't done, else an earlier one that isn't done (skipped).
export function targetMissionIndex(missions, state) {
  const picked = indexOf(missions, state.pick);
  if (picked >= 0) {
    return picked;
  }
  const current = indexOf(missions, state.current);
  const open = (index) => index !== current && !state.done.has(missions[index].id);
  for (let index = current + 1; index < missions.length; index += 1) {
    if (open(index)) {
      return index;
    }
  }
  for (let index = 0; index < Math.min(current + 1, missions.length); index += 1) {
    if (open(index)) {
      return index;
    }
  }
  return -1;
}

export const currentMissionIndex = (missions, state) => indexOf(missions, state.current);

export function isBannerComplete(missions, state) {
  return missions.length > 0 && targetMissionIndex(missions, state) < 0;
}

// Every mission done (or the last one opened), whatever − / + picked: the
// complete screen shows when nothing is picked.
export function isWalkFinished(missions, state) {
  return isBannerComplete(missions, { ...state, pick: null });
}

// "4 of 18 done": the done missions; once the banner is complete the one
// opened last counts too (also while − / + picked a mission to redo).
export function doneCount(missions, state) {
  const complete = isWalkFinished(missions, state);
  return missions.filter((mission) => state.done.has(mission.id) || (complete && mission.id === state.current)).length;
}

const snapshot = (state) => ({ current: state.current, done: [...state.done], pick: state.pick });
const withHistory = (state, next) => ({ ...next, history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT) });

// Opening mission N: N is in progress; every mission before it and the one
// that was in progress are done.
export function openMission(missions, state, index) {
  const mission = missions[index];
  if (!mission) {
    return state;
  }
  const done = new Set(state.done);
  missions.slice(0, index).forEach((before) => done.add(before.id));
  if (state.current !== null && state.current !== mission.id && indexOf(missions, state.current) >= 0) {
    done.add(state.current);
  }
  done.delete(mission.id);
  return withHistory(state, { current: mission.id, done, pick: null });
}

// The − / + buttons above the big button: the big button opens the previous /
// next mission instead. Only the target changes (no done marks, no Undo
// entry); opening a mission clears the pick again.
export function pickMission(missions, state, index) {
  const mission = missions[index];
  return mission ? { ...state, done: new Set(state.done), pick: mission.id } : state;
}

// "Start walk mode from here" on the banner page (/banner/:id/walk?from=N,
// N 1-based as listed): the big button opens mission N, like pressing + N−1
// times. Only the pick changes: no mission is marked done, and saved progress
// (done marks, the mission in progress, Undo) is kept. Anything that isn't a
// mission number of this banner leaves the state as it is.
export function parseFromMission(value) {
  const text = String(value ?? "").trim();
  return /^[1-9][0-9]{0,4}$/.test(text) ? Number(text) : null;
}

export function startAtMission(missions, state, number) {
  const index = Number.isInteger(number) ? number - 1 : -1;
  if (index < 0 || index >= missions.length || targetMissionIndex(missions, state) === index) {
    return state;
  }
  return pickMission(missions, state, index);
}

// − (step -1) / + (step 1) from the mission the big button opens now; stays
// put at the first / last mission. Once the banner is complete, the complete
// screen counts as the place after the last mission: − there picks the last
// mission, + from the last mission goes back to the complete screen.
export function stepTarget(missions, state, step) {
  const from = targetMissionIndex(missions, state);
  if (from < 0) {
    return step < 0 && missions.length > 0 ? pickMission(missions, state, missions.length - 1) : state;
  }
  const index = from + step;
  if (index >= missions.length && isWalkFinished(missions, state)) {
    return { ...state, done: new Set(state.done), pick: null };
  }
  if (index < 0 || index >= missions.length) {
    return state;
  }
  return pickMission(missions, state, index);
}

// Whether − / + would move anything (else the button is disabled).
export const canStepTarget = (missions, state, step) => stepTarget(missions, state, step) !== state;

export function undoWalk(state) {
  const last = state.history[state.history.length - 1];
  if (!last) {
    return state;
  }
  return { current: last.current, done: new Set(last.done), pick: last.pick, history: state.history.slice(0, -1) };
}

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
const idOrNull = (value) => (typeof value === "string" ? value : null);

export function loadWalkState(bannerId) {
  try {
    const parsed = JSON.parse(storage()?.getItem(WALK_STATE_PREFIX + bannerId) || "null");
    if (!parsed || typeof parsed !== "object") {
      return emptyWalkState();
    }
    return {
      current: idOrNull(parsed.current),
      done: new Set(strings(parsed.done)),
      pick: idOrNull(parsed.pick),
      history: Array.isArray(parsed.history)
        ? parsed.history
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => ({ current: idOrNull(entry.current), done: strings(entry.done), pick: idOrNull(entry.pick) }))
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
    if (state.current === null && !state.done.size && state.pick === null && !state.history.length) {
      storage()?.removeItem(WALK_STATE_PREFIX + bannerId);
      return;
    }
    storage()?.setItem(
      WALK_STATE_PREFIX + bannerId,
      JSON.stringify({ ...snapshot(state), history: state.history, updatedAt: Date.now() })
    );
  } catch {
    // Private mode or full storage: progress just isn't kept.
  }
}

// ---------------------------------------------------------------------------
// The tap on "Open mission N", in this order: (1) start writing the answer to
// the clipboard (inside the tap, so the browser allows it), (2) save the
// state, (3) wait for the clipboard (writeClipboard gives up after
// CLIPBOARD_TIMEOUT_MS), (4) go to the Ingress link in the same tab.
// Returns { state, copied } (copied = the text, or null).
//
// Tapped before the passphrase answers have loaded: pass `waitForPassphrases`
// (a promise of the mission's passphrases once loaded, or null when they
// didn't arrive in time) instead of `passphrases`, plus `writeClipboardLater`.
// The clipboard write is still started inside the tap (Safari only allows
// it there) with the text to follow; nothing is copied when the answer turns
// out unknown or doesn't arrive (never the guess).
export async function openMissionTap({
  missions,
  state,
  index,
  passphrases,
  waitForPassphrases = null,
  writeClipboard: write,
  writeClipboardLater: writeLater = writeClipboardLater,
  save,
  navigate,
}) {
  const mission = missions[index];
  if (!mission?.url) {
    return { state, copied: null };
  }
  let copying = null;
  let pendingText = null;
  if (waitForPassphrases) {
    pendingText = Promise.resolve(waitForPassphrases).then(
      (loaded) => passphraseToCopy(loaded),
      () => null
    );
    copying = writeLater(pendingText);
  } else {
    const text = passphraseToCopy(passphrases);
    pendingText = Promise.resolve(text);
    copying = text ? write(text) : null;
  }
  const next = openMission(missions, state, index);
  save(next);
  const copied = copying && (await copying) ? await pendingText : null;
  navigate(mission.url);
  return { state: next, copied };
}

function legacyCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

// navigator.clipboard.writeText, called synchronously (inside the tap's user
// activation) and resolved after at most timeoutMs (false then); the old
// execCommand way when the Clipboard API is missing or refuses.
export function writeClipboard(text, timeoutMs = CLIPBOARD_TIMEOUT_MS) {
  let writing = null;
  try {
    writing = navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : null;
  } catch {
    writing = null;
  }
  if (!writing) {
    return Promise.resolve(legacyCopy(text));
  }
  return Promise.race([
    Promise.resolve(writing).then(
      () => true,
      () => legacyCopy(text)
    ),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

// The same, for a text that is still on its way (a promise of the text, or of
// null = copy nothing). Where the browser has ClipboardItem, the write starts
// now, inside the tap, with a promised blob (Safari's way to keep the user
// activation across a wait); otherwise (or when that write is refused) the
// text is written once it is there. Resolves true/false after at most
// waitMs + timeoutMs.
export function writeClipboardLater(textPromise, waitMs = PASSPHRASE_WAIT_MS, timeoutMs = CLIPBOARD_TIMEOUT_MS) {
  const text = Promise.resolve(textPromise).then(
    (value) => (typeof value === "string" && value ? value : null),
    () => null
  );
  const plainWrite = () => text.then((value) => (value ? writeClipboard(value, timeoutMs) : false));
  let writing = null;
  try {
    if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
      const blob = text.then((value) => {
        if (!value) {
          throw new Error("No passphrase to copy");
        }
        return new Blob([value], { type: "text/plain" });
      });
      blob.catch(() => {});
      writing = navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    }
  } catch {
    writing = null;
  }
  const done = writing
    ? Promise.resolve(writing).then(
        () => text.then((value) => Boolean(value)),
        // Refused (or nothing to copy): try the plain way once the text is there.
        () => plainWrite()
      )
    : plainWrite();
  return Promise.race([done, new Promise((resolve) => setTimeout(() => resolve(false), waitMs + timeoutMs))]);
}

// ---------------------------------------------------------------------------
// Distance to where a mission starts (straight line).
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

// The Navigate button: only when the mission starts more than 1 km away.
export function navigateTarget(mission, position) {
  const distance = distanceMeters(position, mission?.start);
  return distance !== null && distance > NAVIGATE_MIN_METERS ? { distance, start: mission.start } : null;
}

// The banner page's Google Maps directions link (walking); Apple Maps on iPhone.
export function googleDirectionsUrl({ latitude, longitude }) {
  return "https://www.google.com/maps/dir/?api=1&destination=" + latitude + "," + longitude + "&travelmode=walking";
}

export function appleDirectionsUrl({ latitude, longitude }) {
  return "https://maps.apple.com/?daddr=" + latitude + "," + longitude + "&dirflg=w";
}
