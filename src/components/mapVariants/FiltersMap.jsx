import { Marker, Tooltip } from "react-leaflet";
import { useEffect, useMemo, useState } from "react";
import useVariantMap from "./useVariantMap";
import {
  BannerMiniCard,
  LocateButton,
  MapStatusPill,
  OpenBannerLink,
  SearchAreaButton,
  VariantBaseMap,
  statusDotIcon,
} from "./shared";
import {
  DEFAULT_VARIANT_FILTERS,
  MISSION_OPTIONS,
  STATUS_OPTIONS,
  VARIANT_FILTERS_STORAGE_KEY,
  WALK_OPTIONS,
  applyVariantFilters,
  countActiveVariantFilters,
  filterSummary,
  normalizeVariantFilters,
} from "./mapFilters";
import { isInsideArea } from "./mapMath";

const GROUPS = [
  { key: "status", title: "Status", options: STATUS_OPTIONS },
  { key: "walk", title: "Walking time", options: WALK_OPTIONS, note: "At about 4.5 km/h including portal stops" },
  { key: "missions", title: "Number of missions", options: MISSION_OPTIONS },
];

function readStoredFilters() {
  try {
    return normalizeVariantFilters(JSON.parse(window.localStorage.getItem(VARIANT_FILTERS_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeVariantFilters(DEFAULT_VARIANT_FILTERS);
  }
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
          {group.note ? <p className="mv-muted">{group.note}</p> : null}
        </section>
      ))}
      <div className="mv-card-actions">
        <button type="button" className="mv-btn" onClick={() => onChange(normalizeVariantFilters({ status: "all" }))}>
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

export default function FiltersMap() {
  const vm = useVariantMap({ manualSearch: true });
  const { banners, liveArea } = vm;
  const [filters, setFilters] = useState(readStoredFilters);
  const [sheet, setSheet] = useState(null); // group key that opened the sheet
  const [selectedId, setSelectedId] = useState(null);
  const summary = filterSummary(filters);
  const activeCount = countActiveVariantFilters(filters);

  useEffect(() => {
    window.localStorage.setItem(VARIANT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const matching = useMemo(() => applyVariantFilters(banners, filters), [banners, filters]);
  const matchingInView = useMemo(
    () => (liveArea ? matching.filter((banner) => isInsideArea(banner, liveArea)) : matching),
    [liveArea, matching]
  );
  const inViewCount = useMemo(
    () => (liveArea ? banners.filter((banner) => isInsideArea(banner, liveArea)).length : banners.length),
    [banners, liveArea]
  );
  const selected = matching.find((banner) => banner.id === selectedId) ?? null;

  return (
    <div className="mv-root">
      <VariantBaseMap vm={vm} onMapClick={() => setSelectedId(null)}>
        {matching.map((banner) => (
          <Marker
            key={banner.id}
            position={[banner._latitude, banner._longitude]}
            icon={statusDotIcon(banner._status, { selected: banner.id === selectedId })}
            zIndexOffset={banner.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => setSelectedId(banner.id) }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              {banner.title}
            </Tooltip>
          </Marker>
        ))}
      </VariantBaseMap>

      <div className="mv-filterbar" role="toolbar" aria-label="Filters">
        <button type="button" className={`mv-fchip${activeCount ? " on" : ""}`} onClick={() => setSheet("status")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
          </svg>
          {activeCount ? activeCount : "Filters"}
        </button>
        {GROUPS.map((group) => {
          const active =
            group.key === "status" ? filters.status !== "all" : filters[group.key] !== "any";

          return (
            <button
              type="button"
              key={group.key}
              className={`mv-fchip${active ? " on" : ""}`}
              onClick={() => setSheet(group.key)}
            >
              {group.key === "status" ? summary.status : summary[group.key]}
              <span aria-hidden="true">▾</span>
            </button>
          );
        })}
        <span className="mv-count">
          {vm.loading ? "Loading…" : `${matchingInView.length} of ${inViewCount} in view`}
        </span>
      </div>
      <SearchAreaButton vm={vm} top={96} />
      <LocateButton vm={vm} style={{ bottom: selected ? 140 : 24 }} />
      <MapStatusPill vm={vm} count={matching.length} noun="matching banners" />

      {selected && !sheet ? (
        <div className="mv-sheet mv-sheet-mini">
          <BannerMiniCard
            banner={selected}
            action={<OpenBannerLink banner={selected} />}
          />
        </div>
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
