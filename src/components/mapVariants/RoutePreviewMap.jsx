import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { useEffect, useMemo, useState } from "react";
import useVariantMap from "./useVariantMap";
import {
  LocateButton,
  MapStatusPill,
  OpenBannerLink,
  StatusChip,
  VariantBaseMap,
  statusDotIcon,
} from "./shared";
import { useBannerRoute } from "./bannerRoute";
import { FINISH_FLAG_SVG, missionColors } from "../BannerDetailsPage";
import { formatLength, getBannerPictureUrl } from "../../bannerDisplay";
import { formatMinutes, walkingMinutes } from "./mapMath";

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

export default function RoutePreviewMap() {
  const vm = useVariantMap();
  const { map, banners } = vm;
  const [selected, setSelected] = useState(null);
  const routeState = useBannerRoute(selected?.id);
  const route = routeState.data?.route ?? null;

  useEffect(() => {
    if (!map || !route?.allPositions.length) {
      return;
    }

    const cardHeight = window.innerWidth >= 900 ? 24 : 170;
    map.flyToBounds(L.latLngBounds(route.allPositions), {
      paddingTopLeft: [28, 64],
      paddingBottomRight: [28, cardHeight],
      maxZoom: 18,
      duration: 0.7,
    });
  }, [map, route]);

  // Keep the selected banner on the map even when a fresh search drops it.
  const shownBanners = useMemo(
    () => (selected && !banners.some((banner) => banner.id === selected.id) ? [...banners, selected] : banners),
    [banners, selected]
  );
  const missions = Number(selected?.numberOfMissions);
  const minutes = walkingMinutes(selected?.lengthMeters);
  const picture = getBannerPictureUrl(selected);

  return (
    <div className="mv-root">
      <VariantBaseMap vm={vm} onMapClick={() => setSelected(null)}>
        {shownBanners.map((banner) => {
          const isSelected = banner.id === selected?.id;

          if (isSelected && route) {
            return null;
          }

          return (
            <Marker
              key={banner.id}
              position={[banner._latitude, banner._longitude]}
              icon={statusDotIcon(banner._status, { selected: isSelected, dim: Boolean(selected) && !isSelected })}
              zIndexOffset={isSelected ? 1000 : 0}
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
      </VariantBaseMap>
      <LocateButton vm={vm} style={{ bottom: selected ? 150 : 24 }} />
      <MapStatusPill vm={vm} count={banners.length} />
      {!selected && banners.length ? <div className="mv-hint-top">Tap a banner to see its route</div> : null}
      {selected ? (
        <div className="mv-sheet mv-route-card" style={{ "--ring": "transparent" }}>
          {picture ? <div className="mv-route-thumb" style={{ backgroundImage: `url("${picture}")` }} /> : null}
          <div className="mv-route-body">
            <div className="mv-card-head">
              <div className="mv-card-title">{selected.title}</div>
              <button type="button" className="mv-btn icon ghost" aria-label="Close route" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <div className="mv-route-stats">
              <span>
                <b>{formatLength(selected.lengthMeters)}</b> walk
              </span>
              <span>
                <b>{Number.isFinite(missions) ? missions : "?"}</b> missions
              </span>
              {minutes !== null ? (
                <span>
                  <b>~{formatMinutes(minutes)}</b>
                </span>
              ) : null}
            </div>
            <div className="mv-mini-row">
              <StatusChip status={selected._status} />
              {routeState.status === "loading" ? <span className="mv-muted">Loading route…</span> : null}
              {routeState.status === "error" ? <span className="mv-muted">Couldn't load the route</span> : null}
              <span className="mv-spacer" />
              <OpenBannerLink banner={selected}>Open banner</OpenBannerLink>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
