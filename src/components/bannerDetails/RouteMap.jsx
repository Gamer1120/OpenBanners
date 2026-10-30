// The banner page's route map (Leaflet). Loaded on its own (React.lazy in
// MapSection), so the banner page doesn't need Leaflet until the map shows:
// on phones that's only when the Map tab is opened.
import "../../leafletSetup";
import React, { useMemo } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { WORLD_PLACEHOLDER } from "../../mapDefaults";
import { buildGeoUrl } from "../../bannerDisplay";
import userLocationIcon from "../../constants";
import { t } from "../../i18n";
import { areAdjacent } from "../../bannerMissions";
import { FINISH_FLAG_SVG, getFinish, getStepPosition, getSteps, isOnStartMarker } from "./shared";
import { getStartBadges, groupStartMarkers, pickBadgeMission } from "./startMarkers";

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
  const startMarkers = useMemo(
    () =>
      groupStartMarkers(missionPositions).map(({ position, indexes }) => {
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
    [colors, missionPositions, selectedMission]
  );
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
  const pointCount = missionPositions.reduce((total, positions) => total + positions.length, 0);
  const finish = useMemo(() => getFinish(missions), [missions]);
  const finishIcon = useMemo(() => {
    if (!finish) {
      return null;
    }

    const startHere = startMarkers.find((marker) => isOnStartMarker(finish.position, [[marker.position]]));

    return createFinishIcon(Boolean(startHere), startHere?.badges ? getStackWidth(startHere.badges) : 22);
  }, [finish, startMarkers]);

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
      {[...startMarkers].reverse().map((marker) => {
        const index = marker.indexes[0];

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
            zIndexOffset={index === 0 ? 1000 : 500 - index}
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
    </MapContainer>
  );
}
