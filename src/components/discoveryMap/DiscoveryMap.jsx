import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useDiscoveryMap from "./useDiscoveryMap";
import {
  DiscoveryBaseMap,
  LocateButton,
  MapStatusPill,
  OpenBannerLink,
  StatusChip,
  clusterIcon,
  statusDotIcon,
} from "./shared";
import {
  DEFAULT_MAP_FILTERS,
  MAP_FILTERS_STORAGE_KEY,
  MISSION_OPTIONS,
  STATUS_OPTIONS,
  applyMapFilters,
  distanceOptions,
  countActiveMapFilters,
  filterSummary,
  normalizeMapFilters,
} from "./mapFilters";
import { useBannerRoute } from "./bannerRoute";
import { clusterByPixels, formatMinutes, isInsideArea, walkingMinutes } from "./mapMath";
import { FINISH_FLAG_SVG, missionColors } from "../BannerDetailsPage";
import { formatLength } from "../../bannerDisplay";
import BannerImage from "../BannerImage";
import { useRememberEntry, useRestoredEntry } from "../../scrollRestoration";
import "./discoveryMap.css";

const GROUPS = [
  { key: "status", title: "Status", options: STATUS_OPTIONS },
  { key: "distance", title: "Distance", options: distanceOptions() },
  { key: "missions", title: "Number of missions", options: MISSION_OPTIONS },
];

function CustomDistance({ filters, onChange }) {
  const set = (key) => (event) => {
    const value = event.target.value;
    onChange({ ...filters, distance: "custom", [key]: value === "" ? null : Number(value) });
  };

  return (
    <div className="mv-range">
      <label>
        <span>Min</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0"
          value={filters.distMin ?? ""}
          onChange={set("distMin")}
        />
      </label>
      <span aria-hidden="true">–</span>
      <label>
        <span>Max</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="any"
          value={filters.distMax ?? ""}
          onChange={set("distMax")}
        />
      </label>
      <span className="mv-muted">km</span>
    </div>
  );
}
// Room the filter chips take at the top when fitting a route.
const FILTERBAR_SPACE = 56;
const CLUSTER_RADIUS_PX = 34;
// Left over from the map prototypes switcher.
const OLD_VARIANT_STORAGE_KEY = "openbanners.mapVariant";

function readStoredFilters() {
  try {
    return normalizeMapFilters(JSON.parse(window.localStorage.getItem(MAP_FILTERS_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeMapFilters(DEFAULT_MAP_FILTERS);
  }
}

// Same numbered start / checkered finish markers as the banner page (m3.css .mk-*).
function missionStartIcon(index, color) {
  return L.divIcon({
    className: `mk mk-num${index === 0 ? " mk-first" : ""}`,
    html: `<span style="--c:${color}">${index + 1}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function finishIcon(shifted) {
  return L.divIcon({
    className: "mk mk-num mk-finish",
    html: `<span>${FINISH_FLAG_SVG}</span>`,
    iconSize: [22, 22],
    iconAnchor: shifted ? [-3, 25] : [11, 11],
  });
}

function RouteLayer({ route }) {
  const colors = useMemo(() => missionColors(route.missionPositions.length), [route.missionPositions.length]);
  const startIcons = useMemo(
    () => route.missionPositions.map((_, index) => missionStartIcon(index, colors[index])),
    [colors, route.missionPositions]
  );
  const finishMarker = useMemo(() => finishIcon(route.finishShifted), [route.finishShifted]);

  return (
    <>
      {route.allPositions.length > 1 ? (
        <Polyline
          positions={route.allPositions}
          pathOptions={{ color: "#0b0f12", weight: 8, opacity: 0.55, lineCap: "round", lineJoin: "round" }}
        />
      ) : null}
      {route.missionPositions.map((positions, index) =>
        positions.length > 1 ? (
          <Polyline
            key={`m${index}`}
            positions={positions}
            pathOptions={{ color: colors[index], weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }}
          />
        ) : null
      )}
      {route.missionPositions.map((positions, index) => {
        const next = route.missionPositions[index + 1]?.[0];
        const last = positions[positions.length - 1];

        return next && last ? (
          <Polyline
            key={`gap${index}`}
            positions={[last, next]}
            pathOptions={{ color: "#ffffff", weight: 2, opacity: 0.6, dashArray: "3 6" }}
          />
        ) : null;
      })}
      {route.missionPositions.map((positions, index) =>
        positions[0] ? (
          <Marker
            key={`s${index}`}
            position={positions[0]}
            icon={startIcons[index]}
            zIndexOffset={index === 0 ? 1400 : 1200 - index}
            interactive={false}
          />
        ) : null
      )}
      {route.finish ? (
        <Marker position={route.finish.position} icon={finishMarker} zIndexOffset={1500} title="Finish">
          <Tooltip direction="top" offset={[0, -10]}>
            Finish · {route.finish.title}
          </Tooltip>
        </Marker>
      ) : null}
    </>
  );
}

function FilterSheet({ filters, onChange, onClose, focusKey, matchCount }) {
  return (
    <div className="mv-sheet mv-filter-sheet" role="dialog" aria-label="Map filters">
      <div className="mv-grip" aria-hidden="true" />
      <div className="mv-card-head">
        <div className="mv-card-title">Filters</div>
        <button type="button" className="mv-btn icon ghost" aria-label="Close filters" onClick={onClose}>
          ×
        </button>
      </div>
      {GROUPS.map((group) => (
        <section key={group.key} className={`mv-filter-group${focusKey === group.key ? " focus" : ""}`}>
          <h3>{group.title}</h3>
          <div className="mv-seg wrap" role="radiogroup" aria-label={group.title}>
            {group.options.map((option) => (
              <button
                type="button"
                key={option.id}
                role="radio"
                aria-checked={filters[group.key] === option.id}
                className={filters[group.key] === option.id ? "on" : ""}
                onClick={() => onChange({ ...filters, [group.key]: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
          {group.key === "distance" && filters.distance === "custom" ? (
            <CustomDistance filters={filters} onChange={onChange} />
          ) : null}
          {group.note ? <p className="mv-muted">{group.note}</p> : null}
        </section>
      ))}
      <div className="mv-card-actions">
        <button type="button" className="mv-btn" onClick={() => onChange(normalizeMapFilters({ status: "all" }))}>
          Reset
        </button>
        <span className="mv-spacer" />
        <button type="button" className="mv-btn primary" onClick={onClose}>
          Show {matchCount} banner{matchCount === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

// Route card thumbnail: 74 wide, at most 74 × 100; taller banners pan.
const ROUTE_THUMB_ASPECT = 0.74;

function RouteCard({ banner, routeStatus, onClose, cardRef }) {
  const missions = Number(banner.numberOfMissions);
  const minutes = walkingMinutes(banner.lengthMeters);

  return (
    <div className="mv-sheet mv-route-card" ref={cardRef} aria-label="Selected banner">
      <BannerImage banner={banner} className="mv-route-thumb" minAspect={ROUTE_THUMB_ASPECT} />
      <div className="mv-route-body">
        <div className="mv-card-head">
          <div className="mv-card-title">{banner.title}</div>
          <button type="button" className="mv-btn icon ghost" aria-label="Close route" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mv-route-stats">
          <span>
            <b>{formatLength(banner.lengthMeters)}</b>
          </span>
          <span>
            <b>{Number.isFinite(missions) ? missions : "?"}</b> missions
          </span>
          {minutes !== null ? (
            <span>
              <b>~{formatMinutes(minutes)}</b> walk
            </span>
          ) : null}
        </div>
        <div className="mv-mini-row">
          <StatusChip status={banner._status} />
          {routeStatus === "loading" ? <span className="mv-muted">Loading route…</span> : null}
          {routeStatus === "error" ? <span className="mv-muted">Couldn't load the route</span> : null}
          <span className="mv-spacer" />
          <OpenBannerLink banner={banner}>Open</OpenBannerLink>
        </div>
      </div>
    </div>
  );
}

// A group that can't be split by zooming (same spot, or already zoomed in): pick one.
function ClusterSheet({ banners, onPick, onClose }) {
  return (
    <div className="mv-sheet mv-filter-sheet" role="dialog" aria-label={`${banners.length} banners here`}>
      <div className="mv-grip" aria-hidden="true" />
      <div className="mv-card-head">
        <div className="mv-card-title">{banners.length} banners here</div>
        <button type="button" className="mv-btn icon ghost" aria-label="Close list" onClick={onClose}>
          ×
        </button>
      </div>
      <ul className="mv-cluster-list">
        {banners.map((banner) => {
          const missions = Number(banner.numberOfMissions);

          return (
            <li key={banner.id}>
              <button type="button" className="mv-cluster-row" onClick={() => onPick(banner)}>
                <BannerImage banner={banner} mode="contain" className="mv-cluster-thumb" />
                <span className="mv-cluster-text">
                  <b>{banner.title}</b>
                  <span className="mv-muted">
                    {formatLength(banner.lengthMeters)} · {Number.isFinite(missions) ? missions : "?"} missions
                  </span>
                </span>
                <StatusChip status={banner._status} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// /map: status-coloured dots with filter chips; banners reload for whatever is in view.
// Tapping a dot draws that banner's walking route and shows a compact card.
export default function DiscoveryMap() {
  const vm = useDiscoveryMap();
  const { map, banners, liveArea } = vm;
  const [filters, setFilters] = useState(readStoredFilters);
  const [sheet, setSheet] = useState(null); // group key that opened the sheet
  const [clusterList, setClusterList] = useState(null);
  // Back from a banner reopens its card (the viewport itself is remembered
  // in useDiscoveryMap).
  const { entryKey, restored } = useRestoredEntry("map");
  const [selected, setSelected] = useState(restored?.selected ?? null);
  const [cardHeight, setCardHeight] = useState(0);
  const cardRef = useRef(null);
  const routeState = useBannerRoute(selected?.id);
  const route = routeState.data?.route ?? null;
  const summary = filterSummary(filters);
  const activeCount = countActiveMapFilters(filters);
  const showCard = Boolean(selected) && !sheet && !clusterList;

  useRememberEntry(entryKey, "map", { selected });

  useEffect(() => {
    try {
      window.localStorage.setItem(MAP_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Private mode: filters last for this visit.
    }
  }, [filters]);

  useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_VARIANT_STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
  }, []);

  // Floating controls and the route fit stay clear of the card.
  useLayoutEffect(() => {
    const card = cardRef.current;

    if (!showCard || !card) {
      setCardHeight(0);
      return undefined;
    }

    const measure = () => setCardHeight(card.offsetHeight);
    measure();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [showCard, selected?.id]);

  useEffect(() => {
    if (!map?.flyToBounds || !route?.allPositions.length) {
      return;
    }

    const bottom = window.innerWidth >= 900 ? 24 : (cardRef.current?.offsetHeight ?? 150) + 34;
    map.flyToBounds(L.latLngBounds(route.allPositions), {
      paddingTopLeft: [28, FILTERBAR_SPACE + 16],
      paddingBottomRight: [28, bottom],
      maxZoom: 18,
      duration: 0.7,
    });
  }, [map, route]);

  const matching = useMemo(() => applyMapFilters(banners, filters), [banners, filters]);
  const matchingInView = useMemo(
    () => (liveArea ? matching.filter((banner) => isInsideArea(banner, liveArea)) : matching),
    [liveArea, matching]
  );
  const inViewCount = useMemo(
    () => (liveArea ? banners.filter((banner) => isInsideArea(banner, liveArea)).length : banners.length),
    [banners, liveArea]
  );
  // The selected banner stays on the map when a new search or filter drops it.
  const shownBanners = useMemo(
    () => (selected && !matching.some((banner) => banner.id === selected.id) ? [...matching, selected] : matching),
    [matching, selected]
  );
  const controlsBottom = showCard ? cardHeight + 26 : 0;
  // Nearby dots merge into a count bubble so a zoomed-out map stays readable.
  const clusters = useMemo(() => {
    const others = shownBanners.filter((banner) => banner.id !== selected?.id);

    if (!map?.project) {
      return others.map((banner) => ({ key: banner.id, banners: [banner] }));
    }

    const items = others.map((banner) => {
      const pixel = map.project([banner._latitude, banner._longitude], vm.zoom);
      return { x: pixel.x, y: pixel.y, banner };
    });

    return clusterByPixels(items, CLUSTER_RADIUS_PX).map((cluster) => ({
      key: cluster.items[0].banner.id,
      banners: cluster.items.map((item) => item.banner),
    }));
  }, [map, selected?.id, shownBanners, vm.zoom]);
  // Zoom in until the group splits; if zooming can't split it, list its banners.
  const openCluster = (members) => {
    if (!map?.flyToBounds) {
      return;
    }

    const bounds = L.latLngBounds(members.map((banner) => [banner._latitude, banner._longitude]));
    const padTopLeft = L.point(40, FILTERBAR_SPACE + 30);
    const padBottomRight = L.point(40, controlsBottom + 40);
    const maxZoom = map.getMaxZoom?.() ?? 18;
    const fitZoom = Math.min(map.getBoundsZoom(bounds, false, padTopLeft.add(padBottomRight)), maxZoom);
    const splitsAt = (zoomLevel) =>
      clusterByPixels(
        members.map((banner) => {
          const pixel = map.project([banner._latitude, banner._longitude], zoomLevel);
          return { x: pixel.x, y: pixel.y };
        }),
        CLUSTER_RADIUS_PX
      ).length > 1;

    if (fitZoom > map.getZoom() && splitsAt(fitZoom)) {
      map.flyToBounds(bounds, { paddingTopLeft: padTopLeft, paddingBottomRight: padBottomRight, maxZoom, duration: 0.5 });
      return;
    }

    // Find the first zoom level where the group splits; otherwise show the list.
    for (let zoomLevel = map.getZoom() + 1; zoomLevel <= maxZoom; zoomLevel += 1) {
      if (splitsAt(zoomLevel)) {
        map.flyTo(bounds.getCenter(), zoomLevel, { duration: 0.5 });
        return;
      }
    }

    setSelected(null);
    setClusterList(members);
  };

  return (
    <div className="mv-root">
      <DiscoveryBaseMap
        vm={vm}
        onMapClick={() => {
          setSelected(null);
          setClusterList(null);
        }}
      >
        {selected && !route ? (
          <Marker
            key={selected.id}
            position={[selected._latitude, selected._longitude]}
            icon={statusDotIcon(selected._status, { selected: true })}
            zIndexOffset={1000}
          />
        ) : null}
        {clusters.map(({ key, banners: members }) => {
          if (members.length > 1) {
            return (
              <Marker
                key={`c:${key}`}
                position={[
                  members.reduce((sum, banner) => sum + banner._latitude, 0) / members.length,
                  members.reduce((sum, banner) => sum + banner._longitude, 0) / members.length,
                ]}
                icon={clusterIcon(members, { dim: Boolean(selected) })}
                zIndexOffset={members.length}
                title={`${members.length} banners`}
                eventHandlers={{ click: () => openCluster(members) }}
              />
            );
          }

          const banner = members[0];

          return (
            <Marker
              key={banner.id}
              position={[banner._latitude, banner._longitude]}
              icon={statusDotIcon(banner._status, { dim: Boolean(selected) })}
              eventHandlers={{ click: () => setSelected(banner) }}
            >
              {!selected ? (
                <Tooltip direction="top" offset={[0, -10]}>
                  {banner.title}
                </Tooltip>
              ) : null}
            </Marker>
          );
        })}
        {route ? <RouteLayer route={route} /> : null}
      </DiscoveryBaseMap>

      <div className="mv-filterbar" role="toolbar" aria-label="Filters">
        <button
          type="button"
          className={`mv-fchip${activeCount ? " on" : ""}`}
          aria-label={activeCount ? `Filters (${activeCount} on)` : "Filters"}
          onClick={() => setSheet("status")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
          </svg>
          {activeCount ? activeCount : "Filters"}
        </button>
        {GROUPS.map((group) => {
          const active =
            group.key === "status"
              ? filters.status !== "all"
              : group.key === "distance"
                ? summary.distance !== "Any distance"
                : filters[group.key] !== "any";

          return (
            <button
              type="button"
              key={group.key}
              className={`mv-fchip${active ? " on" : ""}`}
              onClick={() => setSheet(group.key)}
            >
              {summary[group.key]}
              <span aria-hidden="true">▾</span>
            </button>
          );
        })}
      </div>
      <div className="mv-count" style={{ top: FILTERBAR_SPACE }} role="status">
        {vm.loading && !vm.banners.length ? "Loading…" : `${matchingInView.length} of ${inViewCount} in view`}
        {!vm.loading && !selected && matchingInView.length ? (
          <span className="mv-count-hint"> · tap one for its route</span>
        ) : null}
      </div>
      <LocateButton vm={vm} style={{ bottom: controlsBottom + 24 }} />
      <MapStatusPill vm={vm} count={matching.length} noun="matching banners" bottom={controlsBottom + 16} />

      {showCard ? (
        <RouteCard
          banner={selected}
          routeStatus={routeState.status}
          onClose={() => setSelected(null)}
          cardRef={cardRef}
        />
      ) : null}
      {clusterList && !sheet ? (
        <ClusterSheet
          banners={clusterList}
          onClose={() => setClusterList(null)}
          onPick={(banner) => {
            setClusterList(null);
            setSelected(banner);
          }}
        />
      ) : null}
      {sheet ? (
        <FilterSheet
          filters={filters}
          onChange={setFilters}
          onClose={() => setSheet(null)}
          focusKey={sheet}
          matchCount={matchingInView.length}
        />
      ) : null}
    </div>
  );
}
