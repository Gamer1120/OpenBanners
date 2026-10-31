// The banner page's route map (Leaflet). Loaded on its own (React.lazy in
// MapSection), so the banner page doesn't need Leaflet until the map shows:
// on phones that's only when the Map tab is opened.
import "../../leafletSetup";
import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { WORLD_PLACEHOLDER } from "../../mapDefaults";
import { buildGeoUrl } from "../../bannerDisplay";
import userLocationIcon from "../../constants";
import { t, tn } from "../../i18n";
import { formatMissionNumbers } from "../../bannerFacts";
import { areAdjacent } from "../../bannerMissions";
import { FINISH_FLAG_SVG, getFinish, getStepPosition, getSteps, isOnStartMarker } from "./shared";
import {
  clusterStartGroups,
  getClusterLabel,
  getClusterReach,
  getStartBadges,
  groupStartMarkers,
  pickBadgeMission,
  WAYPOINTS_FROM_ZOOM,
} from "./startMarkers";

function createStartIcon(index, color, selected) {
  // Mission 1 is the start: same numbered circle as the others, in its own colour.
  return L.divIcon({
    className: `mk mk-num${index === 0 ? " mk-first" : ""}${selected ? " sel" : ""}`,
    html: `<span style="--c:${color}">${index + 1}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// Several missions start at this portal: one marker with every number stacked in it,
// like Bannergress' cluster pin (mission 1 on top, then down). The portal is under the
// top badge, so the finish flag can still sit up-right of it.
function createStackIcon(badges, colors, selectedMission) {
  const html = badges
    .map((badge, badgeIndex) => {
      const selected = badge.indexes.includes(selectedMission);
      const classes = [
        badge.indexes.length > 1 ? "rng" : "",
        badge.indexes[0] === 0 ? "first" : "",
        selected ? "sel" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const color = colors[selected ? selectedMission : badge.indexes[0]];

      return `<span class="${classes}" data-badge="${badgeIndex}" style="--c:${color}">${badge.label}</span>`;
    })
    .join("");
  const width = getStackWidth(badges);

  return L.divIcon({
    className: "mk mk-num mk-stack",
    html,
    iconSize: [width, 22 + (badges.length - 1) * 18],
    iconAnchor: [width / 2, 10],
  });
}

function getStackWidth(badges) {
  return badges.some((badge) => badge.indexes.length > 1) ? 44 : 22;
}

function createFinishIcon(shifted, startWidth = 22) {
  // Shifted up-right when a numbered start marker sits on the same portal (past its
  // right edge when that marker is a wider range badge).
  return L.divIcon({
    className: "mk mk-num mk-finish",
    html: `<span>${FINISH_FLAG_SVG}</span>`,
    iconSize: [22, 22],
    iconAnchor: shifted ? [-3 - (startWidth - 22) / 2, 25] : [11, 11],
  });
}

function createWaypointIcon(color) {
  return L.divIcon({
    className: "mk mk-wp",
    html: `<span style="--c:${color}"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

// Several start markers that would overlap at this zoom: one pill with their numbers
// ("12–40"), drawn as a little stack. Tapping it zooms in until they separate.
function createClusterIcon(indexes, color, hasFirst) {
  const label = getClusterLabel(indexes);
  const width = Math.max(30, 12 + label.length * 7);

  return L.divIcon({
    className: `mk mk-cluster${hasFirst ? " first" : ""}`,
    html: `<span style="--c:${color}">${label}</span>`,
    iconSize: [width, 24],
    iconAnchor: [width / 2, 12],
  });
}

// Leaflet's view (zoom + a padded bounds), updated after every zoom or move.
function useMapView(map) {
  const read = () => {
    const bounds = typeof map?.getBounds === "function" ? map.getBounds() : null;

    return {
      zoom: typeof map?.getZoom === "function" ? map.getZoom() : 0,
      bounds: bounds && typeof bounds.pad === "function" ? bounds.pad(0.5) : null,
    };
  };
  const [view, setView] = useState(read);

  useEffect(() => {
    const update = () => setView(read());
    map?.on?.("zoomend moveend", update);
    update();
    return () => map?.off?.("zoomend moveend", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return view;
}

export default function RouteMap({
  missions,
  colors,
  missionPositions,
  missionSlots,
  selectedMission,
  onSelectMission,
  userLocation,
  isMobile,
  mapRef,
  onReady,
}) {
  const pointCount = missionPositions.reduce((total, positions) => total + positions.length, 0);

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
      <RouteLayers
        missions={missions}
        colors={colors}
        missionPositions={missionPositions}
        missionSlots={missionSlots}
        selectedMission={selectedMission}
        onSelectMission={onSelectMission}
        userLocation={userLocation}
      />
    </MapContainer>
  );
}

// Everything on the map, the same rule for every banner (2026-10-31, Michael: a
// 1152-mission banner drowned in waypoints): route lines always; start markers that
// would overlap at this zoom merged into one cluster marker; the waypoints of every
// mission only from zoom WAYPOINTS_FROM_ZOOM on, and only near the view; the selected
// mission's waypoints and start marker always.
function RouteLayers({
  missions,
  colors,
  missionPositions,
  missionSlots,
  selectedMission,
  onSelectMission,
  userLocation,
}) {
  const map = useMap();
  const { zoom, bounds } = useMapView(map);
  const inView = (position) => !bounds || bounds.contains(position);
  const groups = useMemo(() => groupStartMarkers(missionPositions), [missionPositions]);
  const startMarkers = useMemo(
    () =>
      groups.map(({ position, indexes }) => {
        if (indexes.length === 1) {
          const [index] = indexes;

          return {
            position,
            indexes,
            icon: createStartIcon(index, colors[index], index === selectedMission),
          };
        }

        const badges = getStartBadges(indexes);

        return { position, indexes, badges, icon: createStackIcon(badges, colors, selectedMission) };
      }),
    [colors, groups, selectedMission]
  );
  // Start markers merged per zoom level; the selected mission's marker stays on its own.
  const clusters = useMemo(() => {
    const project =
      typeof map?.project === "function" ? (position) => map.project(position, zoom) : () => null;

    return clusterStartGroups(startMarkers, project, getClusterReach(missions.length), (marker) =>
      marker.indexes.includes(selectedMission)
    );
  }, [map, missions.length, selectedMission, startMarkers, zoom]);
  const zoomIntoCluster = (cluster) => {
    const starts = cluster.indexes.map((index) => missionPositions[index]?.[0]).filter(Boolean);

    if (starts.length && typeof map?.fitBounds === "function") {
      map.fitBounds(starts, { padding: [56, 56], maxZoom: 18 });
    }
  };

  // A mission picked in the list (or on the map) that isn't fully in view: show it.
  useEffect(() => {
    const positions = missionPositions[selectedMission];
    const view = typeof map?.getBounds === "function" ? map.getBounds() : null;

    if (!positions?.length || typeof view?.contains !== "function" || typeof map.fitBounds !== "function") {
      return;
    }

    if (!positions.every((position) => view.contains(position))) {
      map.fitBounds(positions, { padding: [48, 48], maxZoom: 17 });
    }
    // Only when the selection changes, not on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMission]);
  const onStartMarkerClick = (marker, event) => {
    if (!marker.badges) {
      onSelectMission(marker.indexes[0]);
      return;
    }

    // A tap on a badge picks its mission; otherwise (keyboard) step through all of them.
    const badgeIndex = Number(event?.originalEvent?.target?.closest?.("[data-badge]")?.dataset.badge);
    const badge = marker.badges[badgeIndex];

    onSelectMission(pickBadgeMission(badge ? badge.indexes : marker.indexes, selectedMission));
  };
  const connectors = useMemo(
    () =>
      missionPositions.flatMap((positions, index) => {
        const next = missionPositions[index + 1];

        // Like Bannergress: no line across a filler slot (a mission of another banner).
        return positions.length && next?.length && areAdjacent(missionSlots, index)
          ? [{ key: `connector-${index}`, positions: [positions[positions.length - 1], next[0]] }]
          : [];
      }),
    [missionPositions, missionSlots]
  );
  const selectedSteps = selectedMission >= 0 ? getSteps(missions[selectedMission]) : [];
  const waypointIcon = useMemo(
    () => (selectedMission >= 0 ? createWaypointIcon(colors[selectedMission]) : null),
    [colors, selectedMission]
  );
  const finish = useMemo(() => getFinish(missions), [missions]);
  // Many lines and dots draw on one canvas. MapContainer's preferCanvas only counts when
  // the map is created, which on desktop is before the banner has loaded.
  const manyPoints = missionPositions.reduce((total, positions) => total + positions.length, 0) > 200;
  const renderer = useMemo(() => (manyPoints ? L.canvas({ padding: 0.5 }) : undefined), [manyPoints]);
  const showAllWaypoints = selectedMission < 0 && zoom >= WAYPOINTS_FROM_ZOOM;
  const lineWeight = zoom < 12 ? 3 : 4;
  const finishIcon = useMemo(() => {
    if (!finish) {
      return null;
    }

    const startHere = startMarkers.find((marker) => isOnStartMarker(finish.position, [[marker.position]]));

    return createFinishIcon(Boolean(startHere), startHere?.badges ? getStackWidth(startHere.badges) : 22);
  }, [finish, startMarkers]);

  return (
    <>
      {connectors.map((connector) => (
        <Polyline
          key={connector.key}
          positions={connector.positions}
          renderer={renderer}
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
              weight: selectedMission === index ? 6 : lineWeight,
              opacity: selectedMission >= 0 && selectedMission !== index ? 0.45 : 0.9,
            }}
            renderer={renderer}
            eventHandlers={{ click: () => onSelectMission(index) }}
          />
        ) : null
      )}
      {showAllWaypoints
        ? missions.flatMap((mission, missionIndex) =>
            getSteps(mission).map((step, stepIndex) => {
              const position = getStepPosition(step);

              if (!position || stepIndex === 0 || step?.poi?.type === "unavailable" || !inView(position)) {
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
                  renderer={renderer}
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
      {[...clusters].reverse().map((cluster) => {
        const index = cluster.indexes[0];
        const zIndexOffset = index === 0 ? 1000 : 500 - index;

        if (cluster.groups.length > 1) {
          if (!inView(cluster.position)) {
            return null;
          }

          return (
            <Marker
              key={`cluster-${cluster.indexes[0]}-${cluster.indexes.length}`}
              position={cluster.position}
              icon={createClusterIcon(cluster.indexes, colors[index], index === 0)}
              title={`${tn(
                "{count} mission starts here – tap to zoom in",
                "{count} missions start here – tap to zoom in",
                cluster.indexes.length
              )}\n${formatMissionNumbers(cluster.indexes)}`}
              zIndexOffset={zIndexOffset}
              eventHandlers={{ click: () => zoomIntoCluster(cluster) }}
            />
          );
        }

        const [marker] = cluster.groups;

        if (!inView(marker.position) && !marker.indexes.includes(selectedMission)) {
          return null;
        }

        return (
          <Marker
            key={`start-${marker.indexes.map((missionIndex) => missions[missionIndex]?.id ?? missionIndex).join("-")}`}
            position={marker.position}
            icon={marker.icon}
            title={marker.indexes
              .map((missionIndex) =>
                t("Mission {number}: {title}", {
                  number: missionIndex + 1,
                  title: missions[missionIndex]?.title ?? "",
                })
              )
              .join("\n")}
            zIndexOffset={marker.indexes.includes(selectedMission) ? 1200 : zIndexOffset}
            eventHandlers={{ click: (event) => onStartMarkerClick(marker, event) }}
          />
        );
      })}
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
    </>
  );
}
