// B · Map first: the route on a map with you on it, a bottom sheet with the
// next waypoint. Its own chunk, so variants A and C don't load Leaflet.
import "../../leafletSetup";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, useMap } from "react-leaflet";
import { MapTileLayer } from "../MapLayers";
import { formatLength } from "../../bannerDisplay";
import { distanceMeters } from "../../walkMode";
import { t } from "../../i18n";
import {
  Arrow,
  CompassNote,
  DistanceText,
  MissionLine,
  NoOpenWaypoints,
  NavigateButtons,
  objectiveLabel,
  PassphraseButton,
  PassphraseHint,
  ProgressBar,
} from "./WalkModePage";

const toLatLng = (point) => [point.latitude, point.longitude];

function Camera({ w, follow, sheetHeight }) {
  const map = useMap();
  const lastNext = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 50);
    return () => window.clearTimeout(timer);
  }, [map, sheetHeight]);

  useEffect(() => {
    if (!follow || !w.next) {
      return;
    }
    const padding = { paddingTopLeft: [40, 40], paddingBottomRight: [40, sheetHeight + 30], maxZoom: 18 };
    if (lastNext.current !== w.next.key) {
      lastNext.current = w.next.key;
      const points = w.position ? [toLatLng(w.position), toLatLng(w.next)] : [toLatLng(w.next)];
      if (points.length > 1) {
        map.fitBounds(points, { ...padding, animate: true });
      } else {
        map.setView(points[0], 17, { animate: true });
      }
      return;
    }
    if (w.position && !map.getBounds().pad(-0.2).contains(toLatLng(w.position))) {
      map.fitBounds([toLatLng(w.position), toLatLng(w.next)], { ...padding, animate: true });
    }
  }, [map, follow, w.next, w.position, sheetHeight]);

  return null;
}

function FollowOff({ onDrag }) {
  const map = useMap();
  useEffect(() => {
    map.on("dragstart", onDrag);
    return () => map.off("dragstart", onDrag);
  }, [map, onDrag]);
  return null;
}

export default function WalkMapVariant({ w }) {
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef(null);
  const [sheetHeight, setSheetHeight] = useState(220);
  const start = w.next ?? w.route.waypoints[0];

  useEffect(() => {
    const element = sheetRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(() => setSheetHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lines = useMemo(
    () =>
      w.route.missions
        .map((mission) => ({ mission, points: mission.waypoints.map((index) => toLatLng(w.route.waypoints[index])) }))
        .filter((line) => line.points.length > 1),
    [w.route]
  );
  const currentIndex = w.mission?.index ?? -1;
  const onDrag = useMemo(() => () => setFollow(false), []);

  return (
    <main className="wk-b">
      <div className="wk-b-map">
        <MapContainer center={toLatLng(start)} zoom={17} zoomControl={false} attributionControl preferCanvas style={{ height: "100%", width: "100%" }}>
          <MapTileLayer />
          <Camera w={w} follow={follow} sheetHeight={sheetHeight} />
          <FollowOff onDrag={onDrag} />
          {lines.map(({ mission, points }) => (
            <Polyline
              key={mission.index}
              positions={points}
              pathOptions={{
                color: mission.index === currentIndex ? "#ffcc33" : "#8ab4ff",
                weight: mission.index === currentIndex ? 5 : 3,
                opacity: mission.index === currentIndex ? 0.95 : 0.45,
              }}
            />
          ))}
          {w.route.waypoints.map((waypoint) => {
            const done = w.done.has(waypoint.key);
            const isNext = w.next?.key === waypoint.key;
            if (isNext) {
              return null;
            }
            return (
              <CircleMarker
                key={waypoint.key}
                center={toLatLng(waypoint)}
                radius={waypoint.missionIndex === currentIndex ? 6 : 4}
                pathOptions={{
                  color: "#101014",
                  weight: 1.5,
                  fillColor: done ? "#4caf50" : waypoint.missionIndex === currentIndex ? "#ffcc33" : "#8ab4ff",
                  fillOpacity: done ? 0.9 : 0.85,
                }}
              />
            );
          })}
          {w.next ? (
            <>
              <CircleMarker center={toLatLng(w.next)} radius={22} pathOptions={{ color: "#ffcc33", weight: 1, dashArray: "4 4", fillColor: "#ffcc33", fillOpacity: 0.12 }} />
              <CircleMarker center={toLatLng(w.next)} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#ff9500", fillOpacity: 1 }} />
            </>
          ) : null}
          {w.position ? (
            <>
              {w.gps.accuracy && w.mode === "gps" ? (
                <CircleMarker center={toLatLng(w.position)} radius={14} pathOptions={{ stroke: false, fillColor: "#0a84ff", fillOpacity: 0.18 }} />
              ) : null}
              <CircleMarker center={toLatLng(w.position)} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#0a84ff", fillOpacity: 1 }} />
            </>
          ) : null}
        </MapContainer>
        {!follow ? (
          <button type="button" className="wk-b-follow" onClick={() => setFollow(true)}>
            ◎ {t("Follow")}
          </button>
        ) : null}
      </div>
      <section className={"wk-b-sheet" + (expanded ? " open" : "")} ref={sheetRef} aria-label={t("Next waypoint")}>
        <button type="button" className="wk-b-grab" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded} aria-label={expanded ? t("Show less") : t("Show the mission's steps")}>
          <span />
        </button>
        {w.next ? (
          <>
            <div className="wk-b-row">
              <Arrow rotation={w.rotation} size={64} active={Boolean(w.position)} />
              <div className="wk-b-info">
                <DistanceText w={w} className="wk-b-dist" />
                <h2 className="wk-b-title">{w.next.title || t("Waypoint")}</h2>
                <span className="wk-objective">{objectiveLabel(w.next.objective)}</span>
              </div>
            </div>
            <MissionLine w={w} />
            <div className="wk-actions row">
              <PassphraseButton w={w} compact />
              <NavigateButtons w={w} compact />
              <button type="button" className="wk-btn small ghost" onClick={w.markNextDone}>
                {t("Mark done")}
              </button>
            </div>
            <CompassNote w={w} />
            {expanded ? (
              <>
                <PassphraseHint w={w} />
                <ol className="wk-b-steps">
                  {w.mission.waypoints.map((index, order) => {
                    const waypoint = w.route.waypoints[index];
                    const done = w.done.has(waypoint.key);
                    const distance = w.position ? distanceMeters(w.position, waypoint) : null;
                    return (
                      <li key={waypoint.key} className={(done ? "done" : "") + (waypoint.key === w.next.key ? " next" : "")}>
                        <span>{done ? "✓" : order + 1}</span> {waypoint.title}
                        {!done && distance !== null ? <em> · {formatLength(distance)}</em> : null}
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : null}
          </>
        ) : w.complete ? (
          <div className="wk-finished small">
            <h2>{t("Banner complete")}</h2>
          </div>
        ) : (
          <NoOpenWaypoints w={w} />
        )}
        <ProgressBar w={w} />
      </section>
    </main>
  );
}
