import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatLength, getBannerPictureUrl } from "../../bannerDisplay";
import useVariantMap from "./useVariantMap";
import { LocateButton, MapStatusPill, VariantBaseMap, numberedIcon, statusDotIcon } from "./shared";
import { bannerPoint, formatMinutes, isInsideArea, sortByDistanceFrom } from "./mapMath";
import { orderNearestNeighbour, summarizePlan } from "./planDay";

export const PLAN_STORAGE_KEY = "openbanners.mapVariant.plan";
const PRESELECT_TODO = 5;

function readPlan() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) ?? "null");
    return Array.isArray(stored?.banners) ? stored : null;
  } catch {
    return null;
  }
}

// Only the fields the plan needs, so it survives reloads without the map data.
function slimBanner(banner) {
  const {
    id,
    title,
    picture,
    lengthMeters,
    numberOfMissions,
    width,
    startLatitude,
    startLongitude,
    _latitude,
    _longitude,
    _status,
  } = banner;
  return { id, title, picture, lengthMeters, numberOfMissions, width, startLatitude, startLongitude, _latitude, _longitude, _status };
}

export default function PlanDayMap() {
  const vm = useVariantMap();
  const { banners, liveArea, userLocation, map } = vm;
  const [storedPlan] = useState(readPlan);
  const [plan, setPlan] = useState(() => storedPlan?.banners ?? []);
  const [initialized, setInitialized] = useState(Boolean(storedPlan));
  const [expanded, setExpanded] = useState(true);
  const [fitPending, setFitPending] = useState(Boolean(storedPlan?.banners?.length));

  // First visit: preselect the nearest To do banners in view.
  useEffect(() => {
    if (initialized || vm.loading || !liveArea || !banners.length) {
      return;
    }

    const center = { latitude: liveArea.centerLatitude, longitude: liveArea.centerLongitude };
    const todo = sortByDistanceFrom(
      banners.filter((banner) => banner._status === "todo" && isInsideArea(banner, liveArea)),
      userLocation ?? center
    ).slice(0, PRESELECT_TODO);
    setPlan(todo.map(slimBanner));
    setInitialized(true);
    setFitPending(todo.length > 0);
  }, [banners, initialized, liveArea, userLocation, vm.loading]);

  useEffect(() => {
    if (initialized) {
      window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ banners: plan }));
    }
  }, [initialized, plan]);

  // Keep statuses fresh when the list sync changes.
  const statusById = useMemo(() => new globalThis.Map(banners.map((banner) => [banner.id, banner._status])), [banners]);
  const planBanners = useMemo(
    () => plan.map((banner) => ({ ...banner, _status: statusById.get(banner.id) ?? banner._status })),
    [plan, statusById]
  );
  const start = userLocation;
  const ordered = useMemo(() => orderNearestNeighbour(planBanners, start), [planBanners, start]);
  const summary = useMemo(() => summarizePlan(ordered, start), [ordered, start]);
  const orderIndex = useMemo(() => new globalThis.Map(ordered.map((banner, index) => [banner.id, index])), [ordered]);
  const path = useMemo(
    () =>
      [start, ...ordered.map(bannerPoint)]
        .filter(Boolean)
        .map((point) => [point.latitude, point.longitude]),
    [ordered, start]
  );

  const toggle = (banner) => {
    setInitialized(true);
    setPlan((current) =>
      current.some((item) => item.id === banner.id)
        ? current.filter((item) => item.id !== banner.id)
        : [...current, slimBanner(banner)]
    );
  };
  const remove = (id) => setPlan((current) => current.filter((item) => item.id !== id));

  const fitPlan = () => {
    if (map && path.length) {
      map.flyToBounds(L.latLngBounds(path), {
        paddingTopLeft: [30, 70],
        paddingBottomRight: [30, expanded ? Math.min(map.getSize().y * 0.48, 380) + 20 : 110],
        maxZoom: 16,
        duration: 0.6,
      });
    }
  };

  useEffect(() => {
    if (fitPending && map && path.length) {
      setFitPending(false);
      fitPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitPending, map, path.length]);

  const unplanned = banners.filter((banner) => !orderIndex.has(banner.id));

  return (
    <div className="mv-root">
      <VariantBaseMap vm={vm}>
        {path.length > 1 ? (
          <>
            <Polyline positions={path} pathOptions={{ color: "#0b0f12", weight: 7, opacity: 0.5 }} />
            <Polyline positions={path} pathOptions={{ color: "#7ec8ff", weight: 3.5, opacity: 0.95, dashArray: "8 7" }} />
          </>
        ) : null}
        {unplanned.map((banner) => (
          <Marker
            key={banner.id}
            position={[banner._latitude, banner._longitude]}
            icon={statusDotIcon(banner._status, { glow: banner._status === "todo", dim: banner._status === "done" })}
            eventHandlers={{ click: () => toggle(banner) }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              + {banner.title}
            </Tooltip>
          </Marker>
        ))}
        {ordered.map((banner, index) =>
          bannerPoint(banner) ? (
            <Marker
              key={banner.id}
              position={[banner._latitude, banner._longitude]}
              icon={numberedIcon(index + 1, banner._status)}
              zIndexOffset={2000 - index}
              eventHandlers={{ click: () => toggle(banner) }}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                {index + 1}. {banner.title} (tap to remove)
              </Tooltip>
            </Marker>
          ) : null
        )}
      </VariantBaseMap>
      <div className="mv-hint-top">Tap banners to add them to your day · To do glows</div>
      <LocateButton vm={vm} style={{ bottom: ordered.length ? (expanded ? 316 : 100) : 24 }} />
      <MapStatusPill vm={vm} count={banners.length} />

      <div className={`mv-sheet mv-plan${expanded ? " open" : ""}`}>
        <button type="button" className="mv-plan-head" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          <div>
            <div className="mv-card-title">
              {ordered.length ? `Your day · ${ordered.length} banner${ordered.length === 1 ? "" : "s"}` : "Plan a day"}
            </div>
            <div className="mv-card-facts">
              {ordered.length
                ? `${formatLength(summary.totalMeters)} · ~${formatMinutes(summary.minutes)} · ${summary.missions} missions`
                : "No banners yet – tap markers on the map"}
            </div>
          </div>
          <span className="mv-chev" aria-hidden="true">{expanded ? "▾" : "▴"}</span>
        </button>
        {expanded && ordered.length ? (
          <>
            <div className="mv-plan-split">
              <span>Banners {formatLength(summary.bannerMeters)}</span>
              <span>Walking between {formatLength(summary.walkingMeters)}</span>
              <span>{start ? "From your location" : "From banner 1"}</span>
            </div>
            <ol className="mv-plan-list">
              {ordered.map((banner, index) => {
                const picture = getBannerPictureUrl(banner);

                return (
                  <li key={banner.id} className={`st-${banner._status}`}>
                    <span className="mv-plan-num">{index + 1}</span>
                    <span className="mv-plan-thumb" style={picture ? { backgroundImage: `url("${picture}")` } : undefined} />
                    <Link className="mv-plan-text" to={`/banner/${banner.id}`}>
                      <span className="mv-plan-title">{banner.title}</span>
                      <span className="mv-plan-sub">
                        {summary.legs[index] > 0 ? `+${formatLength(summary.legs[index])} to get there · ` : ""}
                        {formatLength(banner.lengthMeters)} · {banner.numberOfMissions} missions
                      </span>
                    </Link>
                    <button type="button" className="mv-btn icon ghost" aria-label={`Remove ${banner.title}`} onClick={() => remove(banner.id)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="mv-card-actions">
              <button type="button" className="mv-btn" onClick={() => { setInitialized(true); setPlan([]); }}>
                Clear
              </button>
              <span className="mv-spacer" />
              <button type="button" className="mv-btn primary" onClick={fitPlan}>
                Show whole day
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
