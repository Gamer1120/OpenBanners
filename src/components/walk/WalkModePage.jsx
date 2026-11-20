import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useBannerPassphrases } from "../../passphraseApi";
import { buildIngressMissionUrl, formatLength } from "../../bannerDisplay";
import { copyText } from "../../inAppBrowser";
import { isIos, isRunningStandalone } from "../../pwaInstall";
import {
  appleDirectionsUrl,
  arrowRotation,
  bearingDegrees,
  buildWalkRoute,
  currentMissionIndex,
  distanceMeters,
  googleDirectionsUrl,
  HACK_RANGE_METERS,
  loadWalkProgress,
  nextWaypointIndex,
  normalizeVariant,
  passphraseFor,
  progressCounts,
  saveWalkProgress,
  simulateStep,
  tickInRange,
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
  const [done, setDone] = useState(() => loadWalkProgress(bannerId));
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

  useEffect(() => {
    setDone(loadWalkProgress(bannerId));
  }, [bannerId]);

  useEffect(() => {
    saveWalkProgress(bannerId, done);
  }, [bannerId, done]);

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
    const result = tickInRange(route, doneRef.current, position);
    if (result.ticked.length) {
      const last = route.waypoints.find((waypoint) => waypoint.key === result.ticked[result.ticked.length - 1]);
      setDone(result.done);
      pauseUntil.current = Date.now() + SIM_PAUSE_MS;
      showToast("✓ " + t("Waypoint done: {title}", { title: last?.title || "" }));
      navigator.vibrate?.(60);
    }
  }, [position, route, showToast]);

  // The simulated walk.
  useEffect(() => {
    if (mode !== "sim") {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (Date.now() < pauseUntil.current) {
        return;
      }
      setSimPosition((current) => simulateStep(route, doneRef.current, current, SIM_STEP_METERS));
    }, SIM_TICK_MS);
    return () => window.clearInterval(timer);
  }, [mode, route]);

  const nextIndex = nextWaypointIndex(route, done, position);
  const next = nextIndex >= 0 ? route.waypoints[nextIndex] : null;
  const missionIndex = currentMissionIndex(route, done);
  const mission = missionIndex >= 0 ? route.missions[missionIndex] : null;
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
    setDone((current) => new Set([...current, next.key]));
    showToast("✓ " + t("Waypoint done: {title}", { title: next.title }));
  };

  const undo = () => {
    const last = [...route.waypoints].reverse().find((waypoint) => done.has(waypoint.key));
    if (last) {
      setDone((current) => {
        const copy = new Set(current);
        copy.delete(last.key);
        return copy;
      });
    }
  };

  const reset = () => {
    if (window.confirm(t("Reset your walk progress for this banner?"))) {
      setDone(new Set());
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

export function IngressLink({ w, className = "wk-btn small ghost" }) {
  if (!w.mission?.id) {
    return null;
  }
  return (
    <a className={className} href={buildIngressMissionUrl(w.mission.id)} target="_blank" rel="noreferrer">
      {t("Open mission in Ingress")}
    </a>
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
  const { mode, setMode, gps, wake } = w;
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
      <div className="wk-demo-row">
        <span className={"wk-chip" + (wake === "on" ? " ok" : "")}>
          {wake === "on" ? t("Screen stays on") : wake === "unsupported" ? t("Screen may turn off (not supported here)") : t("Screen may turn off")}
        </span>
        <button type="button" className="wk-btn small ghost" onClick={w.undo} disabled={!w.done.size}>
          {t("Undo")}
        </button>
        <button type="button" className="wk-btn small ghost danger" onClick={w.reset} disabled={!w.done.size}>
          {t("Reset progress")}
        </button>
      </div>
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
        <span className="wk-top-sub">{t("Walk mode")} · {t("preview")}</span>
      </div>
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
      <h2>{t("Banner done!")}</h2>
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
      {w.next ? (
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
          <IngressLink w={w} />
        </>
      ) : (
        <Finished w={w} />
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
        <Finished w={w} />
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
          const complete = mission.waypoints.every((index) => w.done.has(w.route.waypoints[index].key));
          return (
            <span key={mission.index} className={"wk-c-dot" + (complete ? " done" : "") + (mission.index === w.mission.index ? " cur" : "")}>
              {mission.index + 1}
            </span>
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
      <ProgressBar w={w} />
      <IngressLink w={w} />
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
      <div className="wk-toast" role="status" aria-live="polite">
        {w.toast ? <span key={w.toast.id}>{w.toast.text}</span> : null}
      </div>
    </div>
  );
}
