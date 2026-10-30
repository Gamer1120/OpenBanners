import "../../leafletSetup";
import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useDiscoveryMap from "./useDiscoveryMap";
import {
  DiscoveryBaseMap,
  LocateButton,
  MapStatusPill,
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
import { clusterByPixels, isInsideArea } from "./mapMath";
import { areaCenter, buildRow, sortByDistance } from "./rowModel";
import { BannerCarousel, BannerSideList } from "./BannerRow";
import { FINISH_FLAG_SVG, missionColors } from "../BannerDetailsPage";
import { formatLength } from "../../bannerDisplay";
import BannerImage from "../BannerImage";
import { useRememberEntry, useRestoredEntry } from "../../scrollRestoration";
import { t, tk, tn } from "../../i18n";
import "./discoveryMap.css";

const GROUPS = [
  { key: "status", title: tk("Status"), options: STATUS_OPTIONS },
  { key: "distance", title: tk("Distance"), options: distanceOptions() },
  { key: "missions", title: tk("Number of missions"), options: MISSION_OPTIONS },
];

function CustomDistance({ filters, onChange }) {
  const set = (key) => (event) => {
    const value = event.target.value;
    onChange({ ...filters, distance: "custom", [key]: value === "" ? null : Number(value) });
  };

  return (
    <div className="mv-range">
      <label>
        <span>{t("Min")}</span>
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
        <span>{t("Max")}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder={t("any")}
          value={filters.distMax ?? ""}
          onChange={set("distMax")}
        />
      </label>
      <span className="mv-muted">km</span>
    </div>
  );
}
// Room the filter chips take at the top when fitting the map.
const FILTERBAR_SPACE = 56;
// Room the desktop list takes on the right (.mv-side: 340-440 px wide, 12 px
// from the edge); measured when it is on screen, this is the fallback.
const SIDE_LIST_SPACE = 352;
const SIDE_LIST_MARGIN = 12;

function sideListSpace() {
  const width = document.querySelector(".mv-side")?.offsetWidth;
  return width ? width + SIDE_LIST_MARGIN : SIDE_LIST_SPACE;
}
// The row sits this far above the bottom edge (clear of the OSM attribution).
const ROW_BOTTOM = 18;
const ROW_FOLDED_STORAGE_KEY = "openbanners.mapRowFolded";
// Same breakpoint as the navigation rail (m3.css): wider screens get the side list.
const WIDE_QUERY = "(min-width: 840px)";

function subscribeWide(callback) {
  const query = window.matchMedia?.(WIDE_QUERY);
  query?.addEventListener?.("change", callback);
  return () => query?.removeEventListener?.("change", callback);
}

function useIsWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => Boolean(window.matchMedia?.(WIDE_QUERY).matches),
    () => false
  );
}

function readFolded() {
  try {
    return window.localStorage.getItem(ROW_FOLDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
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
        <Marker position={route.finish.position} icon={finishMarker} zIndexOffset={1500} title={t("Finish")}>
          <Tooltip direction="top" offset={[0, -10]}>
            {t("Finish · {title}", { title: route.finish.title })}
          </Tooltip>
        </Marker>
      ) : null}
    </>
  );
}

function FilterSheet({ filters, onChange, onClose, focusKey, matchCount }) {
  return (
    <div className="mv-sheet mv-filter-sheet" role="dialog" aria-label={t("Map filters")}>
      <div className="mv-grip" aria-hidden="true" />
      <div className="mv-card-head">
        <div className="mv-card-title">{t("Filters")}</div>
        <button type="button" className="mv-btn icon ghost" aria-label={t("Close filters")} onClick={onClose}>
          ×
        </button>
      </div>
      {GROUPS.map((group) => (
        <section key={group.key} className={`mv-filter-group${focusKey === group.key ? " focus" : ""}`}>
          <h3>{t(group.title)}</h3>
          <div className="mv-seg wrap" role="radiogroup" aria-label={t(group.title)}>
            {group.options.map((option) => (
              <button
                type="button"
                key={option.id}
                role="radio"
                aria-checked={filters[group.key] === option.id}
                className={filters[group.key] === option.id ? "on" : ""}
                onClick={() => onChange({ ...filters, [group.key]: option.id })}
              >
                {t(option.label)}
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
          {t("Reset")}
        </button>
        <span className="mv-spacer" />
        <button type="button" className="mv-btn primary" onClick={onClose}>
          {tn("Show {count} banner", "Show {count} banners", matchCount)}
        </button>
      </div>
    </div>
  );
}

// Banner list sheet: everything in view (from the "+N more" card).
function ClusterSheet({ banners, onPick, onClose }) {
  const heading = tn("{count} banner here", "{count} banners here", banners.length);

  return (
    <div className="mv-sheet mv-filter-sheet" role="dialog" aria-label={heading}>
      <div className="mv-grip" aria-hidden="true" />
      <div className="mv-card-head">
        <div className="mv-card-title">{heading}</div>
        <button type="button" className="mv-btn icon ghost" aria-label={t("Close list")} onClick={onClose}>
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
                    {formatLength(banner.lengthMeters)} ·{" "}
                    {Number.isFinite(missions)
                      ? tn("{count} mission", "{count} missions", missions)
                      : t("? missions")}
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
// The banners in view are cards (phone: a scrolling row above the bottom bar,
// desktop: a list beside the map), nearest to the map centre first. Nothing is
// selected until a card or dot is tapped; the selected card's dot is enlarged and
// its walking route is drawn. Tapping it again deselects it.
export default function DiscoveryMap() {
  const vm = useDiscoveryMap();
  const { map, banners, liveArea } = vm;
  const isWide = useIsWide();
  const [filters, setFilters] = useState(readStoredFilters);
  const [sheet, setSheet] = useState(null); // group key that opened the sheet
  const [moreOpen, setMoreOpen] = useState(false);
  // Back from a banner reselects its card (the viewport itself is remembered
  // in useDiscoveryMap).
  const { entryKey, restored } = useRestoredEntry("map");
  const [focusId, setFocusId] = useState(restored?.focusId ?? restored?.selected?.id ?? null);
  const [hoverId, setHoverId] = useState(null);
  // Ids of a group of dots that zooming can't split: the row shows only those.
  const [pinned, setPinned] = useState(null);
  const [folded, setFolded] = useState(readFolded);
  const [rowHeight, setRowHeight] = useState(0);
  const rowRef = useRef(null);
  const lastFocused = useRef(restored?.selected ?? null);
  const activeCount = countActiveMapFilters(filters);
  const summary = filterSummary(filters);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(ROW_FOLDED_STORAGE_KEY, folded ? "1" : "0");
    } catch {
      // Private mode: remembered for this visit.
    }
  }, [folded]);

  const matching = useMemo(() => applyMapFilters(banners, filters), [banners, filters]);
  const byId = useMemo(() => new globalThis.Map(matching.map((banner) => [banner.id, banner])), [matching]);
  const matchingInView = useMemo(
    () => (liveArea ? matching.filter((banner) => isInsideArea(banner, liveArea)) : matching),
    [liveArea, matching]
  );
  const center = useMemo(() => areaCenter(liveArea), [liveArea]);
  const sortedInView = useMemo(() => sortByDistance(matchingInView, center), [center, matchingInView]);
  const groupList = useMemo(
    () => (pinned ? sortedInView.filter((banner) => pinned.includes(banner.id)) : null),
    [pinned, sortedInView]
  );
  const inGroup = Boolean(groupList?.length);
  const rowList = inGroup ? groupList : sortedInView;
  const row = useMemo(() => buildRow(rowList, focusId), [focusId, rowList]);

  // The group ends once none of its banners are in view any more.
  useEffect(() => {
    if (pinned && !groupList?.length) {
      setPinned(null);
    }
  }, [pinned, groupList]);

  // After the map moved or the filters changed, the selection stays while its
  // banner is still listed and is dropped otherwise (no route for a banner that
  // has no card). Nothing else gets selected. (While banners load, it may still
  // arrive.)
  useEffect(() => {
    if (!focusId || vm.loading || !vm.banners.length) {
      return;
    }

    if (!rowList.some((banner) => banner.id === focusId)) {
      setFocusId(null);
    }
  }, [focusId, rowList, vm.banners.length, vm.loading]);

  const focused = focusId ? (byId.get(focusId) ?? (lastFocused.current?.id === focusId ? lastFocused.current : null)) : null;
  lastFocused.current = focused ?? lastFocused.current;

  useRememberEntry(entryKey, "map", { focusId, selected: focused });

  const rowVisible = !isWide && !sheet && !moreOpen && rowList.length > 0;
  const rowOpen = rowVisible && !folded;
  // What the map shows as selected: the tapped card (on phones not while the row
  // is folded or hidden). Its route loads right away.
  const selected = isWide || rowOpen ? focused : null;
  const selectedId = selected?.id ?? null;
  const routeState = useBannerRoute(selectedId);
  const route = selectedId ? (routeState.data?.route ?? null) : null;
  const routeStatus = selectedId ? routeState.status : "idle";

  // Floating controls stay clear of the row.
  useLayoutEffect(() => {
    const element = rowRef.current;

    if (!rowVisible || !element) {
      setRowHeight(0);
      return undefined;
    }

    const measure = () => setRowHeight(element.offsetHeight);
    measure();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rowVisible, folded]);

  const controlsBottom = rowVisible ? rowHeight + ROW_BOTTOM : 0;

  // Nearby dots merge into a count bubble so a zoomed-out map stays readable.
  // Selection and hover are drawn as separate markers on top, so the dots don't
  // change (or re-render) while swiping.
  const clusters = useMemo(() => {
    if (!map?.project) {
      return matching.map((banner) => ({ key: banner.id, banners: [banner] }));
    }

    const items = matching.map((banner) => {
      const pixel = map.project([banner._latitude, banner._longitude], vm.zoom);
      return { x: pixel.x, y: pixel.y, banner };
    });

    return clusterByPixels(items, CLUSTER_RADIUS_PX).map((cluster) => ({
      key: cluster.items[0].banner.id,
      banners: cluster.items.map((item) => item.banner),
    }));
  }, [map, matching, vm.zoom]);

  const selectBanner = (id) => {
    setMoreOpen(false);
    setFolded(false);
    setFocusId(id);

    if (pinned && !pinned.includes(id)) {
      setPinned(null);
    }
  };
  // A card or dot: selects its banner, or deselects it when it is the selected one.
  const toggleRef = useRef(null);
  toggleRef.current = (id) => (id === selectedId ? setFocusId(null) : selectBanner(id));
  const toggleBanner = useCallback((id) => toggleRef.current(id), []);

  // Zoom in until the group splits; if zooming can't split it, its banners
  // become the row.
  const openCluster = (members) => {
    if (!map?.flyToBounds) {
      return;
    }

    const bounds = L.latLngBounds(members.map((banner) => [banner._latitude, banner._longitude]));
    const padTopLeft = L.point(40, FILTERBAR_SPACE + 30);
    // On desktop the list covers the right of the map: fit the group beside it.
    const padBottomRight = L.point(40 + (isWide && rowList.length ? sideListSpace() : 0), controlsBottom + 40);
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

    // Find the first zoom level where the group splits; otherwise list the group.
    for (let zoomLevel = map.getZoom() + 1; zoomLevel <= maxZoom; zoomLevel += 1) {
      if (splitsAt(zoomLevel)) {
        // Centre the group in the uncovered part of the map.
        const offset = padBottomRight.subtract(padTopLeft).divideBy(2);
        const target = map.unproject(map.project(bounds.getCenter(), zoomLevel).add(offset), zoomLevel);
        map.flyTo(target, zoomLevel, { duration: 0.5 });
        return;
      }
    }

    showGroup(members);
  };
  const showGroup = (members) => {
    setPinned(members.map((banner) => banner.id));
    setMoreOpen(false);
    setFolded(false);
  };
  const openClusterRef = useRef(openCluster);
  openClusterRef.current = openCluster;

  const markers = useMemo(
    () =>
      clusters.map(({ key, banners: members }) => {
        if (members.length > 1) {
          return (
            <Marker
              key={`c:${key}`}
              position={[
                members.reduce((sum, banner) => sum + banner._latitude, 0) / members.length,
                members.reduce((sum, banner) => sum + banner._longitude, 0) / members.length,
              ]}
              icon={clusterIcon(members)}
              zIndexOffset={members.length}
              title={tn("{count} banner", "{count} banners", members.length)}
              eventHandlers={{ click: () => openClusterRef.current(members) }}
            />
          );
        }

        const banner = members[0];

        return (
          <Marker
            key={banner.id}
            position={[banner._latitude, banner._longitude]}
            icon={statusDotIcon(banner._status)}
            eventHandlers={{ click: () => toggleBanner(banner.id) }}
          >
            {isWide ? (
              <Tooltip direction="top" offset={[0, -10]}>
                {banner.title}
              </Tooltip>
            ) : null}
          </Marker>
        );
      }),
    [clusters, isWide, toggleBanner]
  );
  const hovered = isWide && hoverId && hoverId !== selectedId ? byId.get(hoverId) : null;
  const rowProps = {
    items: row.items,
    moreCount: row.moreCount,
    count: rowList.length,
    focusId,
    onToggle: toggleBanner,
    onMore: () => setMoreOpen(true),
    inGroup,
    onExitGroup: () => setPinned(null),
    routeStatus,
  };

  return (
    <div className={`mv-root${isWide ? " wide" : ""}${L.Browser.mobile ? "" : " zoomctl"}`}>
      <DiscoveryBaseMap
        vm={vm}
        onMapClick={() => {
          setMoreOpen(false);
          setFocusId(null);
        }}
      >
        {markers}
        {hovered ? (
          <Marker
            key={`h:${hovered.id}`}
            position={[hovered._latitude, hovered._longitude]}
            icon={statusDotIcon(hovered._status, { hover: true })}
            zIndexOffset={900}
            interactive={false}
          />
        ) : null}
        {selected && !route ? (
          <Marker
            key={`s:${selected.id}`}
            position={[selected._latitude, selected._longitude]}
            icon={statusDotIcon(selected._status, { selected: true })}
            zIndexOffset={1000}
            interactive={false}
          />
        ) : null}
        {route ? <RouteLayer route={route} /> : null}
      </DiscoveryBaseMap>

      <div className="mv-filterbar" role="toolbar" aria-label={t("Filters")}>
        <button
          type="button"
          className={`mv-fchip${activeCount ? " on" : ""}`}
          aria-label={activeCount ? t("Filters ({count} on)", { count: activeCount }) : t("Filters")}
          onClick={() => setSheet("status")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
          </svg>
          {activeCount ? activeCount : t("Filters")}
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
              {t(summary[group.key])}
              <span aria-hidden="true">▾</span>
            </button>
          );
        })}
      </div>
      {vm.loading && vm.banners.length ? (
        <div className="mv-count" style={{ top: FILTERBAR_SPACE }} role="status">
          {t("Loading…")}
        </div>
      ) : null}
      <LocateButton vm={vm} style={{ bottom: controlsBottom + 24 }} />
      <MapStatusPill
        vm={vm}
        count={matchingInView.length}
        emptyText={t("No matching banners here – zoom out or move the map")}
        bottom={controlsBottom + 16}
      />

      {rowVisible ? (
        <BannerCarousel
          {...rowProps}
          folded={folded}
          onFold={() => setFolded(true)}
          onUnfold={() => setFolded(false)}
          rowRef={rowRef}
        />
      ) : null}
      {isWide && rowList.length ? <BannerSideList {...rowProps} onHover={setHoverId} /> : null}
      {moreOpen && !sheet ? (
        <ClusterSheet
          banners={rowList}
          onClose={() => setMoreOpen(false)}
          onPick={(banner) => selectBanner(banner.id)}
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
