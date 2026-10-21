import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { Link, useParams } from "react-router-dom";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, useMediaQuery } from "@mui/material";
import {
  CloudOff,
  ExpandMore,
  FitScreen,
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

const OBJECTIVES = {
  hack: "Hack",
  captureOrUpgrade: "Capture or upgrade",
  createLink: "Create link",
  createField: "Create field",
  installMod: "Install mod",
  takePhoto: "Take photo",
  viewWaypoint: "View waypoint",
  enterPassphrase: "Enter passphrase",
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

  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
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
        return { position, title: step?.poi?.title || "Last portal", missionIndex, stepIndex };
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

export function MissionMosaic({ banner, missions, colors, onSelect }) {
  const width = Number(banner.width) || 6;
  const count = missions.length;
  const rows = Math.max(1, Math.ceil(count / width));
  const padding = rows * width - count;
  const hasPictures = missions.some((mission) => mission?.picture);

  if (!count || !hasPictures) {
    // Shown whole (max-height in CSS), so no pan needed.
    return <BannerImage banner={banner} mode="natural" className="bp-hero-pic" eager />;
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
      <button
        type="button"
        key={mission.id ?? index}
        className={`tile${isMissionOffline(mission) ? " off" : ""}`}
        style={{ "--c": colors[index] }}
        aria-label={`Mission ${index + 1} of ${count}: ${mission.title ?? ""}`}
        onClick={() => onSelect(index)}
      >
        {mission.picture ? (
          <img src={`${mission.picture}=s160`} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : null}
        <span className="n" aria-hidden="true">
          {index + 1}
        </span>
      </button>
    );
  }

  return (
    <div
      className="mosaic"
      role="group"
      aria-label={`Banner artwork: ${count} mission tiles, ${width} per row. Mission 1 is bottom-right.`}
      style={{ "--w": width, "--rows": rows }}
    >
      {cells}
    </div>
  );
}

export function MissionItem({ mission, index, color, selected, expanded, onToggle, itemRef }) {
  const steps = getSteps(mission);
  const offline = isMissionOffline(mission);
  const duration = formatDuration(mission.averageDurationMilliseconds);
  const firstPosition = getStepPosition(steps[0]);
  const length = Number(mission.lengthMeters);

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
              <span className="sr">Mission {index + 1}: </span>
              {mission.title || `Mission ${index + 1}`}
            </span>
            <span className="mmeta">
              {offline ? (
                <span className="chip mini bad">
                  <CloudOff />
                  Offline
                </span>
              ) : null}
              {Number.isFinite(length) && length > 0 ? <span>{formatLength(length)}</span> : null}
              {duration ? <span>{duration}</span> : null}
              <span>{steps.length} waypoints</span>
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
            aria-label={`Open mission ${index + 1} in Ingress`}
            title="Open in Ingress"
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
              steps[0]?.poi?.title || mission.title || `Mission ${index + 1}`
            )}
            aria-label={`Open the start of mission ${index + 1} in your maps app`}
            title="Open start in maps app"
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
          <ol className="wps" aria-label={`Waypoints of mission ${index + 1}`}>
            {steps.map((step, stepIndex) => {
              const poi = step?.poi ?? {};
              const position = getStepPosition(step);
              const unavailable = poi.type === "unavailable";
              const objective = OBJECTIVES[step?.objective] ?? step?.objective ?? "Visit";
              const title = poi.title || "Hidden waypoint";
              const content = (
                <>
                  <span className="oi">{stepIndex + 1}</span>
                  <span className="wt">
                    <span className="wn">
                      {title}
                      {unavailable ? <span className="sr"> (no longer in Ingress)</span> : null}
                    </span>
                    <span className="wo">{objective}</span>
                  </span>
                </>
              );

              return (
                <li key={`${poi.id ?? "wp"}-${stepIndex}`} className={`wp${unavailable ? " un" : ""}`}>
                  {position && !unavailable ? (
                    <a
                      className="sl"
                      href={buildGeoUrl(position[0], position[1], title)}
                      aria-label={`${objective} at ${title}, open in maps app`}
                    >
                      {content}
                    </a>
                  ) : (
                    <a aria-disabled="true">{content}</a>
                  )}
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
                Open in Ingress
              </a>
              <a
                className="btn outlined sl"
                href={buildIntelMissionUrl(mission.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNew fontSize="small" />
                View on Intel
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
      center={[52.221058, 6.893297]}
      zoom={8}
      zoomControl={!isMobile}
      scrollWheelZoom={true}
      style={{ height: "100%", width: "100%" }}
      ref={mapRef}
      preferCanvas={pointCount > 200}
      touchZoom={true}
      whenReady={({ target }) => onReady(target)}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. This website is NOT affiliated with Bannergress in any way!'
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

              const title = step?.poi?.title || "Waypoint";

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
                      <div>Mission {missionIndex + 1}</div>
                      <div>
                        {stepIndex + 1}. {title}
                      </div>
                      <a href={buildGeoUrl(position[0], position[1], title)}>Open in maps app</a>
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

        const title = step?.poi?.title || "Waypoint";

        return (
          <Marker key={`wp-${stepIndex}`} position={position} icon={waypointIcon} title={title}>
            <Popup>
              <div>
                <div>
                  {stepIndex + 1}. {title}
                </div>
                <a href={buildGeoUrl(position[0], position[1], title)}>Open in maps app</a>
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
            title={`Mission ${index + 1}: ${missions[index]?.title ?? ""}`}
            zIndexOffset={index === 0 ? 1000 : 500 - index}
            eventHandlers={{ click: () => onSelectMission(index) }}
          />
        ))}
      {finish && finishIcon ? (
        <Marker
          key="finish"
          position={finish.position}
          icon={finishIcon}
          title={`Finish: ${finish.title}`}
          zIndexOffset={1500}
        >
          <Popup>
            <div>
              <div>
                <b>Finish</b> · mission {finish.missionIndex + 1}
              </div>
              <div>{finish.title}</div>
              <a href={buildGeoUrl(finish.position[0], finish.position[1], finish.title)}>
                Open in maps app
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
  sequential: "In sequence",
  anyOrder: "Any order",
};

export function getOrderLabel(type) {
  if (!type) {
    return "";
  }

  return ORDER_LABELS[type] ?? String(type);
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
            setError("Couldn't load this banner.");
          }
        }
      } catch (fetchError) {
        console.error(fetchError);

        if (!ignore) {
          setItems({});
          setError("Couldn't load this banner. Please try again.");
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
          setLocationError("Couldn't determine your location.");
          return;
        }

        setUserLocation({ latitude, longitude });
        if (isLiveMap(mapRef.current)) {
          mapRef.current.panTo?.([latitude, longitude], { animate: true, duration: 0.35 });
        }
      },
      () => {
        setLocationError("Couldn't determine your location. Please check browser location access.");
        setIsLocatingUser(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
  };

  const missionCount = Number(items.numberOfMissions) || missions.length;
  const totalDuration = missions.reduce(
    (total, mission) => total + (Number(mission.averageDurationMilliseconds) || 0),
    0
  );
  const perKm = getMissionsPerKm(items);

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
    orderLabel: getOrderLabel(items.type),
    distanceLabel: formatLength(items.lengthMeters),
    durationLabel: formatDuration(totalDuration),
    perKmLabel: perKm !== null ? perKm.toFixed(1) : null,
  };
}

/* ---------- shared building blocks ---------- */

export function AddressLink({ d }) {
  if (d.address && d.startPlaceId) {
    return (
      <Link
        to={`/browse/${encodeURIComponent(d.startPlaceId)}`}
        onClick={() => resetBrowseState(getBrowseStateScope({ placeId: d.startPlaceId }))}
        title="Browse banners in this place"
      >
        {d.address}
      </Link>
    );
  }

  return <span>{d.address || "Address unavailable"}</span>;
}

// Authors as plain text links ("by A, B and C"), faction shown as a coloured dot.
export function Byline({ d, prefix = "by", className = "" }) {
  if (!d.authors.length) {
    return null;
  }

  const last = d.authors.length - 1;

  return (
    <p className={`bp-byline ${className}`.trim()}>
      {prefix ? <span>{prefix} </span> : null}
      {d.authors.map((author, index) => (
        <React.Fragment key={`${author.name}-${author.faction || "unknown"}`}>
          {index > 0 ? (index === last ? " and " : ", ") : null}
          <Link
            className={`by-a sl fx-${author.faction || "unknown"}`}
            to={`/agent/${encodeURIComponent(author.name)}`}
            title={author.faction ? `${author.name} (${author.faction})` : author.name}
          >
            {author.name}
          </Link>
        </React.Fragment>
      ))}
    </p>
  );
}

export function HeroArt({ d }) {
  if (d.isLoading) {
    return <Skeleton variant="rounded" height={120} sx={{ bgcolor: "rgba(255,255,255,0.15)" }} />;
  }

  return <MissionMosaic banner={d.items} missions={d.missions} colors={d.colors} onSelect={d.showInList} />;
}

export function BannerTitle({ d, className = "bp-title" }) {
  return (
    <h1 className={className}>
      {d.isLoading ? (
        <Skeleton width="70%" sx={{ bgcolor: "rgba(255,255,255,0.15)" }} />
      ) : (
        d.items.title || "Banner"
      )}
    </h1>
  );
}

export function ErrorAlert({ d }) {
  return (
    <div className="ob-alert bad" role="alert">
      <div className="grow">{d.error}</div>
      <button type="button" className="btn text sl" onClick={d.retry}>
        Retry
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

  return (
    <>
      {disabledCount > 0 ? (
        <div className="ob-alert bad" role="note">
          <CloudOff />
          <div className="grow">
            <b>
              {disabledCount >= missionCount
                ? `This banner is offline – all ${missionCount} missions are disabled`
                : `${disabledCount} of ${missionCount} missions are offline`}
            </b>
            <span className="small">
              {disabledCount >= missionCount
                ? "You can’t complete it in Ingress any more. The route is kept here for reference."
                : "The banner can’t be fully completed until these missions are back."}
            </span>
          </div>
        </div>
      ) : null}
      {d.warning ? (
        <div className="ob-alert warn" role="note">
          <Warning />
          <div className="grow">
            <b>Bannergress warning</b>
            <span className="small desc">{d.warning}</span>
          </div>
        </div>
      ) : null}
      {d.items.plannedOfflineDate ? (
        <div className="ob-alert warn" role="note">
          <Warning />
          <div className="grow">
            <b>
              Goes offline on{" "}
              {new Date(d.items.plannedOfflineDate).toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </b>
            <span className="small">The author has planned to take this banner down.</span>
          </div>
        </div>
      ) : null}
    </>
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
    distance: ["Distance", wait(d.distanceLabel)],
    missions: ["Missions", wait(d.missionCount)],
    time: ["Est. time", wait(d.durationLabel)],
    perKm: ["Missions / km", wait(d.perKmLabel)],
    order: ["Order", wait(d.orderLabel || null)],
    waypoints: ["Waypoints", wait(d.waypointCount)],
    offline: ["Offline", wait(d.disabledCount)],
  };

  return (
    <div className={className} role="list" aria-label="Key numbers">
      {keys.map((key) => (
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

  return <p className={className}>{d.items.description || "No banner description is available."}</p>;
}

export function BannergressLink({ d, className = "small" }) {
  if (d.isLoading) {
    return null;
  }

  return (
    <p className={className}>
      <a
        href={`https://bannergress.com/banner/${encodeURIComponent(d.items.id ?? d.bannerId)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        View on Bannergress
      </a>
    </p>
  );
}

export function MissionsHeader({ d }) {
  return (
    <div>
      <h2 className="ob-h2" style={{ fontSize: 18 }}>
        {d.missionCount} missions
      </h2>
      <p className="small muted">
        {d.waypointCount} waypoints
        {d.orderLabel ? ` · ${d.orderLabel.toLowerCase()}` : ""}
        {d.disabledCount > 0 ? ` · ${d.disabledCount} offline` : ""}
      </p>
    </div>
  );
}

export function MissionList({ d }) {
  return (
    <ol className="mlist" aria-label="Missions in order">
      {d.missions.map((mission, index) => (
        <MissionItem
          key={mission.id ?? index}
          mission={mission}
          index={index}
          color={d.colors[index]}
          selected={d.selectedMission === index}
          expanded={d.expandedMissions.has(index)}
          onToggle={() => d.toggleMission(index)}
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

  return (
    <section
      className={`bp-map ${className}`.trim()}
      ref={d.mapContainerRef}
      hidden={!d.showMap}
      aria-label="Route map"
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
          aria-label="Show my location"
          title="Show my location"
          disabled={d.isLocatingUser}
          onClick={d.handleLocate}
        >
          <MyLocation />
        </button>
        <button
          type="button"
          className="icon-btn sl"
          aria-label="Show whole route"
          title="Show whole route"
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
          {d.locationError || "Loading map details..."}
        </div>
      ) : null}
      {sheet && !d.isLoading && !d.error ? (
        <div className="bp-sheet" aria-live="polite">
          {d.selected ? (
            <div className="bp-sheet-row">
              <b className="grow">
                Mission {d.selectedMission + 1}: {d.selected.title}
              </b>
              {d.selected.id ? (
                <a
                  className="btn filled sl"
                  href={buildIngressMissionUrl(d.selected.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Ingress
                </a>
              ) : null}
              <button
                type="button"
                className="btn text sl"
                onClick={() => showInList(d.selectedMission)}
              >
                Show in list
              </button>
            </div>
          ) : (
            <>
              <b>
                Whole route · {d.missionCount} missions · {d.distanceLabel}
              </b>
              <div className="small muted">Tap a numbered marker to see that mission</div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

// Mobile Overview / Missions / Map tabs (Map hidden on desktop, where the map is beside).
export function DetailTabs({ d, labels = { overview: "Overview", missions: "Missions", map: "Map" }, className = "" }) {
  return (
    <div className={`bp-tabs ${className}`.trim()} role="tablist" aria-label="Banner detail sections">
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
          {label}
        </button>
      ))}
    </div>
  );
}

