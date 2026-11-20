import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useBannerPassphrases } from "../../passphraseApi";
import { formatLength } from "../../bannerDisplay";
import { copyText } from "../../inAppBrowser";
import { isIos, isRunningStandalone } from "../../pwaInstall";
import {
  addDone,
  appleDirectionsUrl,
  arrowRotation,
  bearingDegrees,
  buildWalkRoute,
  distanceMeters,
  doneAndOpenNext,
  emptyWalkState,
  googleDirectionsUrl,
  HACK_RANGE_METERS,
  ingressMissionLink,
  isBannerComplete,
  loadWalkState,
  missionComplete,
  nextWaypointIndex,
  normalizeVariant,
  passphraseFor,
  progressCounts,
  saveWalkState,
  selectMission,
  moveToward,
  simulationStart,
  targetMissionIndex,
  tickInRange,
  undoWalk,
  WALK_VARIANTS,
} from "../../walkMode";
import { useCompass, useContinuousAngle, useGpsPosition, useViewportCover, useWakeLock, useWalkBanner } from "./useWalk";
import { t, tk } from "../../i18n";
import "./walk.css";

// Map-first variant: Leaflet only loads with it.
const WalkMapVariant = lazy(() => import("./WalkMapVariant"));

// Simulated walk: SIM_STEP_METERS every SIM_TICK_MS (about 10× walking pace),
// with a short stop at each waypoint so the tick can be seen.
const SIM_TICK_MS = 400;
const SIM_STEP_METERS = 6;
const SIM_PAUSE_MS = 1400;

const OBJECTIVES = {
  hack: tk("Hack"),
  captureOrUpgrade: tk("Capture or upgrade"),
  createLink: tk("Create link"),
  createField: tk("Create field"),
  installMod: tk("Install mod"),
  takePhoto: tk("Take photo"),
  viewWaypoint: tk("View waypoint"),
  enterPassphrase: tk("Enter passphrase"),
};

export const objectiveLabel = (objective) => (OBJECTIVES[objective] ? t(OBJECTIVES[objective]) : t("Visit"));

const VARIANT_NAMES = { a: tk("Big arrow"), b: tk("Map"), c: tk("Steps list") };

// All state of a walk; the three variants only lay it out.
function useWalkSession(bannerId, banner) {
  const route = useMemo(() => buildWalkRoute(banner?.missions), [banner]);
  const [state, setStateRaw] = useState(() => loadWalkState(bannerId));
  const stateRef = useRef(state);
  // Every change is written to localStorage at once, before the next render,
  // so a tap that goes on to Ingress never loses it.
  const setState = useCallback(
    (update) => {
      const next = typeof update === "function" ? update(stateRef.current) : update;
      if (next !== stateRef.current) {
        stateRef.current = next;
        saveWalkState(bannerId, next);
        setStateRaw(next);
      }
      return next;
    },
    [bannerId]
  );
  const done = state.done;
  const [mode, setMode] = useState("off"); // off | gps | sim
  const [simPosition, setSimPosition] = useState(null);
  const [toast, setToast] = useState(null);
  const gps = useGpsPosition(mode === "gps");
  const compass = useCompass();
  const wake = useWakeLock(true);
  const position = mode === "sim" ? simPosition : mode === "gps" ? gps.position : null;
  const doneRef = useRef(done);
  doneRef.current = done;
  const pauseUntil = useRef(0);

  // Back from Ingress: the page may come from the back/forward cache or be
  // loaded again, so read the saved state again (pageshow), and whenever it
  // becomes visible.
  useEffect(() => {
    const reload = () => {
      const saved = loadWalkState(bannerId);
      stateRef.current = saved;
      setStateRaw(saved);
    };
    reload();
    const onVisible = () => document.visibilityState === "visible" && reload();
    window.addEventListener("pageshow", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bannerId]);

  // The mission the big button opens; the page guides you through its waypoints.
  const targetIndex = targetMissionIndex(route, done, state.selected);
  const targetRef = useRef(targetIndex);
  targetRef.current = targetIndex;

  const showToast = useCallback((text) => {
    setToast({ text, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Within hack range of the next waypoint: done (like the Overlay).
  useEffect(() => {
    if (!position || !route.waypoints.length) {
      return;
    }
    const result = tickInRange(route, doneRef.current, position, HACK_RANGE_METERS, targetRef.current);
    if (result.ticked.length) {
      const last = route.waypoints.find((waypoint) => waypoint.key === result.ticked[result.ticked.length - 1]);
      setState((current) => addDone(route, current, result.ticked));
      pauseUntil.current = Date.now() + SIM_PAUSE_MS;
      showToast("✓ " + t("Waypoint done: {title}", { title: last?.title || "" }));
      navigator.vibrate?.(60);
    }
  }, [position, route, showToast, setState]);

  // The simulated walk.
  useEffect(() => {
    if (mode !== "sim") {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (Date.now() < pauseUntil.current) {
        return;
      }
      setSimPosition((current) => {
        const from = current ?? simulationStart(route, doneRef.current, targetRef.current);
        const index = nextWaypointIndex(route, doneRef.current, from, targetRef.current);
        return index >= 0 && from ? moveToward(from, route.waypoints[index], SIM_STEP_METERS) : from;
      });
    }, SIM_TICK_MS);
    return () => window.clearInterval(timer);
  }, [mode, route]);

  const nextIndex = targetIndex >= 0 ? nextWaypointIndex(route, done, position, targetIndex) : -1;
  const next = nextIndex >= 0 ? route.waypoints[nextIndex] : null;
  const missionIndex = targetIndex;
  const mission = missionIndex >= 0 ? route.missions[missionIndex] : null;
  const complete = targetIndex < 0 && isBannerComplete(route, done);
  const missionData = banner && mission ? Object.values(banner.missions ?? {}).find((m) => m?.id === mission.id) : null;
  const distance = next ? distanceMeters(position, next) : null;
  const bearing = next ? bearingDegrees(position, next) : null;
  const rotation = arrowRotation(bearing, compass.heading);
  const counts = progressCounts(route, done);

  const hasPassphrases = route.waypoints.some((waypoint) => waypoint.passphrase);
  const passphrases = useBannerPassphrases(bannerId, Boolean(banner) && hasPassphrases);
  // The passphrase to offer belongs to the current mission, like the Overlay's
  // card (not to where you stand): the next waypoint's, else the mission's
  // first open passphrase step, else the one you just passed (you may still be
  // typing it in Ingress).
  const missionWaypoints = mission ? mission.waypoints.map((index) => route.waypoints[index]) : [];
  const passphraseWaypoint = next?.passphrase
    ? next
    : missionWaypoints.find((waypoint) => waypoint.passphrase && !done.has(waypoint.key)) ??
      missionWaypoints.find((waypoint) => waypoint.passphrase) ??
      null;
  const passphrase = passphraseFor(passphraseWaypoint, passphrases.byStep, passphrases.blocked);

  const copyPassphrase = async () => {
    if (!passphrase) {
      return;
    }
    const ok = await copyText(passphrase.text);
    showToast(ok ? t("Copied: {text}", { text: passphrase.text }) : t("Couldn't copy. Long-press to copy: {text}", { text: passphrase.text }));
  };

  const markNextDone = () => {
    if (!next) {
      return;
    }
    setState((current) => addDone(route, current, [next.key]));
    showToast("✓ " + t("Waypoint done: {title}", { title: next.title }));
  };

  // The Ingress button and "done, open next".
  const ingress = targetIndex >= 0 ? ingressMissionLink(route, targetIndex) : null;
  const targetDone = targetIndex >= 0 && missionComplete(route, done, targetIndex);
  const preview = targetIndex >= 0 ? doneAndOpenNext(route, state) : null;
  const nextIngress = preview?.next ?? null;

  // Same-tab navigation to link.ingress.com from the tap itself (no new tab),
  // so iOS universal links / Android app links can open the Ingress app.
  const openIngress = () => {
    saveWalkState(bannerId, stateRef.current);
  };

  // One tap: mark the button's mission done and open the next one. The link's
  // href already is the next mission, so the tap navigates on its own; the
  // state is saved before it leaves.
  const doneOpenNext = (event) => {
    const result = doneAndOpenNext(route, stateRef.current);
    if (result.done < 0) {
      event?.preventDefault?.();
      return;
    }
    const href = event?.currentTarget?.getAttribute?.("href");
    // Saved now; the page only re-renders after the tap has started the
    // navigation (a re-render first would change this link's href to the
    // mission after next before the browser follows it).
    stateRef.current = result.state;
    saveWalkState(bannerId, result.state);
    window.setTimeout(() => {
      setStateRaw(result.state);
      showToast("✓ " + t("Mission {number} done", { number: String(result.done + 1) }));
    }, 0);
    navigator.vibrate?.(40);
    if (!result.next) {
      event?.preventDefault?.();
    } else if (href && href !== result.next.url) {
      // The page changed under the tap (e.g. a waypoint ticked): go to the right one.
      event.preventDefault();
      window.location.assign(result.next.url);
    }
  };

  const pickMission = (index) => setState((current) => selectMission(route, current, index));

  const undo = () => setState((current) => undoWalk(route, current));

  const reset = () => {
    if (window.confirm(t("Reset your walk progress for this banner?"))) {
      setState(emptyWalkState());
      setSimPosition(null);
    }
  };

  const changeMode = (value) => {
    if (value === "sim") {
      setSimPosition(null);
    }
    setMode(value);
  };

  return {
    route,
    done,
    state,
    complete,
    ingress,
    targetDone,
    nextIngress,
    openIngress,
    doneOpenNext,
    pickMission,
    canUndo: state.history.length > 0 || done.size > 0,
    mode,
    setMode: changeMode,
    gps,
    compass,
    wake,
    position,
    next,
    mission,
    missionData,
    distance,
    bearing,
    rotation,
    counts,
    passphrase,
    passphraseWaypoint,
    passphrases,
    copyPassphrase,
    markNextDone,
    undo,
    reset,
    toast,
  };
}

export function Arrow({ rotation, size = 160, active = true, className = "" }) {
  const angle = useContinuousAngle(rotation);
  return (
    <div className={"wk-arrow " + className + (active ? "" : " idle")} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" style={{ transform: "rotate(" + angle + "deg)" }}>
        <circle cx="50" cy="50" r="47" className="wk-arrow-ring" />
        <path d="M50 10 L74 74 L50 61 L26 74 Z" className="wk-arrow-head" />
      </svg>
    </div>
  );
}

export function DistanceText({ w, className = "wk-dist" }) {
  if (!w.next) {
    return null;
  }
  if (w.distance === null) {
    return <span className={className + " muted"}>– m</span>;
  }
  const inRange = w.distance <= HACK_RANGE_METERS;
  return <span className={className + (inRange ? " in-range" : "")}>{formatLength(w.distance)}</span>;
}

// Where the arrow points from: the compass, or north-up without one.
export function CompassNote({ w }) {
  const { compass } = w;
  if (!w.position) {
    return <p className="wk-note">{t("Turn on GPS or simulate walking to see the distance and direction.")}</p>;
  }
  if (compass.status === "active") {
    return <p className="wk-note">{t("Arrow follows your phone's compass.")}</p>;
  }
  if (compass.status === "needsPermission") {
    return (
      <button type="button" className="wk-btn small tonal" onClick={compass.requestPermission}>
        {t("Enable compass")}
      </button>
    );
  }
  if (compass.status === "starting") {
    return <p className="wk-note">{t("Starting compass…")}</p>;
  }
  return <p className="wk-note">{compass.status === "denied" ? t("Compass not allowed: arrow points with north up.") : t("No compass: arrow points with north up.")}</p>;
}

export function NavigateButtons({ w, compact = false }) {
  if (!w.next) {
    return null;
  }
  const ios = isIos();
  const google = (
    <a className={"wk-btn " + (ios ? "tonal" : "primary") + (compact ? " small" : "")} href={googleDirectionsUrl(w.next)} target="_blank" rel="noreferrer">
      <span aria-hidden="true">➤</span> {ios ? t("Google Maps") : t("Navigate")}
    </a>
  );
  if (!ios) {
    return google;
  }
  return (
    <>
      <a className={"wk-btn primary" + (compact ? " small" : "")} href={appleDirectionsUrl(w.next)} target="_blank" rel="noreferrer">
        <span aria-hidden="true">➤</span> {t("Navigate")}
      </a>
      {google}
    </>
  );
}

export function PassphraseButton({ w, compact = false }) {
  if (!w.passphrase) {
    return null;
  }
  const loading = w.passphrases.status === "loading";
  return (
    <button type="button" className={"wk-btn " + (w.passphrase.known ? "accent" : "tonal") + (compact ? " small" : "")} onClick={w.copyPassphrase} disabled={loading}>
      <span aria-hidden="true">🔑</span>{" "}
      {w.passphrase.known
        ? t("Copy passphrase")
        : t("Copy mission number ({number})", { number: w.passphrase.text })}
    </button>
  );
}

export function PassphraseHint({ w }) {
  if (!w.passphrase) {
    return null;
  }
  return w.passphrase.known ? (
    <p className="wk-note">{t("Passphrase at this mission: {text}", { text: w.passphrase.text })}</p>
  ) : (
    <p className="wk-note">{t("No answer known yet: the mission number is only a guess.")}</p>
  );
}

// The main action of walk mode, at the bottom of every variant: open the
// mission in Ingress, and "done, open next" for when you come back.
// Plain links in the same tab (no target, no window.open): a normal tap on a
// link.ingress.com link is what lets iOS (universal link) and Android (app
// link) open the Ingress app instead of a web page.
function IngressDock({ w }) {
  const count = w.route.missions.length;
  if (w.complete) {
    return (
      <section className="wk-dock done" aria-label={t("Ingress")}>
        <div className="wk-dock-complete" role="status">
          <span className="wk-dock-flag" aria-hidden="true">🏁</span>
          <span>
            <strong>{t("Banner complete")}</strong>
            <br />
            {t("All {count} missions done.", { count: String(count) })}
          </span>
        </div>
        <div className="wk-dock-row">
          <MissionPicker w={w} />
          <button type="button" className="wk-btn small ghost" onClick={w.undo} disabled={!w.canUndo}>
            ↶ {t("Undo")}
          </button>
        </div>
      </section>
    );
  }
  const link = w.ingress;
  if (!link) {
    return null;
  }
  const label = t("Open mission {number} in Ingress", { number: String(link.number) });
  const next = w.nextIngress;
  return (
    <section className="wk-dock" aria-label={t("Ingress")}>
      <div className="wk-dock-row">
        <MissionPicker w={w} />
        <button type="button" className="wk-btn small ghost" onClick={w.undo} disabled={!w.canUndo}>
          ↶ {t("Undo")}
        </button>
      </div>
      {next ? (
        <a className="wk-btn wk-done-next" href={next.url} onClick={w.doneOpenNext} data-testid="walk-done-next">
          <span aria-hidden="true">✓</span>{" "}
          {t("Mission {done} done, open mission {next}", { done: String(link.number), next: String(next.number) })}
        </a>
      ) : (
        <button type="button" className="wk-btn wk-done-next" onClick={w.doneOpenNext} data-testid="walk-done-next">
          <span aria-hidden="true">✓</span> {t("Mission {number} done, banner complete", { number: String(link.number) })}
        </button>
      )}
      <a
        className={"wk-btn wk-ingress" + (w.targetDone ? " again" : "")}
        href={link.url}
        onClick={w.openIngress}
        aria-label={label + (link.title ? " · " + link.title : "")}
        data-testid="walk-open-ingress"
      >
        <span className="wk-ingress-main">
          {label}
          {w.targetDone ? <span className="wk-ingress-badge">✓ {t("done")}</span> : null}
        </span>
        {link.title ? <span className="wk-ingress-sub">{link.title}</span> : null}
      </a>
      <p className="wk-dock-fallback">
        {t("Ingress didn't open?")}{" "}
        <a href={link.intelUrl} target="_blank" rel="noreferrer">
          {t("Open on Intel")}
        </a>
      </p>
    </section>
  );
}

// Which mission the button opens: − / + and the number in between.
function MissionPicker({ w }) {
  const count = w.route.missions.length;
  const current = w.mission ? w.mission.index : -1;
  return (
    <div className="wk-picker" role="group" aria-label={t("Pick a mission")}>
      <button type="button" onClick={() => w.pickMission(current - 1)} disabled={current <= 0} aria-label={t("Previous mission")}>
        −
      </button>
      <span className="wk-picker-label">
        {current >= 0
          ? t("Mission {number} of {count}", { number: String(current + 1), count: String(count) })
          : t("{done}/{total} missions", { done: String(w.counts.missionsDone), total: String(count) })}
      </span>
      <button
        type="button"
        onClick={() => w.pickMission(current < 0 ? 0 : current + 1)}
        disabled={current >= count - 1}
        aria-label={t("Next mission")}
      >
        +
      </button>
    </div>
  );
}

// The picked mission has nothing left to walk to (all ticked, or no
// waypoints with a position): say so instead of a next waypoint.
export function NoOpenWaypoints({ w, noteOnly = false }) {
  if (!w.mission || w.next) {
    return null;
  }
  return (
    <div className={"wk-noopen" + (noteOnly ? " note-only" : "")}>
      {noteOnly ? null : (
        <>
          <p className="wk-mission">
            {t("Mission {number} of {count}", { number: String(w.mission.index + 1), count: String(w.route.missions.length) })}
          </p>
          <h2>{w.mission.title}</h2>
        </>
      )}
      <p className="wk-note">
        {w.targetDone
          ? t("This mission is done. Open it again in Ingress, or pick another mission below.")
          : t("No waypoints left to walk to here. Finish it in Ingress, then tap “done, open next” below.")}
      </p>
    </div>
  );
}

export function ProgressBar({ w }) {
  const { completed, total, missionsDone, missions } = w.counts;
  const share = total ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="wk-progress">
      <div className="wk-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
        <span style={{ width: share + "%" }} />
      </div>
      <span className="wk-progress-text">
        {t("{done} of {total} waypoints", { done: String(completed), total: String(total) })} ·{" "}
        {t("{done}/{total} missions", { done: String(missionsDone), total: String(missions) })}
      </span>
    </div>
  );
}

export function MissionLine({ w }) {
  if (!w.mission || !w.next) {
    return null;
  }
  const stepNumber = w.mission.waypoints.indexOf(w.next.index) + 1;
  return (
    <p className="wk-mission">
      {t("Mission {number} of {count}", { number: String(w.mission.index + 1), count: String(w.route.missions.length) })}
      {" · "}
      {t("Step {number} of {count}", { number: String(stepNumber), count: String(w.mission.waypoints.length) })}
      {w.mission.anyOrder ? " · " + t("any order") : ""}
    </p>
  );
}

// "Simulate walking" (demo), real GPS, or nothing; plus compass and wake lock state.
function DemoBar({ w }) {
  const { mode, setMode, gps } = w;
  let status = "";
  if (mode === "sim") {
    status = t("Demo: a fake position walks the route at about 10× walking speed.");
  } else if (mode === "gps") {
    status =
      gps.error === "denied"
        ? t("Location not allowed. Allow it in the browser's site settings.")
        : gps.error
          ? t("Location isn't available right now.")
          : gps.position
            ? t("GPS accuracy: ±{meters} m", { meters: String(Math.round(gps.accuracy ?? 0)) })
            : t("Waiting for GPS…");
  }
  return (
    <section className="wk-demo" aria-label={t("Position")}>
      <div className="wk-seg" role="group">
        <button type="button" aria-pressed={mode === "off"} onClick={() => setMode("off")}>
          {t("Off")}
        </button>
        <button type="button" aria-pressed={mode === "gps"} onClick={() => setMode("gps")}>
          {t("Use real GPS")}
        </button>
        <button type="button" aria-pressed={mode === "sim"} onClick={() => setMode("sim")}>
          {t("Simulate walking (demo)")}
        </button>
      </div>
      {status ? <p className="wk-note">{status}</p> : null}
    </section>
  );
}

function IosHint({ force }) {
  const [closed, setClosed] = useState(() => {
    try {
      return window.sessionStorage.getItem("openbanners-walk-ios-hint") === "closed";
    } catch {
      return false;
    }
  });
  const show = !closed && (force || (isIos() && !isRunningStandalone()));
  if (!show) {
    return null;
  }
  const close = () => {
    setClosed(true);
    try {
      window.sessionStorage.setItem("openbanners-walk-ios-hint", "closed");
    } catch {
      // ignore
    }
  };
  return (
    <aside className="wk-ios-hint" role="note">
      <span className="wk-ios-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 3l-4 4h3v8h2V7h3l-4-4zM6 10h2v9h8v-9h2v11H6V10z" /></svg>
      </span>
      <span>
        <strong>{t("Add to Home Screen")}</strong>
        <br />
        {t("On iPhone: tap Share, then “Add to Home Screen”, to walk banners full screen without Safari's bars.")}
      </span>
      <button type="button" className="wk-x" onClick={close} aria-label={t("Close")}>
        ×
      </button>
    </aside>
  );
}

function TopBar({ w, bannerId, banner, variant }) {
  const [search, setSearch] = useSearchParams();
  const pick = (value) => {
    const nextSearch = new URLSearchParams(search);
    nextSearch.set("variant", value);
    setSearch(nextSearch, { replace: true });
  };
  return (
    <header className="wk-top">
      <Link className="wk-back" to={"/banner/" + encodeURIComponent(bannerId)} aria-label={t("Back to the banner")}>
        ‹
      </Link>
      <div className="wk-top-title">
        <span className="wk-top-name">{banner?.title || t("Walk mode")}</span>
        <span className="wk-top-sub">
          {t("Walk mode")} · {t("preview")} ·{" "}
          <span className={w.wake === "on" ? "ok" : ""}>
            {w.wake === "on" ? t("Screen stays on") : w.wake === "unsupported" ? t("Screen may turn off (not supported here)") : t("Screen may turn off")}
          </span>
        </span>
      </div>
      <button
        type="button"
        className="wk-reset"
        onClick={w.reset}
        disabled={!w.canUndo && w.state.selected === null}
        aria-label={t("Reset progress")}
        title={t("Reset progress")}
      >
        ⟲
      </button>
      <div className="wk-variants" role="group" aria-label={t("Design")}>
        {WALK_VARIANTS.map((value) => (
          <button key={value} type="button" aria-pressed={variant === value} title={t(VARIANT_NAMES[value])} onClick={() => pick(value)}>
            {value.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}

function Finished({ w }) {
  return (
    <div className="wk-finished">
      <div className="wk-finished-badge" aria-hidden="true">✓</div>
      <h2>{t("Banner complete")}</h2>
      <p>{t("All {count} missions walked.", { count: String(w.route.missions.length) })}</p>
      <button type="button" className="wk-btn tonal" onClick={w.reset}>
        {t("Reset progress")}
      </button>
    </div>
  );
}

// A · One big card: the next waypoint, a large arrow and distance, big buttons.
function VariantA({ w }) {
  return (
    <main className="wk-a">
      <ProgressBar w={w} />
      {w.complete ? (
        <Finished w={w} />
      ) : !w.next ? (
        <NoOpenWaypoints w={w} />
      ) : (
        <>
          <MissionLine w={w} />
          <div className="wk-a-card">
            <Arrow rotation={w.rotation} size={184} active={Boolean(w.position)} />
            <DistanceText w={w} className="wk-a-dist" />
            <CompassNote w={w} />
            <h2 className="wk-a-title">{w.next.title || t("Waypoint")}</h2>
            <span className="wk-objective">{objectiveLabel(w.next.objective)}</span>
          </div>
          <div className="wk-actions">
            <PassphraseButton w={w} />
            <NavigateButtons w={w} />
            <button type="button" className="wk-btn ghost" onClick={w.markNextDone}>
              {t("Mark done")}
            </button>
          </div>
          <PassphraseHint w={w} />
        </>
      )}
    </main>
  );
}

// C · Steps list: the current mission as a timeline, the next step large.
function VariantC({ w }) {
  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.querySelector(".wk-c-step.next")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [w.next?.key]);
  if (!w.mission) {
    return (
      <main className="wk-c">
        <ProgressBar w={w} />
        {w.complete ? <Finished w={w} /> : null}
      </main>
    );
  }
  return (
    <main className="wk-c">
      <div className="wk-c-head">
        {w.missionData?.picture ? <img className="wk-c-pic" src={w.missionData.picture + "=s96"} alt="" /> : null}
        <div>
          <p className="wk-mission">
            {t("Mission {number} of {count}", { number: String(w.mission.index + 1), count: String(w.route.missions.length) })}
            {w.mission.anyOrder ? " · " + t("any order") : ""}
          </p>
          <h2 className="wk-c-mtitle">{w.mission.title}</h2>
        </div>
      </div>
      <div className="wk-c-missions" aria-label={t("Missions")}>
        {w.route.missions.map((mission) => {
          const complete = missionComplete(w.route, w.done, mission.index);
          return (
            <button
              type="button"
              key={mission.index}
              className={"wk-c-dot" + (complete ? " done" : "") + (mission.index === w.mission.index ? " cur" : "")}
              aria-pressed={mission.index === w.mission.index}
              aria-label={t("Mission {number}", { number: String(mission.index + 1) })}
              onClick={() => w.pickMission(mission.index)}
            >
              {mission.index + 1}
            </button>
          );
        })}
      </div>
      <ol className="wk-c-steps" ref={listRef}>
        {w.mission.waypoints.map((index, order) => {
          const waypoint = w.route.waypoints[index];
          const isDone = w.done.has(waypoint.key);
          const isNext = w.next?.key === waypoint.key;
          const distance = w.position ? distanceMeters(w.position, waypoint) : null;
          return (
            <li key={waypoint.key} className={"wk-c-step" + (isDone ? " done" : "") + (isNext ? " next" : "")}>
              <span className="wk-c-num" aria-hidden="true">{isDone ? "✓" : order + 1}</span>
              <div className="wk-c-body">
                <span className="wk-c-title">{waypoint.title || t("Waypoint")}</span>
                <span className="wk-c-sub">
                  {objectiveLabel(waypoint.objective)}
                  {waypoint.passphrase ? " · 🔑" : ""}
                  {!isDone && distance !== null && !isNext ? " · " + formatLength(distance) : ""}
                  {isDone ? " · " + t("done") : ""}
                </span>
                {isNext ? (
                  <div className="wk-c-next">
                    <div className="wk-c-nav">
                      <Arrow rotation={w.rotation} size={76} active={Boolean(w.position)} />
                      <div>
                        <DistanceText w={w} className="wk-c-dist" />
                        <CompassNote w={w} />
                      </div>
                    </div>
                    <div className="wk-actions row">
                      <PassphraseButton w={w} compact />
                      <NavigateButtons w={w} compact />
                      <button type="button" className="wk-btn small ghost" onClick={w.markNextDone}>
                        {t("Mark done")}
                      </button>
                    </div>
                    <PassphraseHint w={w} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {!w.next ? <NoOpenWaypoints w={w} noteOnly /> : null}
      <ProgressBar w={w} />
    </main>
  );
}

export default function WalkModePage() {
  const { bannerId } = useParams();
  const [search] = useSearchParams();
  const variant = normalizeVariant(search.get("variant"));
  useViewportCover();
  const data = useWalkBanner(bannerId);
  const w = useWalkSession(bannerId, data.banner);

  useEffect(() => {
    const previous = document.title;
    document.title = (data.banner?.title ? data.banner.title + " · " : "") + t("Walk mode") + " · OpenBanners";
    return () => {
      document.title = previous;
    };
  }, [data.banner?.title]);

  let body;
  if (data.status === "loading") {
    body = <p className="wk-center">{t("Loading banner…")}</p>;
  } else if (data.status !== "ready") {
    body = (
      <div className="wk-center">
        <p>{data.status === "notFound" ? t("This banner doesn’t exist (any more) on Bannergress.") : t("Couldn't load this banner.")}</p>
        {data.status === "error" ? (
          <button type="button" className="wk-btn tonal" onClick={data.retry}>
            {t("Retry")}
          </button>
        ) : null}
      </div>
    );
  } else if (!w.route.waypoints.length) {
    body = <p className="wk-center">{t("This banner has no waypoints to walk to.")}</p>;
  } else if (variant === "b") {
    body = (
      <Suspense fallback={<p className="wk-center">{t("Loading map…")}</p>}>
        <WalkMapVariant w={w} />
      </Suspense>
    );
  } else if (variant === "c") {
    body = <VariantC w={w} />;
  } else {
    body = <VariantA w={w} />;
  }

  return (
    <div className={"wk wk-v" + variant} data-variant={variant}>
      <TopBar w={w} bannerId={bannerId} banner={data.banner} variant={variant} />
      <IosHint force={search.get("hint") === "ios"} />
      <div className="wk-body">{body}</div>
      {data.status === "ready" && w.route.waypoints.length ? <DemoBar w={w} /> : null}
      {data.status === "ready" && w.route.missions.length ? <IngressDock w={w} /> : null}
      <div className="wk-toast" role="status" aria-live="polite">
        {w.toast ? <span key={w.toast.id}>{w.toast.text}</span> : null}
      </div>
    </div>
  );
}
