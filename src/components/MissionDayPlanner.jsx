import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Add, ArrowDownward, DeleteOutline, ArrowUpward, Close, DragIndicator, EventNote, Layers, MyLocation, OpenInNew, Search, Share, SwapVert } from "@mui/icons-material";
import { BANNERGRESS_AUTH_REQUEST_EVENT, useBannergressAuth } from "../bannergressSync";
import { buildIngressMissionUrl, formatLength, getDistanceMeters } from "../bannerDisplay";
import BannerImage from "./BannerImage";
import {
  buildOverlayPlanIntentUrl,
  buildOverlayPlanLink,
  isAndroidUserAgent,
  watchAppLaunch,
  isOverlayMissingSearch,
  OVERLAY_FALLBACK_URL,
  withoutOverlayMissing,
} from "../overlayLink";
import { OverlayMissingDialog } from "./OverlayDownloadDialog";
import { detectInAppBrowser } from "../inAppBrowser";
import {
  createPlan,
  deletePlan,
  fetchActiveMissionDays,
  fetchBannerWithMissions,
  forgetPlan,
  missionsOf,
  orient,
  planPath,
  planUrl,
  readRecentPlans,
  searchBanners,
  usePlan,
} from "../missionPlans";
import PlanMap from "./PlanMap";
import { t, tn } from "../i18n";
import { onSyncedSettingsApplied } from "../settingsSyncState";
import "./MissionDayPlanner.css";

const MIN_QUERY = 2;

// Mission Day planner: /planner picks a banner (active Mission Days or search),
// /planner/:planId plans its missions. The overlay route comes later.
export default function MissionDayPlanner({ planId }) {
  return planId ? <PlanEditor planId={planId} /> : <PlannerStart />;
}

function BannerPickRow({ banner, onPick, busy }) {
  return (
    <li>
      <button type="button" className="li sl mdp-banner" onClick={() => onPick(banner)} disabled={busy}>
        <span className="mdp-thumb"><BannerImage banner={banner} mode="natural" /></span>
        <span className="txt">
          <span className="t">{(banner.title || t("Untitled")).trim()}</span>
          <span className="s">
            {banner.numberOfMissions != null ? tn("{count} mission", "{count} missions", banner.numberOfMissions) : t("? missions")}
            {banner.formattedAddress ? ` · ${banner.formattedAddress}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

function useBannerSearch(query) {
  const [state, setState] = useState({ status: "idle", banners: [] });
  useEffect(() => {
    if (query.trim().length < MIN_QUERY) {
      setState({ status: "idle", banners: [] });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading" }));
    const timer = window.setTimeout(() => {
      searchBanners(query).then(
        (banners) => !cancelled && setState({ status: "ready", banners }),
        () => !cancelled && setState({ status: "error", banners: [] })
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);
  return state;
}

function BannerSearch({ onPick, busy, autoFocus = false }) {
  const [query, setQuery] = useState("");
  const results = useBannerSearch(query);
  return (
    <div className="mdp-search">
      <label className="mdp-field">
        <Search fontSize="small" />
        <input
          type="search"
          value={query}
          placeholder={t("Search for a banner")}
          aria-label={t("Search for a banner")}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {results.status === "loading" && !results.banners.length ? <p className="small muted">{t("Searching…")}</p> : null}
      {results.status === "error" ? <p className="small pp-error">{t("Search didn’t work. Try again.")}</p> : null}
      {results.status === "ready" && !results.banners.length ? <p className="small muted">{t("No banners found.")}</p> : null}
      {results.banners.length ? (
        <ul className="ob-list" aria-label={t("Search results")}>
          {results.banners.map((banner) => (
            <BannerPickRow key={banner.id} banner={banner} onPick={onPick} busy={busy} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PlannerStart() {
  const navigate = useNavigate();
  const deletedTitle = useLocation().state?.planDeleted;
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [active, setActive] = useState({ status: "loading", banners: [] });
  const [recent, setRecent] = useState(readRecentPlans);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Plans opened on another device (settings sync).
  useEffect(() => onSyncedSettingsApplied(["recentPlans"], () => setRecent(readRecentPlans())), []);

  useEffect(() => {
    let cancelled = false;
    fetchActiveMissionDays().then(
      (banners) => !cancelled && setActive({ status: "ready", banners }),
      () => !cancelled && setActive({ status: "error", banners: [] })
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const start = (banner) => {
    if (!loggedIn) {
      window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT));
      return;
    }
    setBusy(true);
    setError("");
    createPlan({ banners: [banner.id], title: banner.title }).then(
      (plan) => navigate(planPath(plan.id)),
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };

  return (
    <div className="ob-page mdp">
      <h1 className="ob-h1">{t("Mission Day planner")}</h1>
      <p className="small muted">
        {t("Pick the missions you want to do, put them in your order and share the plan. Everyone with the link can change it.")}
        {loggedIn ? "" : ` ${t("Log in with Bannergress to start a plan.")}`}
      </p>
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
      {deletedTitle ? (
        <p className="small mdp-msg" role="status">{t("“{title}” was deleted.", { title: deletedTitle })}</p>
      ) : null}

      {recent.length ? (
        <section aria-labelledby="mdp-recent">
          <h2 className="ob-h2" id="mdp-recent">{t("Your plans")}</h2>
          <ul className="ob-list">
            {recent.map((entry) => (
              <li key={entry.id} className="mdp-recent">
                <Link className="li sl" to={planPath(entry.id)}>
                  <span className="lead">
                    <EventNote fontSize="small" />
                  </span>
                  <span className="txt">
                    <span className="t">{entry.title}</span>
                    <span className="s">
                      {tn("{count} mission planned", "{count} missions planned", entry.missions)}
                      {entry.readOnly ? ` · ${t("view only")}` : ""}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  className="icon-btn sl"
                  aria-label={t("Remove {plan} from this list", { plan: entry.title })}
                  title={t("Remove from this list (the plan itself stays)")}
                  onClick={() => {
                    forgetPlan(entry.id);
                    setRecent(readRecentPlans());
                  }}
                >
                  <Close fontSize="small" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="mdp-active">
        <h2 className="ob-h2" id="mdp-active">{t("Active Mission Days")}</h2>
        {active.status === "loading" ? <p className="small muted">{t("Loading…")}</p> : null}
        {active.status === "error" ? <p className="small muted">{t("Couldn’t load the Mission Days from Bannergress.")}</p> : null}
        {active.status === "ready" && !active.banners.length ? (
          <p className="small muted">{t("No Mission Day is on right now. Search for its banner instead.")}</p>
        ) : null}
        {active.banners.length ? (
          <ul className="ob-list" aria-label={t("Active Mission Days")}>
            {active.banners.map((banner) => (
              <BannerPickRow key={banner.id} banner={banner} onPick={start} busy={busy} />
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="mdp-find">
        <h2 className="ob-h2" id="mdp-find">{t("Find a banner")}</h2>
        <BannerSearch onPick={start} busy={busy} />
      </section>
    </div>
  );
}

function useBanners(bannerIds) {
  const [banners, setBanners] = useState({});
  const key = bannerIds.join("\n");
  useEffect(() => {
    let cancelled = false;
    for (const bannerId of bannerIds) {
      fetchBannerWithMissions(bannerId).then(
        (banner) => !cancelled && setBanners((current) => ({ ...current, [bannerId]: { status: "ready", banner, missions: missionsOf(banner) } })),
        (error) => !cancelled && setBanners((current) => ({ ...current, [bannerId]: { status: "error", error: error.message } }))
      );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return banners;
}

// Drag to reorder (mouse and touch): grab the handle, the row follows the
// pointer, the others make room, and dropping calls onDrop(from, to).
const EDGE_PX = 70;

function useDragSort(onDrop) {
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const targetIndex = (state, pageY) => {
    let to = state.from;
    state.mids.forEach((mid, index) => {
      if (index < state.from && pageY < mid) {
        to = Math.min(to, index);
      } else if (index > state.from && pageY > mid) {
        to = Math.max(to, index);
      }
    });
    return to;
  };

  const update = (pageY) => {
    const state = dragRef.current;
    if (!state) {
      return;
    }
    const next = { from: state.from, dy: pageY - state.startY, to: targetIndex(state, pageY), height: state.height };
    setDrag(next);
  };

  useEffect(() => {
    if (!drag) {
      return undefined;
    }
    // Scroll while the pointer is near the top or bottom of the screen.
    const timer = window.setInterval(() => {
      const state = dragRef.current;
      if (!state) {
        return;
      }
      const step = state.clientY < EDGE_PX ? -12 : state.clientY > window.innerHeight - EDGE_PX ? 12 : 0;
      if (step) {
        window.scrollBy(0, step);
        update(state.clientY + window.scrollY);
      }
    }, 16);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(drag)]);

  const handleProps = (index) => ({
    onPointerDown: (event) => {
      if (event.button !== 0 || !listRef.current) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rows = [...listRef.current.children];
      const rects = rows.map((row) => row.getBoundingClientRect());
      dragRef.current = {
        from: index,
        startY: event.clientY + window.scrollY,
        clientY: event.clientY,
        height: rects[index].height,
        mids: rects.map((rect) => rect.top + window.scrollY + rect.height / 2),
      };
      update(event.clientY + window.scrollY);
    },
    onPointerMove: (event) => {
      if (dragRef.current) {
        dragRef.current.clientY = event.clientY;
        update(event.clientY + window.scrollY);
      }
    },
    onPointerUp: (event) => {
      const state = dragRef.current;
      if (state) {
        const to = targetIndex(state, event.clientY + window.scrollY);
        dragRef.current = null;
        setDrag(null);
        if (to !== state.from) {
          onDrop(state.from, to);
        }
      }
    },
    onPointerCancel: () => {
      dragRef.current = null;
      setDrag(null);
    },
  });

  // Where each row is drawn while dragging.
  const rowStyle = (index) => {
    if (!drag) {
      return undefined;
    }
    if (index === drag.from) {
      return { transform: `translateY(${drag.dy}px)`, zIndex: 2, position: "relative" };
    }
    if (drag.from < index && index <= drag.to) {
      return { transform: `translateY(${-drag.height}px)`, transition: "transform 0.15s" };
    }
    if (drag.to <= index && index < drag.from) {
      return { transform: `translateY(${drag.height}px)`, transition: "transform 0.15s" };
    }
    return { transition: "transform 0.15s" };
  };

  return { listRef, handleProps, rowStyle, dragging: drag?.from ?? null };
}

// Your position, followed once you ask for it (or at once if the browser already allows it).
function useHere() {
  const [here, setHere] = useState(null);
  const [state, setState] = useState("off");
  const watchRef = useRef(null);
  const start = () => {
    if (!("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    if (watchRef.current !== null) {
      return;
    }
    setState("finding");
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setHere({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setState("on");
      },
      () => {
        setState("denied");
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 15000 }
    );
  };
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" }).then(
      (status) => status.state === "granted" && start(),
      () => {}
    );
    return () => watchRef.current !== null && navigator.geolocation.clearWatch(watchRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { here, state, start };
}

// The plan in the OpenBanners Overlay (Android): one route through the missions
// that aren't done yet, in this order; going on from a mission ticks it off here.
function OverlayStart({ plan }) {
  const location = useLocation();
  const navigate = useNavigate();
  // false or the OverlayMissingDialog reason ("missing", "noResponse", "inApp").
  const [missing, setMissing] = useState(false);
  const stopLaunchWatch = useRef(null);
  useEffect(() => () => stopLaunchWatch.current?.(), []);
  // Chrome came back via the intent's fallback (?overlay=missing): the app
  // isn't installed. Show the install dialog once and drop the parameter.
  useEffect(() => {
    if (!isOverlayMissingSearch(location.search)) {
      return;
    }
    setMissing("missing");
    navigate(
      { pathname: location.pathname, search: withoutOverlayMissing(location.search), hash: location.hash },
      { replace: true, state: location.state }
    );
  }, [location.search, location.pathname, location.hash, location.state, navigate]);
  const dialog = missing ? (
    <OverlayMissingDialog
      reason={missing}
      appLink={buildOverlayPlanLink(plan.id, window.location.origin)}
      onClose={() => setMissing(false)}
    />
  ) : null;
  // Same as the banner page: in-app browsers get the dialog first, and a link
  // that leaves the page in front for 3 s shows it too.
  const handleStart = (event) => {
    stopLaunchWatch.current?.();
    if (detectInAppBrowser()) {
      event.preventDefault();
      setMissing("inApp");
      return;
    }
    stopLaunchWatch.current = watchAppLaunch(() => setMissing("noResponse"), {
      onLateLaunch: () => setMissing((reason) => (reason === "noResponse" ? false : reason)),
    });
  };
  const open = plan.items.filter((item) => !item.done).length;
  if (!plan.items.length) {
    return dialog;
  }
  const android = isAndroidUserAgent(navigator.userAgent);
  const count = open || plan.items.length;
  // One sentence with the Overlay link in the middle.
  const [beforeLink, afterLink] = t(
    "On Android, open this plan in the {app} (or share the plan link with it) to walk it as one route; missions get ticked off here as you go."
  ).split("{app}");
  return (
    <div className="mdp-overlay">
      {dialog}
      {android ? (
        <a className="btn filled sl" href={buildOverlayPlanIntentUrl(plan.id, window.location.origin)} onClick={handleStart}>
          <Layers fontSize="small" />
          {t("Start in OpenBanners Overlay")}
        </a>
      ) : null}
      <span className="small muted">
        {android
          ? plan.readOnly
            ? tn("Follows the {count} mission still to do as one route.", "Follows the {count} missions still to do as one route.", count)
            : tn(
                "Follows the {count} mission still to do as one route and ticks it off here as you go.",
                "Follows the {count} missions still to do as one route and ticks them off here as you go.",
                count
              )
          : null}
        {android ? null : (
          <>
            {beforeLink}
            <a href={OVERLAY_FALLBACK_URL} target="_blank" rel="noopener noreferrer">OpenBanners Overlay</a>
            {afterLink}
          </>
        )}
      </span>
    </div>
  );
}

function MissionPicture({ mission }) {
  return <span className="mdp-mpic">{mission?.picture ? <img src={mission.picture} alt="" loading="lazy" /> : null}</span>;
}

function PlanEditor({ planId }) {
  const { status, plan, error, apply } = usePlan(planId);
  const navigate = useNavigate();
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const banners = useBanners(plan?.banners ?? []);
  const [addingBanner, setAddingBanner] = useState(false);
  const [title, setTitle] = useState(null);
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const location = useHere();
  const [flyRequest, setFlyRequest] = useState(0);
  const sort = useDragSort((from, to) => {
    const item = plan?.items[from];
    if (item) {
      setMessage("");
      apply([{ op: "move", missionId: item.missionId, index: to }]).catch((e) => setMessage(e.message));
    }
  });

  // Missions as walked in this plan (reversed ones turned around).
  const items = plan?.items;
  const missionById = useMemo(() => {
    const reversed = new Set((items ?? []).filter((item) => item.reversed).map((item) => item.missionId));
    const map = new Map();
    for (const [bannerId, entry] of Object.entries(banners)) {
      for (const mission of entry.missions ?? []) {
        map.set(mission.id, orient({ ...mission, bannerId, bannerTitle: entry.banner.title }, reversed.has(mission.id)));
      }
    }
    return map;
  }, [banners, items]);

  if (status === "loading") {
    return (
      <div className="ob-page mdp">
        <p className="small muted">{t("Loading the plan…")}</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="ob-page mdp">
        <h1 className="ob-h1">{t("Mission Day planner")}</h1>
        <div className="ob-alert bad" role="alert">{error}</div>
        <Link className="btn tonal sl" to="/planner">{t("Start a new plan")}</Link>
      </div>
    );
  }

  const run = (ops) => {
    setMessage("");
    apply(ops).catch((e) => setMessage(e.message));
  };
  const planned = new Set(plan.items.map((item) => item.missionId));
  const doneCount = plan.items.filter((item) => item.done).length;
  const steps = plan.items.map((item) => missionById.get(item.missionId));
  const gaps = steps.map((mission, index) => {
    const next = steps[index + 1];
    return mission?.end && next?.start ? getDistanceMeters(mission.end, next.start) : null;
  });
  const walk =
    steps.reduce((sum, mission) => sum + (mission?.lengthMeters ?? 0), 0) + gaps.reduce((sum, gap) => sum + (gap ?? 0), 0);

  const ro = plan.readOnly;
  // Two links: the edit link (anyone with it can change the plan) and the
  // read-only link (only looks). A read-only page can only pass on itself.
  const share = (readOnly) => {
    setSharing(false);
    const url = planUrl(readOnly ? plan.viewId : plan.id);
    if (navigator.share) {
      navigator
        .share({
          title: plan.title,
          text: readOnly
            ? t("{title} – Mission Day plan (view only)", { title: plan.title })
            : t("{title} – Mission Day plan", { title: plan.title }),
          url,
        })
        .catch(() => {});
      return;
    }
    navigator.clipboard.writeText(url).then(
      () =>
        setMessage(
          readOnly ? t("Read-only link copied. People with it can look, not change.") : t("Edit link copied. Everyone with it can change the plan.")
        ),
      () => setMessage(url)
    );
  };

  const saveTitle = () => {
    if (title !== null && title.trim() && title.trim() !== plan.title) {
      run([{ op: "title", title }]);
    }
    setTitle(null);
  };

  return (
    <div className="ob-page mdp">
      <div className="mdp-head">
        {ro ? (
          <h1 className="mdp-title ob-h1">{plan.title}</h1>
        ) : (
          <input
            className="mdp-title ob-h1"
            aria-label={t("Plan name")}
            value={title ?? plan.title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        )}
        <button
          type="button"
          className="btn filled sl"
          aria-expanded={ro ? undefined : sharing}
          onClick={() => (ro ? share(true) : setSharing((open) => !open))}
        >
          <Share fontSize="small" />
          {t("Share")}
        </button>
      </div>
      {sharing ? (
        <div className="mdp-share" role="group" aria-label={t("Share the plan")}>
          <button type="button" className="li sl" onClick={() => share(false)}>
            <span className="txt">
              <span className="t">{t("Edit link")}</span>
              <span className="s">{t("Everyone with it can change the plan")}</span>
            </span>
          </button>
          <button type="button" className="li sl" onClick={() => share(true)}>
            <span className="txt">
              <span className="t">{t("Read-only link")}</span>
              <span className="s">{t("People with it can look at the plan, not change it")}</span>
            </span>
          </button>
        </div>
      ) : null}
      <p className="small muted">
        {tn("{count} mission planned", "{count} missions planned", plan.items.length)}
        {doneCount ? ` · ${t("{count} done", { count: doneCount })}` : ""}
        {walk > 0 ? ` · ${t("about {length} including the walks between missions", { length: formatLength(walk) })}` : ""}.{" "}
        {ro ? t("You’re looking at a read-only link, so you can’t change this plan.") : t("Everyone with the edit link can change this plan.")}
      </p>
      {message ? <p className="small mdp-msg" role="status">{message}</p> : null}
      <OverlayStart plan={plan} />

      <section className="mdp-mapbox" aria-label={t("Map of the missions")}>
        <div className="mdp-map">
          <PlanMap
            missions={[...missionById.values()]}
            items={plan.items}
            here={location.here}
            flyRequest={flyRequest}
            onToggle={ro ? null : (mission) =>
              run([
                planned.has(mission.id)
                  ? { op: "remove", missionId: mission.id }
                  : { op: "add", bannerId: mission.bannerId, missionId: mission.id },
              ])
            }
          />
        </div>
        <div className="mdp-map-bar">
          <span className="small muted">
            <span className="mdp-key in" /> {t("in the plan")} <span className="mdp-key" /> {ro ? t("not") : t("not yet · tap a start to add it")}
          </span>
          <button
            type="button"
            className="btn tonal sl"
            onClick={() => {
              location.start();
              setFlyRequest((n) => n + 1);
            }}
          >
            <MyLocation fontSize="small" />
            {location.state === "finding" ? t("Finding you…") : t("Near me")}
          </button>
        </div>
        {location.state === "denied" ? (
          <p className="small muted">{t("Your browser didn’t share your location.")}</p>
        ) : null}
      </section>

      <section aria-labelledby="mdp-plan">
        <h2 className="ob-h2" id="mdp-plan">{ro ? t("Order") : t("Your order")}</h2>
        {!plan.items.length ? (
          <p className="small muted">
            {ro ? t("No missions planned yet.") : t("Add missions from the banners below. They show up here in the order you add them.")}
          </p>
        ) : (
          <ol className="mdp-plan" ref={sort.listRef}>
            {plan.items.map((item, index) => {
              const mission = missionById.get(item.missionId);
              return (
                <li
                  key={item.missionId}
                  className={`${item.done ? "done" : ""}${sort.dragging === index ? " dragging" : ""}`}
                  style={sort.rowStyle(index)}
                >
                  <div className="mdp-item">
                    {ro ? null : (
                      <span
                        className="mdp-handle"
                        title={t("Drag to move")}
                        aria-hidden="true"
                        {...sort.handleProps(index)}
                      >
                        <DragIndicator fontSize="small" />
                      </span>
                    )}
                    <span className="mdp-pos">{index + 1}</span>
                    <MissionPicture mission={mission} />
                    <span className="txt">
                      <span className="t" title={mission?.title}>{mission?.shortTitle ?? t("Loading…")}</span>
                      <span className="s">
                        {mission ? t("#{number} of {banner}", { number: mission.number, banner: mission.bannerTitle }) : ""}
                        {mission?.offline ? ` · ${t("offline")}` : ""}
                        {mission?.reversed ? ` · ${t("reversed")}` : ""}
                      </span>
                    </span>
                    <label className="mdp-done" title={t("Done")}>
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={ro}
                        aria-label={mission?.title ? t("Mark {mission} done", { mission: mission.title }) : t("Mark mission done")}
                        onChange={(event) => run([{ op: "done", missionId: item.missionId, done: event.target.checked }])}
                      />
                    </label>
                    <span className="mdp-tools">
                      <a
                        className="icon-btn sl"
                        href={buildIngressMissionUrl(item.missionId)}
                        aria-label={mission?.title ? t("Open {mission} in Ingress", { mission: mission.title }) : t("Open this mission in Ingress")}
                        title={t("Open in Ingress")}
                      >
                        <OpenInNew fontSize="small" />
                      </a>
                      {ro || !mission?.anyOrder ? null : (
                        <button
                          type="button"
                          className={`icon-btn sl${item.reversed ? " on" : ""}`}
                          aria-pressed={Boolean(item.reversed)}
                          aria-label={item.reversed ? t("Walk in the normal order") : t("Walk in reverse order")}
                          title={
                            item.reversed
                              ? t("Reversed: walked from the last portal to the first. Tap for the normal order.")
                              : t("Walk in reverse order (any-order mission)")
                          }
                          onClick={() => run([{ op: "reverse", missionId: item.missionId, reversed: !item.reversed }])}
                        >
                          <SwapVert fontSize="small" />
                        </button>
                      )}
                      {ro ? null : (
                        <>
                          <button
                            type="button"
                            className="icon-btn sl"
                            aria-label={t("Move up")}
                            data-arrow=""
                            disabled={index === 0}
                            onClick={() => run([{ op: "move", missionId: item.missionId, index: index - 1 }])}
                          >
                            <ArrowUpward fontSize="small" />
                          </button>
                          <button
                            type="button"
                            className="icon-btn sl"
                            aria-label={t("Move down")}
                            data-arrow=""
                            disabled={index === plan.items.length - 1}
                            onClick={() => run([{ op: "move", missionId: item.missionId, index: index + 1 }])}
                          >
                            <ArrowDownward fontSize="small" />
                          </button>
                          <button
                            type="button"
                            className="icon-btn sl"
                            aria-label={t("Take out of the plan")}
                            onClick={() => run([{ op: "remove", missionId: item.missionId }])}
                          >
                            <Close fontSize="small" />
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  {gaps[index] !== null && gaps[index] !== undefined && index < plan.items.length - 1 ? (
                    <span className="mdp-gap small muted">{t("↓ {length} to the next start", { length: formatLength(gaps[index]) })}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {plan.banners.map((bannerId) => {
        const entry = banners[bannerId];
        const missions = entry?.missions ?? [];
        const open = missions.filter((mission) => !planned.has(mission.id));
        const distanceTo = (mission) =>
          location.here && mission.start ? getDistanceMeters(location.here, mission.start) : null;
        const shown = location.here
          ? [...missions].sort((a, b) => (distanceTo(a) ?? Infinity) - (distanceTo(b) ?? Infinity))
          : missions;
        return (
          <section key={bannerId} className="mdp-source" aria-label={entry?.banner?.title ?? bannerId}>
            <div className="ob-sec-head">
              <h2 className="ob-h2">
                <Link to={`/banner/${encodeURIComponent(bannerId)}`}>{entry?.banner?.title ?? t("Loading…")}</Link>
              </h2>
              {ro ? null : (
                <span className="mdp-source-tools">
                  <button
                    type="button"
                    className="btn tonal sl"
                    disabled={!open.length}
                    onClick={() => run(open.map((mission) => ({ op: "add", bannerId, missionId: mission.id })))}
                  >
                    {t("Add all")}
                  </button>
                  <button
                    type="button"
                    className="btn text sl"
                    onClick={() => run([{ op: "removeBanner", bannerId }])}
                    title={t("Take this banner and its missions out of the plan")}
                  >
                    {t("Remove")}
                  </button>
                </span>
              )}
            </div>
            {entry?.status === "error" ? <p className="small pp-error">{entry.error}</p> : null}
            <ul className="mdp-missions">
              {shown.map((mission) => {
                const inPlan = planned.has(mission.id);
                return (
                  <li key={mission.id}>
                    <button
                      type="button"
                      className={`mdp-mission sl${inPlan ? " in" : ""}`}
                      aria-pressed={inPlan}
                      disabled={ro}
                      onClick={() =>
                        run([inPlan ? { op: "remove", missionId: mission.id } : { op: "add", bannerId, missionId: mission.id }])
                      }
                    >
                      <MissionPicture mission={mission} />
                      <span className="mdp-num">{mission.number}</span>
                      <span className="mdp-mt" title={mission.title}>{mission.shortTitle}</span>
                      {distanceTo(mission) !== null ? (
                        <span className="mdp-dist">{formatLength(distanceTo(mission))}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {ro ? null : (
        <section aria-label={t("Add a banner")}>
          {addingBanner ? (
            <>
              <div className="ob-sec-head">
                <h2 className="ob-h2">{t("Add a banner")}</h2>
                <button type="button" className="btn text sl" onClick={() => setAddingBanner(false)}>
                  {t("Done")}
                </button>
              </div>
              <BannerSearch
                autoFocus
                onPick={(banner) => {
                  run([{ op: "addBanner", bannerId: banner.id }]);
                  setAddingBanner(false);
                }}
              />
            </>
          ) : (
            <button type="button" className="btn tonal sl" onClick={() => setAddingBanner(true)}>
              <Add fontSize="small" />
              {t("Add another banner")}
            </button>
          )}
        </section>
      )}

      {ro || !loggedIn ? null : (
        <section className="mdp-delete" aria-label={t("Delete plan")}>
          {confirmDelete ? (
            <div className="ob-alert bad" role="alertdialog" aria-labelledby="mdp-delete-q">
              <p id="mdp-delete-q" className="small">
                {t("Delete “{title}” for everyone? People with a link can't open it any more. This can't be undone.", { title: plan.title })}
              </p>
              <div className="mdp-delete-actions">
                <button
                  type="button"
                  className="btn filled sl"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true);
                    setMessage("");
                    deletePlan(plan.id).then(
                      () => {
                        forgetPlan(plan.id);
                        navigate("/planner", { replace: true, state: { planDeleted: plan.title } });
                      },
                      (e) => {
                        setDeleting(false);
                        setConfirmDelete(false);
                        setMessage(e.message);
                      }
                    );
                  }}
                >
                  {t("Delete plan")}
                </button>
                <button type="button" className="btn text sl" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn text sl mdp-delete-btn" onClick={() => setConfirmDelete(true)}>
              <DeleteOutline fontSize="small" />
              {t("Delete plan")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
