import React, { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { buildIngressMissionUrl, formatLength, getDistanceMeters } from "../bannerDisplay";
import { missionColors } from "./bannerDetails/shared";

// Map of a Mission Day plan, drawn like the banner page's map. Your planned
// missions stand out in their rainbow colour (by number in the banner) with a
// white edge, portal dots and a start numbered by your order; the others are a
// quiet grey layer with their banner number, still tappable to add. Tap a start to add or take out the mission.
const OUT = "#9aa0a6";
const iconCache = new Map();
function startIcon(number, color, order, done) {
  const key = `${number}|${color}|${order}|${done}`;
  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: `mk mk-num mdp-mk${order ? " in" : ""}${done ? " done" : ""}`,
        html: `<span style="--c:${color}">${order || number}</span>`,
        iconSize: order ? [26, 26] : [18, 18],
        iconAnchor: order ? [13, 13] : [9, 9],
        popupAnchor: [0, order ? -13 : -9],
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
  // Rainbow per banner, by mission number, as on the banner page.
  const colorOf = useMemo(() => {
    const counts = new Map();
    for (const mission of missions) {
      counts.set(mission.bannerId, Math.max(counts.get(mission.bannerId) ?? 0, mission.number));
    }
    const palettes = new Map([...counts].map(([bannerId, count]) => [bannerId, missionColors(count)]));
    return (mission) => palettes.get(mission.bannerId)?.[mission.number - 1] ?? "#888";
  }, [missions]);
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
      {/* Not added: thin grey lines underneath. Added: rainbow on top, with a
          white edge and portal dots; done ones dimmed. */}
      {[...missions]
        .sort((a, b) => Number(position.has(a.id)) - Number(position.has(b.id)))
        .map((mission) => {
          const planned = position.get(mission.id);
          if (!planned) {
            return mission.path.length > 1 ? (
              <Polyline
                key={`p-${mission.id}`}
                positions={mission.path}
                pathOptions={{ color: OUT, weight: 2.5, opacity: 0.75, interactive: false }}
              />
            ) : null;
          }
          const opacity = planned.done ? 0.4 : 1;
          return (
            <React.Fragment key={`p-${mission.id}`}>
              {mission.path.length > 1 ? (
                <>
                  <Polyline
                    positions={mission.path}
                    pathOptions={{ color: "#fff", weight: 8, opacity: opacity * 0.85, interactive: false }}
                  />
                  <Polyline
                    positions={mission.path}
                    pathOptions={{ color: colorOf(mission), weight: 5, opacity, interactive: false }}
                  />
                </>
              ) : null}
              {mission.path.slice(1).map((point, index) => (
                <CircleMarker
                  key={index}
                  center={point}
                  radius={4}
                  pathOptions={{ color: "#fff", weight: 1.5, fillColor: colorOf(mission), fillOpacity: 1, opacity, interactive: false }}
                />
              ))}
            </React.Fragment>
          );
        })}
      {walks.map((positions, index) => (
        <Polyline
          key={`w-${index}`}
          positions={positions}
          pathOptions={{ color: "#666", weight: 2, dashArray: "4 6", opacity: 0.8, interactive: false }}
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
            icon={startIcon(mission.number, planned ? colorOf(mission) : OUT, planned ? planned.index + 1 : 0, planned?.done)}
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
                <a className="mdp-popup-link" href={buildIngressMissionUrl(mission.id)}>
                  Open in Ingress
                </a>
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
