import React, { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { formatLength, getDistanceMeters } from "../bannerDisplay";

// Map of a Mission Day plan: every mission's route with a marker at its start.
// Planned missions are blue with their place in your order; the others are grey
// with their number in the banner. Tap a marker to add or take out the mission.
const PLANNED = "#4c8dff";
const OPEN = "#8a8f98";

const iconCache = new Map();
function startIcon(label, planned, done) {
  const key = `${label}|${planned}|${done}`;
  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: "",
        html: `<span class="mdp-pin${planned ? " in" : ""}${done ? " done" : ""}">${label}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      })
    );
  }
  return iconCache.get(key);
}

// Fits all missions once (per set of banners), then leaves the view to you.
function FitOnce({ points, fitKey }) {
  const map = useMap();
  const done = useRef("");
  useEffect(() => {
    if (points.length && done.current !== fitKey) {
      done.current = fitKey;
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 16 });
    }
  }, [map, points, fitKey]);
  return null;
}

function FlyToMe({ here, request }) {
  const map = useMap();
  useEffect(() => {
    if (here && request) {
      map.flyTo([here.latitude, here.longitude], Math.max(map.getZoom(), 16), { duration: 0.6 });
    }
    // Only when asked (the button), not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return null;
}

export default function PlanMap({ missions, items, here, flyRequest, onToggle }) {
  const position = useMemo(() => new Map(items.map((item, index) => [item.missionId, { index, done: item.done }])), [items]);
  const points = useMemo(() => missions.flatMap((mission) => mission.path), [missions]);
  const fitKey = useMemo(() => [...new Set(missions.map((mission) => mission.bannerId))].join("|"), [missions]);
  const byId = useMemo(() => new Map(missions.map((mission) => [mission.id, mission])), [missions]);
  // The walks between planned missions, in your order.
  const walks = useMemo(() => {
    const result = [];
    for (let index = 0; index + 1 < items.length; index++) {
      const from = byId.get(items[index].missionId)?.end;
      const to = byId.get(items[index + 1].missionId)?.start;
      if (from && to) {
        result.push([[from.latitude, from.longitude], [to.latitude, to.longitude]]);
      }
    }
    return result;
  }, [items, byId]);

  return (
    <MapContainer center={[52.22, 6.89]} zoom={13} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. Not affiliated with Bannergress.'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitOnce points={points} fitKey={fitKey} />
      <FlyToMe here={here} request={flyRequest} />
      {missions.map((mission) =>
        mission.path.length > 1 ? (
          <Polyline
            key={`p-${mission.id}`}
            positions={mission.path}
            pathOptions={{
              color: position.has(mission.id) ? PLANNED : OPEN,
              weight: position.has(mission.id) ? 4 : 3,
              opacity: position.get(mission.id)?.done ? 0.35 : position.has(mission.id) ? 0.9 : 0.6,
              interactive: false,
            }}
          />
        ) : null
      )}
      {walks.map((positions, index) => (
        <Polyline
          key={`w-${index}`}
          positions={positions}
          pathOptions={{ color: PLANNED, weight: 2, dashArray: "4 6", opacity: 0.8, interactive: false }}
        />
      ))}
      {missions.map((mission) => {
        if (!mission.start) {
          return null;
        }
        const planned = position.get(mission.id);
        const distance = here ? getDistanceMeters(here, mission.start) : null;
        return (
          <Marker
            key={`m-${mission.id}`}
            position={[mission.start.latitude, mission.start.longitude]}
            icon={startIcon(planned ? planned.index + 1 : mission.number, Boolean(planned), planned?.done)}
            zIndexOffset={planned ? 1000 : 0}
          >
            <Popup>
              <div className="mdp-popup">
                <b>{mission.shortTitle}</b>
                <span>
                  #{mission.number} of {mission.bannerTitle}
                  {mission.lengthMeters ? ` · ${formatLength(mission.lengthMeters)}` : ""}
                  {distance !== null ? ` · ${formatLength(distance)} from you` : ""}
                </span>
                <span>{planned ? `Number ${planned.index + 1} in your order${planned.done ? " · done" : ""}` : "Not in your plan"}</span>
                <button type="button" className={`btn ${planned ? "text" : "filled"} sl`} onClick={() => onToggle(mission)}>
                  {planned ? "Take out of the plan" : "Add to the plan"}
                </button>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {here ? (
        <CircleMarker
          center={[here.latitude, here.longitude]}
          radius={8}
          pathOptions={{ color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }}
        />
      ) : null}
    </MapContainer>
  );
}
