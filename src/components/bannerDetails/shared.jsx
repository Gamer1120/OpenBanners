import { Link, useParams } from "react-router-dom";
import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Skeleton, useMediaQuery } from "@mui/material";
import {
  CloudOff,
  Event as EventIcon,
  ExpandMore,
  FitScreen,
  FormatListNumbered,
  HourglassTop,
  Key,
  MyLocation,
  OpenInFull,
  OpenInNew,
  Place,
  Warning,
} from "@mui/icons-material";
import BannergressListActions from "../BannergressListActions";
import {
  fetchBannergress,
  getBannerListType,
  isBannergressAuthSupportedOrigin,
  useBannergressSync,
} from "../../bannergressSync";
import { applyPageMetadata, buildBannerMetadata, resetPageMetadata } from "../../seo";
import { getBrowseStateScope, resetBrowseState } from "../../browseState";
import {
  buildGeoUrl,
  buildIngressMissionUrl,
  buildIntelMissionUrl,
  formatLength,
  getMissionsPerKm,
} from "../../bannerDisplay";
import BannerImage from "../BannerImage";
import SimpleMarkdown from "./SimpleMarkdown";
import { WaypointAnswer } from "./Passphrases";
import { useBannerPassphrases } from "../../passphraseApi";
import {
  formatEvent,
  formatMissionNumbers,
  listJoins,
  getActionCounts,
  getLastChecked,
  getMissionTypes,
  getPassphraseMissions,
  getStartToFinishMeters,
  getTotalDurationMs,
  getUniquePortals,
  isPassphraseStep,
  MISSION_TYPE_LABELS,
  plannedOfflineTone,
} from "../../bannerFacts";
import { getLanguage, t, tk, tn } from "../../i18n";
import { getMissionEntries, getSlotCount } from "../../bannerMissions";
import MissionMosaic, { hasMissionPictures } from "./MissionMosaic";
import { getPanTiming, HERO_ROWS } from "./artViewer";

// Leaflet comes with the map only (RouteMap.jsx); the artwork viewer when it opens.
const RouteMap = lazy(() => import("./RouteMap"));
const BannerViewer = lazy(() => import("./BannerViewer"));

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
// Checkered flag (Material "sports_score"), inline so it doesn't depend on emoji fonts.
export const FINISH_FLAG_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6H9V4h2v2zm4-2h-2v2h2V4zM9 14h2v-2H9v2zm10-4V8h-2v2h2zm0 4v-2h-2v2h2zm-6 0h2v-2h-2v2zm6-10h-2v2h2V4zm-6 4V6h-2v2h2zM7 10V8h2V6H7V4H5v16h2v-8h2v-2H7zm8 2h2v-2h-2v2zm-4-2v2h2v-2h-2zM9 8v2h2V8H9zm4 2h2V8h-2v2zm2-4v2h2V6h-2z"/></svg>';
// Within ~15 m counts as "the same spot" for the finish marker.
const SAME_SPOT_DEGREES = 0.00015;

export function missionColors(count) {
  return Array.from({ length: count }, (_, index) =>
    `hsl(${Math.round((index * 300) / Math.max(1, count))}, 80%, 42%)`
  );
}

export function getSteps(mission) {
  return Object.values(mission?.steps ?? {});
}

export function getStepPosition(step) {
  const latitude = Number(step?.poi?.latitude);
  const longitude = Number(step?.poi?.longitude);

  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? [latitude, longitude]
    : null;
}

export function formatDuration(milliseconds) {
  const minutes = Math.round(Number(milliseconds) / 60000);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  return minutes < 60
    ? t("{minutes} min", { minutes })
    : t("{hours} h {minutes} min", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function isMissionOffline(mission) {
  return typeof mission?.status === "string" && mission.status !== "published";
}

export function getBannerAuthors(missions) {
  const seenAuthors = new Set();

  return missions.flatMap((mission) => {
    const name = typeof mission?.author?.name === "string" ? mission.author.name.trim() : "";

    if (!name) {
      return [];
    }

    const faction =
      typeof mission?.author?.faction === "string" ? mission.author.faction.trim() : "";
    const key = `${name.toLowerCase()}::${faction.toLowerCase()}`;

    if (seenAuthors.has(key)) {
      return [];
    }

    seenAuthors.add(key);
    return [{ name, faction }];
  });
}

export function isOnStartMarker([latitude, longitude], missionPositions) {
  return missionPositions.some(
    (positions) =>
      positions[0] &&
      Math.abs(positions[0][0] - latitude) < SAME_SPOT_DEGREES &&
      Math.abs(positions[0][1] - longitude) < SAME_SPOT_DEGREES
  );
}

export function getFinish(missions) {
  for (let missionIndex = missions.length - 1; missionIndex >= 0; missionIndex -= 1) {
    const steps = getSteps(missions[missionIndex]);

    for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = steps[stepIndex];
      const position = getStepPosition(step);

      if (position && step?.poi?.type !== "unavailable") {
        return { position, title: step?.poi?.title || t("Last portal"), missionIndex, stepIndex };
      }
    }
  }

  return null;
}

// The artwork is MissionMosaic.jsx; re-exported for the banner page's other modules.
export { MissionMosaic };

// The hero's artwork window: tiles fill the width (up to 56 px) and at most HERO_ROWS rows
// show; a taller banner pans slowly through all its rows (Bannergress's loop, 5 s per
// window height down), the same rule for every banner. The viewer shows it all.
function PanningArt({ rows, children }) {
  const windowRef = useRef(null);

  useLayoutEffect(() => {
    const box = windowRef.current;
    const inner = box?.firstElementChild;

    if (!box || !inner) {
      return undefined;
    }

    let animation = null;
    let lastWidth = -1;
    const setup = () => {
      const width = box.clientWidth;

      if (width === lastWidth) {
        return;
      }

      lastWidth = width;
      animation?.cancel();
      animation = null;
      box.classList.remove("pan");
      box.style.height = "";
      const cellHeight = inner.firstElementChild?.getBoundingClientRect().height || 0;

      if (!cellHeight) {
        lastWidth = -1;
        return;
      }

      const gap = parseFloat(window.getComputedStyle(inner).rowGap) || 0;
      const visible = Math.min(rows, HERO_ROWS);
      const height = visible * cellHeight + (visible - 1) * gap;
      const overflow = inner.getBoundingClientRect().height - height;

      if (overflow < 2) {
        return;
      }

      box.style.height = `${height}px`;
      box.classList.add("pan");

      if (typeof inner.animate !== "function") {
        return;
      }

      const { down, up, pause, total } = getPanTiming(overflow, height);
      const end = `translateY(${-overflow}px)`;
      animation = inner.animate(
        [
          { transform: "translateY(0)", easing: "ease-in-out" },
          { transform: end, offset: down / total, easing: "ease-in-out" },
          { transform: end, offset: (down + pause) / total, easing: "ease-in-out" },
          { transform: "translateY(0)", offset: (down + pause + up) / total },
          { transform: "translateY(0)" },
        ],
        { duration: total, iterations: Infinity }
      );
    };

    // Pause while a mouse is over it (not on touch screens, where hover sticks).
    const onEnter = (event) => event.pointerType === "mouse" && animation?.pause();
    const onLeave = () => animation?.play();
    setup();
    box.addEventListener("pointerenter", onEnter);
    box.addEventListener("pointerleave", onLeave);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(setup);
    observer?.observe(box);

    return () => {
      observer?.disconnect();
      box.removeEventListener("pointerenter", onEnter);
      box.removeEventListener("pointerleave", onLeave);
      animation?.cancel();
    };
  }, [rows]);

  return (
    <span className="bp-art-window" ref={windowRef}>
      {children}
    </span>
  );
}

// Tappable artwork that opens the full-screen viewer.
export function EnlargeableArt({ banner, missions, slots, colors, children }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="bp-enlarge"
        aria-label={t("Enlarge banner artwork")}
        onClick={() => setOpen(true)}
      >
        <span className="bp-enlarge-art">
          {children}
          <span className="bp-enlarge-chip" aria-hidden="true">
            <OpenInFull />
          </span>
        </span>
      </button>
      {open ? (
        <Suspense fallback={null}>
          <BannerViewer
            banner={banner}
            missions={missions}
            slots={slots}
            colors={colors}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}

// The hero artwork: the mission tiles in a panning window, or the banner's own picture
// when there are no mission pictures.
export function HeroMosaic({ banner, missions, slots, colors }) {
  const columns = Number(banner.width) || 6;
  const missionSlots =
    Array.isArray(slots) && slots.length === missions.length ? slots : missions.map((_, index) => index);
  const rows = Math.max(1, Math.ceil(Math.max(1, getSlotCount(missionSlots)) / columns));

  if (!hasMissionPictures(missions)) {
    return (
      <BannerImage
        banner={banner}
        mode="pan"
        minAspect={columns / HERO_ROWS}
        className="bp-hero-cpic"
        eager
      />
    );
  }

  return (
    <PanningArt rows={rows}>
      <MissionMosaic banner={banner} missions={missions} slots={slots} colors={colors} />
    </PanningArt>
  );
}

export function MissionItem({ mission, index, color, selected, expanded, onToggle, itemRef, showType = false, renderAnswer = null }) {
  const steps = getSteps(mission);
  const typeLabel = showType && mission?.type ? t(MISSION_TYPE_LABELS[mission.type] ?? mission.type) : "";
  const offline = isMissionOffline(mission);
  const duration = formatDuration(mission.averageDurationMilliseconds);
  const firstPosition = getStepPosition(steps[0]);
  const length = Number(mission.lengthMeters);
  const passphrases = steps.filter(isPassphraseStep).length;

  return (
    <li
      ref={itemRef}
      className={`mission${offline ? " off" : ""}${selected ? " sel" : ""}`}
      id={`mission-${index + 1}`}
    >
      <div className="mhead">
        <button
          type="button"
          className="mbtn sl"
          aria-expanded={expanded}
          aria-controls={`mission-body-${index + 1}`}
          onClick={onToggle}
        >
          <span className="mpic">
            {mission.picture ? (
              <img src={`${mission.picture}=s112`} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span className="mpic-empty" />
            )}
            <span className="mnum" style={{ background: color }}>
              {index + 1}
            </span>
          </span>
          <span className="mtxt">
            <span className="mtitle">
              <span className="sr">{t("Mission {number}:", { number: index + 1 })} </span>
              {mission.title || t("Mission {number}", { number: index + 1 })}
            </span>
            <span className="mmeta">
              {offline ? (
                <span className="chip mini bad">
                  <CloudOff />
                  {t("Offline")}
                </span>
              ) : null}
              {passphrases ? (
                <span className="chip mini warn">
                  <Key />
                  {passphrases > 1 ? tn("{count} passphrase", "{count} passphrases", passphrases) : t("Passphrase")}
                </span>
              ) : null}
              {typeLabel ? <span>{typeLabel}</span> : null}
              {Number.isFinite(length) && length > 0 ? <span>{formatLength(length)}</span> : null}
              {duration ? <span>{duration}</span> : null}
              <span>{tn("{count} waypoint", "{count} waypoints", steps.length)}</span>
            </span>
          </span>
          <ExpandMore className="chev" />
        </button>
        {mission.id ? (
          <a
            className="icon-btn sl"
            href={buildIngressMissionUrl(mission.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("Open mission {number} in Ingress", { number: index + 1 })}
            title={t("Open in Ingress")}
          >
            <OpenInNew />
          </a>
        ) : null}
        {firstPosition ? (
          <a
            className="icon-btn sl"
            href={buildGeoUrl(
              firstPosition[0],
              firstPosition[1],
              steps[0]?.poi?.title || mission.title || t("Mission {number}", { number: index + 1 })
            )}
            aria-label={t("Open the start of mission {number} in your maps app", { number: index + 1 })}
            title={t("Open start in maps app")}
          >
            <Place />
          </a>
        ) : null}
      </div>
      {expanded ? (
        <div className="mbody" id={`mission-body-${index + 1}`}>
          {mission.description ? (
            <p className="small muted desc" style={{ marginBottom: 8 }}>
              {mission.description}
            </p>
          ) : null}
          <ol className="wps" aria-label={t("Waypoints of mission {number}", { number: index + 1 })}>
            {steps.map((step, stepIndex) => {
              const poi = step?.poi ?? {};
              const position = getStepPosition(step);
              const unavailable = poi.type === "unavailable";
              const objective = OBJECTIVES[step?.objective] ? t(OBJECTIVES[step.objective]) : step?.objective ?? t("Visit");
              const title = poi.title || t("Hidden waypoint");
              const content = (
                <>
                  <span className="oi">{stepIndex + 1}</span>
                  <span className="wt">
                    <span className="wn">
                      {title}
                      {unavailable ? <span className="sr"> {t("(no longer in Ingress)")}</span> : null}
                    </span>
                    <span className="wo">
                      {isPassphraseStep(step) ? <Key aria-hidden="true" /> : null}
                      {objective}
                    </span>
                  </span>
                </>
              );

              return (
                <li
                  key={`${poi.id ?? "wp"}-${stepIndex}`}
                  className={`wp${unavailable ? " un" : ""}${isPassphraseStep(step) ? " pass" : ""}`}
                >
                  {position && !unavailable ? (
                    <a
                      className="sl"
                      href={buildGeoUrl(position[0], position[1], title)}
                      aria-label={t("{objective} at {title}, open in maps app", { objective, title })}
                    >
                      {content}
                    </a>
                  ) : (
                    <a aria-disabled="true">{content}</a>
                  )}
                  {renderAnswer && isPassphraseStep(step) ? renderAnswer(stepIndex) : null}
                </li>
              );
            })}
          </ol>
          {mission.id ? (
            <div className="mactions">
              <a
                className="btn filled sl"
                href={buildIngressMissionUrl(mission.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNew fontSize="small" />
                {t("Open in Ingress")}
              </a>
              <a
                className="btn outlined sl"
                href={buildIntelMissionUrl(mission.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNew fontSize="small" />
                {t("View on Intel")}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// A Leaflet map that was removed (e.g. the map pane unmounts when the window
// becomes phone-sized) has no map pane any more; touching it throws _leaflet_pos.
export function isLiveMap(map) {
  return Boolean(map && (map._mapPane || typeof map.getPane !== "function"));
}
export const ORDER_LABELS = {
  sequential: tk("In sequence"),
  anyOrder: tk("Any order"),
};

export function getOrderLabel(type) {
  if (!type) {
    return "";
  }

  return ORDER_LABELS[type] ? t(ORDER_LABELS[type]) : String(type);
}

export const BANNER_NOT_FOUND = "notFound";
export const BANNER_UNAVAILABLE = "unavailable";
// Longer than Bannergress ever takes when it's well; then it counts as down.
const BANNER_FETCH_TIMEOUT_MS = 20_000;

function bannerFetchTimeoutSignal() {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(BANNER_FETCH_TIMEOUT_MS)
    : undefined;
}

// What a /bnrs/<id> answer means: null (fine), the banner doesn't exist
// (404/410), or Bannergress has trouble (anything else that isn't OK).
export function bannerResponseProblem(response) {
  if (response?.ok !== false) {
    return null;
  }
  return response.status === 404 || response.status === 410 ? BANNER_NOT_FOUND : BANNER_UNAVAILABLE;
}

export function bannerErrorMessage(kind) {
  return kind === BANNER_NOT_FOUND
    ? t("This banner doesn’t exist (any more) on Bannergress.")
    : t("Bannergress, where the banner data comes from, isn’t responding right now. Try again in a minute.");
}

// All state, loading and map handling of the banner page; the designs only lay it out.
// With tabs (mobile Overview / Missions / Map) the map replaces the pane on phones.
export function useBannerDetails({ tabs = true } = {}) {
  const { bannerId } = useParams();
  const isMobile = useMediaQuery("(max-width:768px)");
  const syncState = useBannergressSync();
  const [items, setItems] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // BANNER_NOT_FOUND (Bannergress says 404) or BANNER_UNAVAILABLE (network
  // error, timeout, 5xx): different message, and only the latter has Retry.
  const [errorKind, setErrorKind] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState("overview");
  const [selectedMission, setSelectedMission] = useState(-1);
  const [expandedMissions, setExpandedMissions] = useState(() => new Set());
  const [userLocation, setUserLocation] = useState(null);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [mapInstance, setMapInstance] = useState(null);
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const missionItemRefs = useRef([]);
  // Missions in banner order without filler slots; missionSlots holds their positions.
  const missionEntries = useMemo(() => getMissionEntries(items.missions), [items.missions]);
  const missions = useMemo(() => missionEntries.map((entry) => entry.mission), [missionEntries]);
  const missionSlots = useMemo(() => missionEntries.map((entry) => entry.position), [missionEntries]);
  const colors = useMemo(() => missionColors(missions.length), [missions.length]);
  const missionPositions = useMemo(
    () =>
      missions.map((mission) =>
        getSteps(mission)
          .filter((step) => step?.poi?.type !== "unavailable")
          .map(getStepPosition)
          .filter(Boolean)
      ),
    [missions]
  );
  const allPositions = useMemo(() => missionPositions.flat(), [missionPositions]);
  const tabbed = tabs && isMobile;
  const showMap = !tabbed || tab === "map";
  const showPane = !tabbed || tab !== "map";
  const paneTab = tab === "map" && !tabbed ? "overview" : tab;

  useEffect(() => {
    let ignore = false;

    const loadBanner = async () => {
      setIsLoading(true);
      setError("");
      setErrorKind("");

      try {
        const response = await fetchBannergress(`https://api.bannergress.com/bnrs/${bannerId}`, {
          signal: bannerFetchTimeoutSignal(),
        });
        const kind = bannerResponseProblem(response);
        const result = kind ? null : await response.json();

        if (!ignore) {
          if (result && typeof result === "object" && result.id) {
            setItems(result);
          } else {
            setItems({});
            setErrorKind(kind ?? BANNER_UNAVAILABLE);
            setError(bannerErrorMessage(kind ?? BANNER_UNAVAILABLE));
          }
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setItems({});
          setErrorKind(BANNER_UNAVAILABLE);
          setError(bannerErrorMessage(BANNER_UNAVAILABLE));
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    setSelectedMission(-1);
    setExpandedMissions(new Set());
    loadBanner();

    return () => {
      ignore = true;
    };
  }, [bannerId, reloadToken]);

  useEffect(() => {
    resetPageMetadata();
  }, [bannerId]);

  useEffect(() => {
    if (isLoading) {
      return undefined;
    }

    if (errorKind === BANNER_NOT_FOUND) {
      applyPageMetadata({ title: t("Banner not found"), description: bannerErrorMessage(BANNER_NOT_FOUND) });
      return () => {
        resetPageMetadata();
      };
    }

    if (error || !items?.id) {
      resetPageMetadata();
      return undefined;
    }

    const metadata = buildBannerMetadata(items);

    if (metadata) {
      applyPageMetadata({
        ...metadata,
        type: "article",
      });
    }

    return () => {
      resetPageMetadata();
    };
  }, [error, errorKind, isLoading, items]);

  const fitRoute = useCallback(
    (map = mapRef.current) => {
      if (!isLiveMap(map) || allPositions.length === 0) {
        return;
      }

      map.invalidateSize?.(false);
      // An array of points works like L.latLngBounds(points) (no Leaflet import here).
      map.fitBounds?.(allPositions, {
        padding: [40, 40],
        animate: allPositions.length <= 100,
      });
    },
    [allPositions]
  );

  useEffect(() => {
    if (!mapInstance || isLoading) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => fitRoute(mapInstance));
    const timeoutId = window.setTimeout(() => fitRoute(mapInstance), 200);
    let observer = null;

    if (typeof ResizeObserver !== "undefined" && mapContainerRef.current) {
      observer = new ResizeObserver(() => {
        if (isLiveMap(mapInstance)) {
          mapInstance.invalidateSize?.(false);
        }
      });
      observer.observe(mapContainerRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [fitRoute, isLoading, mapInstance, showMap]);

  useEffect(() => {
    if (!tabbed && tab === "map") {
      setTab("overview");
    }
  }, [tabbed, tab]);

  const showInList = useCallback((index) => {
    setSelectedMission(index);
    setExpandedMissions((current) => new Set(current).add(index));
    setTab("missions");
    window.setTimeout(() => {
      missionItemRefs.current[index]?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }, 60);
  }, []);

  const handleMapSelect = useCallback(
    (index) => {
      if (isMobile) {
        setSelectedMission(index);
        return;
      }

      showInList(index);
    },
    [isMobile, showInList]
  );

  const toggleMission = (index) => {
    setExpandedMissions((current) => {
      const next = new Set(current);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
    setSelectedMission(index);
  };

  const handleLocate = () => {
    if (!navigator.geolocation || isLocatingUser) {
      return;
    }

    setLocationError("");
    setIsLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latitude = Number(coords?.latitude);
        const longitude = Number(coords?.longitude);

        setIsLocatingUser(false);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setLocationError(t("Couldn't determine your location."));
          return;
        }

        setUserLocation({ latitude, longitude });
        if (isLiveMap(mapRef.current)) {
          mapRef.current.panTo?.([latitude, longitude], { animate: true, duration: 0.35 });
        }
      },
      () => {
        setLocationError(t("Couldn't determine your location. Please check browser location access."));
        setIsLocatingUser(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
  };

  const missionCount = Number(items.numberOfMissions) || missions.length;
  // null = missing data (an offline mission or one without a time), as on Bannergress
  const totalDuration = getTotalDurationMs(missions, missionCount);
  const uniques = getUniquePortals(missions);
  const missionTypes = getMissionTypes(missions);
  const lastChecked = getLastChecked(missions, missionCount);
  const startToFinish = getStartToFinishMeters(missions);
  const perKm = getMissionsPerKm(items);
  const passphraseMissions = getPassphraseMissions(missions);
  const passphrases = useBannerPassphrases(items.id ?? bannerId, !isLoading && passphraseMissions.length > 0);

  return {
    bannerId,
    items,
    isLoading,
    error,
    errorKind,
    retry: () => setReloadToken((value) => value + 1),
    isMobile,
    tab,
    setTab,
    paneTab,
    showMap,
    showPane,
    missions,
    missionSlots,
    colors,
    missionPositions,
    selectedMission,
    setSelectedMission,
    selected: selectedMission >= 0 ? missions[selectedMission] : null,
    expandedMissions,
    toggleMission,
    showInList,
    // Opens every mission with a passphrase waypoint, scrolled to the first.
    showPassphrases: () => {
      const indexes = passphraseMissions.map((entry) => entry.index);
      if (indexes.length) {
        setExpandedMissions((current) => new Set([...current, ...indexes]));
        showInList(indexes[0]);
      }
    },
    handleMapSelect,
    missionItemRefs,
    mapRef,
    mapContainerRef,
    mapInstance,
    setMapInstance,
    fitRoute,
    handleLocate,
    userLocation,
    isLocatingUser,
    locationError,
    effectiveListType: isLoading ? null : getBannerListType(syncState, items.id, items.listType),
    missionCount,
    disabledCount:
      missions.filter(isMissionOffline).length || Number(items.numberOfDisabledMissions) || 0,
    waypointCount: missions.reduce((total, mission) => total + getSteps(mission).length, 0),
    authors: getBannerAuthors(missions),
    warning: typeof items.warning === "string" ? items.warning.trim() : "",
    address: typeof items.formattedAddress === "string" ? items.formattedAddress.trim() : "",
    startPlaceId: typeof items.startPlaceId === "string" ? items.startPlaceId.trim() : "",
    orderLabel: missionTypes.length > 1 ? t("Mixed") : getOrderLabel(missionTypes[0]?.key || items.type),
    missionTypes,
    actionCounts: getActionCounts(missions),
    uniqueLabel: missions.length ? `${uniques.count}${uniques.hidden ? "+" : ""}` : null,
    lastCheckedLabel: lastChecked
      ? new Date(`${lastChecked}T12:00:00`).toLocaleDateString(getLanguage(), {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null,
    startToFinishLabel: startToFinish !== null ? formatLength(startToFinish) : null,
    eventLabel: formatEvent(items.eventStartDate, items.eventEndDate, getLanguage()),
    passphraseMissions,
    passphrases,
    submittedCount: Number(items.numberOfSubmittedMissions) || 0,
    distanceLabel: formatLength(items.lengthMeters),
    durationLabel: totalDuration === null ? (missions.length ? t("Missing data") : null) : formatDuration(totalDuration),
    perKmLabel: perKm !== null
      ? perKm.toLocaleString(getLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : null,
  };
}

/* ---------- shared building blocks ---------- */

export function AddressLink({ d }) {
  if (d.address && d.startPlaceId) {
    return (
      <Link
        to={`/browse/${encodeURIComponent(d.startPlaceId)}`}
        onClick={() => resetBrowseState(getBrowseStateScope({ placeId: d.startPlaceId }))}
        title={t("Browse banners in this place")}
      >
        {d.address}
      </Link>
    );
  }

  return <span>{d.address || t("Address unavailable")}</span>;
}

// Authors as plain text links ("by A, B and C"), faction shown as a coloured dot.
// The sentence and the list joins ("and") follow the user's language.
export function Byline({ d, prefix, className = "" }) {
  if (!d.authors.length) {
    return null;
  }

  const template = prefix === undefined ? t("by {authors}") : prefix ? `${prefix} {authors}` : "{authors}";
  const [before, after = ""] = template.split("{authors}");
  const joins = listJoins(d.authors.length);

  return (
    <p className={`bp-byline ${className}`.trim()}>
      {before ? <span>{before}</span> : null}
      {d.authors.map((author, index) => (
        <React.Fragment key={`${author.name}-${author.faction || "unknown"}`}>
          {joins[index] || null}
          <Link
            className={`by-a sl fx-${author.faction || "unknown"}`}
            to={`/agent/${encodeURIComponent(author.name)}`}
            title={author.faction ? `${author.name} (${author.faction})` : author.name}
          >
            {author.name}
          </Link>
        </React.Fragment>
      ))}
      {after ? <span>{after}</span> : null}
    </p>
  );
}

export function HeroArt({ d }) {
  if (d.isLoading) {
    return <Skeleton variant="rounded" height={120} sx={{ bgcolor: "rgba(255,255,255,0.15)" }} />;
  }

  return (
    <EnlargeableArt banner={d.items} missions={d.missions} slots={d.missionSlots} colors={d.colors}>
      <HeroMosaic banner={d.items} missions={d.missions} slots={d.missionSlots} colors={d.colors} />
    </EnlargeableArt>
  );
}

export function BannerTitle({ d, className = "bp-title" }) {
  return (
    <h1 className={className}>
      {d.isLoading ? (
        <Skeleton width="70%" sx={{ bgcolor: "rgba(255,255,255,0.15)" }} />
      ) : (
        d.items.title || (d.errorKind === BANNER_NOT_FOUND ? t("Banner not found") : t("Banner"))
      )}
    </h1>
  );
}

export function ErrorAlert({ d }) {
  if (d.errorKind === BANNER_NOT_FOUND) {
    return (
      <div className="ob-alert bp-missing" role="alert">
        <div className="grow">
          <p className="bp-missing-t">{d.error}</p>
          <p className="small muted">{t("The link may be mistyped, or the banner was removed from Bannergress.")}</p>
          <div className="bp-missing-acts">
            <Link className="btn filled sl" to="/search">
              {t("Search")}
            </Link>
            <Link className="btn tonal sl" to="/map">
              {t("Map")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-alert bad" role="alert">
      <div className="grow">{d.error}</div>
      <button type="button" className="btn text sl" onClick={d.retry}>
        {t("Retry")}
      </button>
    </div>
  );
}

// Offline missions, the Bannergress warning and a planned offline date.
export function StatusAlerts({ d }) {
  if (d.isLoading) {
    return null;
  }

  const { disabledCount, missionCount } = d;
  const offlineTone = d.items.plannedOfflineDate ? plannedOfflineTone(d.items.plannedOfflineDate) : "";

  return (
    <>
      {d.eventLabel ? (
        <div className="ob-alert" role="note">
          <EventIcon />
          <div className="grow">
            <b>{d.eventLabel}</b>
            <span className="small">{t("This banner was made for an event.")}</span>
          </div>
        </div>
      ) : null}
      {disabledCount > 0 ? (
        <div className="ob-alert bad" role="note">
          <CloudOff />
          <div className="grow">
            <b>
              {disabledCount >= missionCount
                ? tn(
                    "This banner is offline – its {count} mission is disabled",
                    "This banner is offline – all {count} missions are disabled",
                    missionCount
                  )
                : tn(
                    "{disabled} of {count} mission is offline",
                    "{disabled} of {count} missions are offline",
                    missionCount,
                    { disabled: disabledCount }
                  )}
            </b>
            <span className="small">
              {disabledCount >= missionCount
                ? t("You can’t complete it in Ingress any more. The route is kept here for reference.")
                : t("The banner can’t be fully completed until these missions are back.")}
            </span>
          </div>
        </div>
      ) : null}
      {d.warning ? (
        <div className="ob-alert warn" role="note">
          <Warning />
          <div className="grow">
            <b>{t("Bannergress warning")}</b>
            <span className="small desc">{d.warning}</span>
          </div>
        </div>
      ) : null}
      <PassphraseAlert d={d} />
      {d.submittedCount > 0 ? (
        <div className="ob-alert" role="note">
          <HourglassTop />
          <div className="grow">
            <b>
              {tn(
                "{count} mission is waiting for Niantic",
                "{count} missions are waiting for Niantic",
                d.submittedCount
              )}
            </b>
            <span className="small">{t("Submitted, but not live in Ingress yet.")}</span>
          </div>
        </div>
      ) : null}
      {d.items.plannedOfflineDate ? (
        <div className={`ob-alert ${offlineTone || "warn"}`} role="note">
          <Warning />
          <div className="grow">
            <b>
              {t("Goes offline on {date}", {
                date: new Date(d.items.plannedOfflineDate).toLocaleDateString(getLanguage(), {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }),
              })}
            </b>
            <span className="small">{t("The author has planned to take this banner down.")}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

// One line naming the missions with a passphrase step.
export function PassphraseAlert({ d }) {
  const entries = d.passphraseMissions ?? [];
  if (d.isLoading || !entries.length) {
    return null;
  }
  const indexes = entries.map((entry) => entry.index);
  const title =
    indexes.length === d.missions.length && indexes.length > 1
      ? t("Every mission asks for a passphrase")
      : tn(
          "Mission {numbers} asks for a passphrase",
          "Missions {numbers} ask for a passphrase",
          indexes.length,
          { numbers: formatMissionNumbers(indexes, false) }
        );

  return (
    <div className="ob-alert warn" role="note">
      <Key />
      <b className="grow">{title}</b>
    </div>
  );
}

export function ListActions({ d }) {
  if (d.isLoading) {
    return null;
  }

  return (
    <BannergressListActions
      bannerId={d.items.id}
      effectiveListType={d.effectiveListType}
      canUpdateBannerList={isBannergressAuthSupportedOrigin()}
      layout="horizontal"
    />
  );
}

// Key numbers; `keys` picks which and in what order.
export function KeyNumbers({ d, keys = ["distance", "missions", "time", "perKm"], className = "stats" }) {
  const wait = (value) => (d.isLoading ? "…" : value ?? "?");
  const all = {
    distance: [t("Distance"), wait(d.distanceLabel)],
    missions: [t("Missions"), wait(d.missionCount)],
    time: [t("Est. time"), wait(d.durationLabel)],
    perKm: [t("Missions / km"), wait(d.perKmLabel)],
    order: [t("Order"), wait(d.orderLabel || null)],
    waypoints: [t("Waypoints"), wait(d.waypointCount)],
    offline: [t("Offline"), wait(d.disabledCount)],
    uniques: [t("Unique portals"), wait(d.uniqueLabel)],
    straight: [t("Start to finish"), wait(d.startToFinishLabel)],
    lastChecked: [t("Last checked"), wait(d.lastCheckedLabel)],
  };

  return (
    <div className={className} role="list" aria-label={t("Key numbers")}>
      {keys.filter((key) => !(key === "straight" && !d.isLoading && !d.startToFinishLabel)).map((key) => (
        <div className={`stat stat-${key}`} role="listitem" key={key}>
          <span className="k">{all[key][0]}</span>
          <span className="v">{all[key][1]}</span>
        </div>
      ))}
    </div>
  );
}

export function Description({ d, className = "desc" }) {
  if (d.isLoading) {
    return (
      <div>
        <Skeleton />
        <Skeleton width="70%" />
      </div>
    );
  }

  if (!d.items.description) {
    return <p className={className}>{t("No banner description is available.")}</p>;
  }

  return <SimpleMarkdown text={d.items.description} className={className} />;
}

export function BannergressLink({ d, className = "small", button = false }) {
  if (d.isLoading) {
    return null;
  }
  if (button) {
    return (
      <a
        className="btn tonal sl"
        href={`https://bannergress.com/banner/${encodeURIComponent(d.items.id ?? d.bannerId)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("View on Bannergress")}
      </a>
    );
  }

  return (
    <p className={className}>
      <a
        href={`https://bannergress.com/banner/${encodeURIComponent(d.items.id ?? d.bannerId)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("View on Bannergress")}
      </a>
    </p>
  );
}

export function MissionsHeader({ d }) {
  return (
    <div>
      <h2 className="ob-h2" style={{ fontSize: 18 }}>
        {tn("{count} mission", "{count} missions", d.missionCount)}
      </h2>
      <p className="small muted">
        {tn("{count} waypoint", "{count} waypoints", d.waypointCount)}
        {d.orderLabel ? ` · ${d.orderLabel.toLocaleLowerCase(getLanguage())}` : ""}
        {d.disabledCount > 0 ? ` · ${tn("{count} offline", "{count} offline", d.disabledCount)}` : ""}
        {d.passphraseMissions?.length
          ? ` · ${tn("{count} with a passphrase", "{count} with a passphrase", d.passphraseMissions.length)}`
          : ""}
      </p>
    </div>
  );
}

export function MissionList({ d }) {
  return (
    <ol className="mlist" aria-label={t("Missions in order")}>
      {d.missions.map((mission, index) => (
        <MissionItem
          key={mission.id ?? index}
          mission={mission}
          index={index}
          color={d.colors[index]}
          selected={d.selectedMission === index}
          expanded={d.expandedMissions.has(index)}
          onToggle={() => d.toggleMission(index)}
          showType={d.missionTypes.length > 1}
          renderAnswer={
            mission.id
              ? (stepIndex) => (
                  <WaypointAnswer d={d} missionId={mission.id} missionIndex={index} stepIndex={stepIndex} />
                )
              : null
          }
          itemRef={(element) => {
            d.missionItemRefs.current[index] = element;
          }}
        />
      ))}
    </ol>
  );
}

// Route map with its controls and the bottom sheet. `children` = extra overlay controls.
export function MapSection({ d, className = "", sheet = true, onShowInList, children = null }) {
  const showInList = onShowInList ?? d.showInList;
  const sheetRef = useRef(null);
  const sheetShown = sheet && !d.isLoading && !d.error;

  // Leaflet's credits sit just above the sheet, whose height changes with the
  // selected mission's title (it wraps on phones).
  useLayoutEffect(() => {
    const section = d.mapContainerRef.current;
    const sheetElement = sheetRef.current;

    if (!section) {
      return undefined;
    }

    if (!sheetElement) {
      section.style.setProperty("--sheet-h", "0px");
      return undefined;
    }

    const measure = () => section.style.setProperty("--sheet-h", `${sheetElement.offsetHeight}px`);
    measure();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(sheetElement);
    return () => observer.disconnect();
  }, [d.mapContainerRef, sheetShown, d.selectedMission]);

  return (
    <section
      className={`bp-map ${className}`.trim()}
      ref={d.mapContainerRef}
      hidden={!d.showMap}
      aria-label={t("Route map")}
    >
      {d.showMap && !d.error ? (
        <Suspense fallback={null}>
        <RouteMap
          missions={d.missions}
          colors={d.colors}
          missionPositions={d.missionPositions}
          missionSlots={d.missionSlots}
          selectedMission={d.selectedMission}
          onSelectMission={d.handleMapSelect}
          userLocation={d.userLocation}
          isMobile={d.isMobile}
          mapRef={d.mapRef}
          onReady={(map) => {
            d.mapRef.current = map;
            d.setMapInstance(map);
          }}
        />
        </Suspense>
      ) : null}
      <div className="bp-mapctl">
        {children}
        <button
          type="button"
          className="icon-btn sl"
          aria-label={t("Show my location")}
          title={t("Show my location")}
          disabled={d.isLocatingUser}
          onClick={d.handleLocate}
        >
          <MyLocation />
        </button>
        <button
          type="button"
          className="icon-btn sl"
          aria-label={t("Show whole route")}
          title={t("Show whole route")}
          onClick={() => {
            d.setSelectedMission(-1);
            d.fitRoute();
          }}
        >
          <FitScreen />
        </button>
      </div>
      {d.isLoading || d.locationError ? (
        <div className="bp-note" role={d.locationError ? "alert" : undefined}>
          {d.locationError || t("Loading map details...")}
        </div>
      ) : null}
      {sheetShown ? (
        <div className="bp-sheet" ref={sheetRef} aria-live="polite">
          {d.selected ? (
            <div className="bp-sheet-row">
              <b className="grow bp-sheet-title" title={d.selected.title}>
                {d.selectedMission + 1}. {d.selected.title}
              </b>
              {d.selected.id ? (
                <a
                  className="btn filled sl"
                  href={buildIngressMissionUrl(d.selected.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Open in Ingress")}
                </a>
              ) : null}
              <button
                type="button"
                className="icon-btn sl"
                aria-label={t("Show in list")}
                title={t("Show in list")}
                onClick={() => showInList(d.selectedMission)}
              >
                <FormatListNumbered />
              </button>
            </div>
          ) : null}
          {d.selected && d.passphraseMissions?.some((entry) => entry.index === d.selectedMission) ? (
            <div className="small bp-sheet-pass">
              <Key />
              {t("Asks for a passphrase: look around on site for the answer")}
            </div>
          ) : null}
          {d.selected ? null : (
            <>
              <b>
                {tn("Whole route · {count} mission · {distance}", "Whole route · {count} missions · {distance}", d.missionCount, {
                  distance: d.distanceLabel,
                })}
              </b>
              <div className="small muted">{t("Tap a numbered marker to see that mission")}</div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

// Mobile Overview / Missions / Map tabs (Map hidden on desktop, where the map is beside).
export function DetailTabs({ d, labels = { overview: tk("Overview"), missions: tk("Missions"), map: tk("Map") }, className = "" }) {
  return (
    <div className={`bp-tabs ${className}`.trim()} role="tablist" aria-label={t("Banner detail sections")}>
      {Object.entries(labels).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          className={`bp-tab sl${key === "map" ? " map-only" : ""}`}
          aria-selected={key === "map" ? d.tab === "map" : d.paneTab === key}
          disabled={key === "map" && Boolean(d.error)}
          onClick={() => d.setTab(key)}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}


// The secondary facts as one label/value list, below the headline tiles:
// waypoints, start to finish, last checked, the actions per type and, when
// mixed, the mission types (Bannergress shows these as info rows too).
export function BannerDetailsList({ d }) {
  if (d.isLoading) {
    return null;
  }

  const rows = [[t("Waypoints"), d.waypointCount]];
  if (d.startToFinishLabel) {
    rows.push([t("Start to finish"), d.startToFinishLabel]);
  }
  if (d.lastCheckedLabel) {
    rows.push([t("Last checked"), d.lastCheckedLabel]);
  }
  const groups = [[t("Actions"), d.actionCounts]];
  if (d.missionTypes.length > 1) {
    groups.push([t("Mission types"), d.missionTypes]);
  }

  return (
    <section className="bp-facts" aria-label={t("Banner details list")}>
      <dl>
        {rows.map(([label, value]) => (
          <div className="bp-fact" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {groups.map(([title, items]) =>
          items.length === 1 ? (
            <div className="bp-fact" key={title}>
              <dt>{title}</dt>
              <dd>
                {items[0].label} {items[0].count}
              </dd>
            </div>
          ) : items.length ? (
            <React.Fragment key={title}>
              <div className="bp-fact bp-fact-head">
                <dt>{title}</dt>
                <dd>{items.reduce((sum, item) => sum + item.count, 0)}</dd>
              </div>
              {items.map((item) => (
                <div className="bp-fact bp-fact-sub" key={`${title}-${item.key}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.count}</dd>
                </div>
              ))}
            </React.Fragment>
          ) : null
        )}
      </dl>
    </section>
  );
}
