import { WORLD_PLACEHOLDER } from "../../mapDefaults";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { Link, useParams } from "react-router-dom";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  OpenInNew,
  Place,
  Warning,
} from "@mui/icons-material";
import L from "leaflet";
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
import userLocationIcon from "../../constants";
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

function createStartIcon(index, color, selected) {
  // Mission 1 is the start: same numbered circle as the others, in its own colour.
  return L.divIcon({
    className: `mk mk-num${index === 0 ? " mk-first" : ""}${selected ? " sel" : ""}`,
    html: `<span style="--c:${color}">${index + 1}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function createFinishIcon(shifted) {
  // Shifted up-right when a numbered start marker sits on the same portal.
  return L.divIcon({
    className: "mk mk-num mk-finish",
    html: `<span>${FINISH_FLAG_SVG}</span>`,
    iconSize: [22, 22],
    iconAnchor: shifted ? [-3, 25] : [11, 11],
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

function createWaypointIcon(color) {
  return L.divIcon({
    className: "mk mk-wp",
    html: `<span style="--c:${color}"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

// The banner artwork. Tiles aren't links: tapping the artwork opens it enlarged.
export function MissionMosaic({ banner, missions, colors, large = false }) {
  const width = Number(banner.width) || 6;
  const count = missions.length;
  const rows = Math.max(1, Math.ceil(count / width));
  const padding = rows * width - count;
  const hasPictures = missions.some((mission) => mission?.picture);

  if (!count || !hasPictures) {
    // Shown whole (max-height in CSS), so no pan needed.
    return (
      <BannerImage
        banner={banner}
        mode="natural"
        className={large ? "bp-lightbox-pic" : "bp-hero-pic"}
        eager
      />
    );
  }

  const cells = [];

  for (let cell = 0; cell < rows * width; cell += 1) {
    if (cell < padding) {
      cells.push(<span key={`void-${cell}`} className="void" aria-hidden="true" />);
      continue;
    }

    // Mission 1 is bottom-right, like in the Ingress scanner.
    const index = count - 1 - (cell - padding);
    const mission = missions[index];

    cells.push(
      <span
        key={mission.id ?? index}
        className={`tile${isMissionOffline(mission) ? " off" : ""}`}
        style={{ "--c": colors[index] }}
      >
        {mission.picture ? (
          <img
            src={`${mission.picture}=s${large ? 320 : 160}`}
            alt=""
            loading={large ? undefined : "lazy"}
            referrerPolicy="no-referrer"
          />
        ) : null}
      </span>
    );
  }

  return (
    <div
      className={`mosaic${large ? " large" : ""}`}
      role="img"
      aria-label={tn(
        "Banner artwork: {count} mission tile, {width} per row.",
        "Banner artwork: {count} mission tiles, {width} per row.",
        count,
        { width }
      )}
      style={{ "--w": width, "--rows": rows }}
    >
      {cells}
    </div>
  );
}

// Full-screen view of the artwork; tap anywhere, × or Escape closes it.
export function BannerLightbox({ banner, missions, colors, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Portal to <body>: inside the page the hero's stacking context let the tabs draw over it.
  return createPortal(
    <div className="bp-lightbox" role="dialog" aria-modal="true" aria-label={t("Banner artwork")}
      onClick={(event) => {
        // React bubbles portal clicks to the enlarge button, which would reopen it.
        event.stopPropagation();
        onClose();
      }}
    >
      <button type="button" className="bp-lightbox-close" aria-label={t("Close")}>
        ×
      </button>
      <div className="bp-lightbox-body">
        <MissionMosaic banner={banner} missions={missions} colors={colors} large />
      </div>
    </div>,
    document.body
  );
}

// Tappable artwork that opens the lightbox.
export function EnlargeableArt({ banner, missions, colors, children }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="bp-enlarge"
        aria-label={t("Enlarge banner artwork")}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? (
        <BannerLightbox banner={banner} missions={missions} colors={colors} onClose={() => setOpen(false)} />
      ) : null}
    </>
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

export function RouteMap({
  missions,
  colors,
  missionPositions,
  selectedMission,
  onSelectMission,
  userLocation,
  isMobile,
  mapRef,
  onReady,
}) {
  const startIcons = useMemo(
    () => missions.map((_, index) => createStartIcon(index, colors[index], index === selectedMission)),
    [colors, missions, selectedMission]
  );
  const connectors = useMemo(
    () =>
      missionPositions.flatMap((positions, index) => {
        const next = missionPositions[index + 1];

        return positions.length && next?.length
          ? [{ key: `connector-${index}`, positions: [positions[positions.length - 1], next[0]] }]
          : [];
      }),
    [missionPositions]
  );
  const selectedSteps = selectedMission >= 0 ? getSteps(missions[selectedMission]) : [];
  const waypointIcon = useMemo(
    () => (selectedMission >= 0 ? createWaypointIcon(colors[selectedMission]) : null),
    [colors, selectedMission]
  );
  const pointCount = missionPositions.reduce((total, positions) => total + positions.length, 0);
  const finish = useMemo(() => getFinish(missions), [missions]);
  const finishIcon = useMemo(() => {
    if (!finish) {
      return null;
    }

    return createFinishIcon(isOnStartMarker(finish.position, missionPositions));
  }, [finish, missionPositions]);

  return (
    <MapContainer
      center={WORLD_PLACEHOLDER.center}
      zoom={WORLD_PLACEHOLDER.zoom}
      zoomControl={!isMobile}
      scrollWheelZoom={true}
      style={{ height: "100%", width: "100%" }}
      ref={mapRef}
      preferCanvas={pointCount > 200}
      touchZoom={true}
      whenReady={({ target }) => onReady(target)}
    >
      <TileLayer
        attribution={t("© {osm} contributors. This website is NOT affiliated with Bannergress in any way!", {
          osm: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })}
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {connectors.map((connector) => (
        <Polyline
          key={connector.key}
          positions={connector.positions}
          pathOptions={{ color: "#666", weight: 2, dashArray: "4 6", opacity: 0.7, interactive: false }}
        />
      ))}
      {missionPositions.map((positions, index) =>
        positions.length > 1 ? (
          <Polyline
            key={`line-${missions[index]?.id ?? index}`}
            positions={positions}
            pathOptions={{
              color: colors[index],
              weight: selectedMission === index ? 6 : 4,
              opacity: selectedMission >= 0 && selectedMission !== index ? 0.45 : 0.9,
            }}
            eventHandlers={{ click: () => onSelectMission(index) }}
          />
        ) : null
      )}
      {selectedMission < 0
        ? missions.flatMap((mission, missionIndex) =>
            getSteps(mission).map((step, stepIndex) => {
              const position = getStepPosition(step);

              if (!position || stepIndex === 0 || step?.poi?.type === "unavailable") {
                return null;
              }

              const title = step?.poi?.title || t("Waypoint");

              return (
                <CircleMarker
                  key={`wp-${missionIndex}-${stepIndex}`}
                  center={position}
                  radius={4}
                  pathOptions={{
                    color: "#fff",
                    weight: 1.5,
                    fillColor: colors[missionIndex],
                    fillOpacity: 1,
                  }}
                >
                  <Popup>
                    <div>
                      <div>{t("Mission {number}", { number: missionIndex + 1 })}</div>
                      <div>
                        {stepIndex + 1}. {title}
                      </div>
                      <a href={buildGeoUrl(position[0], position[1], title)}>{t("Open in maps app")}</a>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })
          )
        : null}
      {selectedSteps.map((step, stepIndex) => {
        const position = getStepPosition(step);

        if (!position || stepIndex === 0 || step?.poi?.type === "unavailable") {
          return null;
        }

        const title = step?.poi?.title || t("Waypoint");

        return (
          <Marker key={`wp-${stepIndex}`} position={position} icon={waypointIcon} title={title}>
            <Popup>
              <div>
                <div>
                  {stepIndex + 1}. {title}
                </div>
                <a href={buildGeoUrl(position[0], position[1], title)}>{t("Open in maps app")}</a>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {missionPositions
        .map((positions, index) => ({ position: positions[0], index }))
        .filter((entry) => entry.position)
        .reverse()
        .map(({ position, index }) => (
          <Marker
            key={`start-${missions[index]?.id ?? index}`}
            position={position}
            icon={startIcons[index]}
            title={t("Mission {number}: {title}", { number: index + 1, title: missions[index]?.title ?? "" })}
            zIndexOffset={index === 0 ? 1000 : 500 - index}
            eventHandlers={{ click: () => onSelectMission(index) }}
          />
        ))}
      {finish && finishIcon ? (
        <Marker
          key="finish"
          position={finish.position}
          icon={finishIcon}
          title={t("Finish: {title}", { title: finish.title })}
          zIndexOffset={1500}
        >
          <Popup>
            <div>
              <div>
                <b>{t("Finish")}</b> · {t("mission {number}", { number: finish.missionIndex + 1 })}
              </div>
              <div>{finish.title}</div>
              <a href={buildGeoUrl(finish.position[0], finish.position[1], finish.title)}>
                {t("Open in maps app")}
              </a>
            </div>
          </Popup>
        </Marker>
      ) : null}
      {userLocation ? (
        <Marker
          position={[userLocation.latitude, userLocation.longitude]}
          icon={userLocationIcon}
          zIndexOffset={2000}
        />
      ) : null}
    </MapContainer>
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

// All state, loading and map handling of the banner page; the designs only lay it out.
// With tabs (mobile Overview / Missions / Map) the map replaces the pane on phones.
export function useBannerDetails({ tabs = true } = {}) {
  const { bannerId } = useParams();
  const isMobile = useMediaQuery("(max-width:768px)");
  const syncState = useBannergressSync();
  const [items, setItems] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
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
  const missions = useMemo(() => Object.values(items.missions ?? {}), [items.missions]);
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

      try {
        const response = await fetchBannergress(`https://api.bannergress.com/bnrs/${bannerId}`);
        const result = await response.json();

        if (!ignore) {
          if (result && typeof result === "object" && result.id) {
            setItems(result);
          } else {
            setItems({});
            setError(t("Couldn't load this banner."));
          }
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setItems({});
          setError(t("Couldn't load this banner. Please try again."));
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
  }, [error, isLoading, items]);

  const fitRoute = useCallback(
    (map = mapRef.current) => {
      if (!isLiveMap(map) || allPositions.length === 0) {
        return;
      }

      map.invalidateSize?.(false);
      map.fitBounds?.(L.latLngBounds(allPositions), {
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
    retry: () => setReloadToken((value) => value + 1),
    isMobile,
    tab,
    setTab,
    paneTab,
    showMap,
    showPane,
    missions,
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
    <EnlargeableArt banner={d.items} missions={d.missions} colors={d.colors}>
      <MissionMosaic banner={d.items} missions={d.missions} colors={d.colors} />
    </EnlargeableArt>
  );
}

export function BannerTitle({ d, className = "bp-title" }) {
  return (
    <h1 className={className}>
      {d.isLoading ? (
        <Skeleton width="70%" sx={{ bgcolor: "rgba(255,255,255,0.15)" }} />
      ) : (
        d.items.title || t("Banner")
      )}
    </h1>
  );
}

export function ErrorAlert({ d }) {
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
        <RouteMap
          missions={d.missions}
          colors={d.colors}
          missionPositions={d.missionPositions}
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
