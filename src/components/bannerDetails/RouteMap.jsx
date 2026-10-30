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
  const startIcons = useMemo(
    () => missions.map((_, index) => createStartIcon(index, colors[index], index === selectedMission)),
    [colors, missions, selectedMission]
  );
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
