import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { formatLength, getBannerAspect, getBannerPictureUrl } from "../../bannerDisplay";
import { escapeHtml, formatMinutes, walkingMinutes } from "./mapMath";
import { getStatusStyle } from "./mapStatus";

const iconCache = new globalThis.Map();

function cachedIcon(key, create) {
  if (!iconCache.has(key)) {
    iconCache.set(key, create());
  }

  return iconCache.get(key);
}

export function statusDotIcon(status, { selected = false, dim = false, glow = false, label = "" } = {}) {
  const style = getStatusStyle(status);
  const size = selected ? 26 : glow ? 20 : 16;

  return cachedIcon(`dot:${status}:${selected}:${dim}:${glow}:${label}`, () =>
    L.divIcon({
      className: `mv-dot${selected ? " sel" : ""}${dim ? " dim" : ""}${glow ? " glow" : ""}`,
      html: `<span style="--ring:${style.dot ?? style.ring};--glow:${style.ring}">${escapeHtml(label)}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  );
}

export function numberedIcon(number, status, { selected = false } = {}) {
  const style = getStatusStyle(status);

  return cachedIcon(`num:${number}:${status}:${selected}`, () =>
    L.divIcon({
      className: `mv-num${selected ? " sel" : ""}`,
      html: `<span style="--ring:${style.ring}">${number}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    })
  );
}

const locationIcon = L.divIcon({
  className: "mv-me",
  html: "<span></span>",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function VariantMapEvents({ onViewportChange, onMove, onMapClick }) {
  useMapEvents({
    moveend: (event) => onViewportChange(event.target),
    move: (event) => onMove?.(event.target),
    click: (event) => onMapClick?.(event),
  });

  return null;
}

// MapContainer + OSM tiles + user location, wired to useVariantMap.
export function VariantBaseMap({ vm, onMapClick, children }) {
  return (
    <MapContainer
      center={vm.initialCenter}
      zoom={vm.initialZoom}
      zoomControl={!L.Browser.mobile}
      scrollWheelZoom
      className="mv-leaflet"
      style={{ height: "100%", width: "100%" }}
      whenReady={(event) => vm.handleViewportChange(event.target)}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. Not affiliated with Bannergress.'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {vm.userLocation ? (
        <Marker
          position={[vm.userLocation.latitude, vm.userLocation.longitude]}
          icon={locationIcon}
          interactive={false}
          zIndexOffset={-100}
        />
      ) : null}
      <VariantMapEvents onViewportChange={vm.handleViewportChange} onMove={vm.handleMove} onMapClick={onMapClick} />
      {children}
    </MapContainer>
  );
}

export function LocateButton({ vm, style }) {
  return (
    <button
      type="button"
      className={`mv-fab${vm.locating ? " busy" : ""}`}
      style={style}
      aria-label="Go to my location"
      title="My location"
      onClick={() => vm.requestLocation({ recenter: true })}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" />
      </svg>
    </button>
  );
}

export function SearchAreaButton({ vm, top = 58 }) {
  if (!vm.canSearchArea) {
    return null;
  }

  return (
    <button type="button" className="mv-search-area" style={{ top }} onClick={vm.searchThisArea}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
      </svg>
      Search this area
    </button>
  );
}

// "Loading…", errors and the empty state, as a small pill.
export function MapStatusPill({ vm, count, noun = "banners", bottom = 16 }) {
  let text = "";

  if (vm.error) {
    text = vm.error;
  } else if (vm.loading && !vm.banners.length) {
    text = "Loading banners…";
  } else if (count === 0 && vm.searchArea) {
    text = `No ${noun} here – zoom out or move the map`;
  }

  return text ? (
    <div className={`mv-pill${vm.error ? " err" : ""}`} style={{ bottom }} role="status">
      {text}
    </div>
  ) : null;
}

export function StatusChip({ status }) {
  const style = getStatusStyle(status);

  if (!style.label) {
    return null;
  }

  return (
    <span className="mv-chip" style={{ "--ring": style.ring, "--chip-text": style.text }}>
      {style.label}
    </span>
  );
}

export function bannerFacts(banner) {
  const missions = Number(banner?.numberOfMissions);
  const minutes = walkingMinutes(banner?.lengthMeters);

  return [
    formatLength(banner?.lengthMeters),
    Number.isFinite(missions) ? `${missions} mission${missions === 1 ? "" : "s"}` : null,
    minutes !== null ? `~${formatMinutes(minutes)} walk` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BannerPicture({ banner, maxHeight = 140, className = "" }) {
  const url = getBannerPictureUrl(banner);
  const aspect = getBannerAspect(banner);

  return url ? (
    <div className={`mv-pic ${className}`} style={{ maxHeight, aspectRatio: aspect }}>
      <img src={url} alt="" loading="lazy" draggable={false} />
    </div>
  ) : (
    <div className={`mv-pic none ${className}`} style={{ maxHeight, aspectRatio: aspect }} />
  );
}

// Compact one-banner card (image left, facts right) used by B, C and D.
export function BannerMiniCard({ banner, selected, onClick, action, children, as = "div", cardRef }) {
  const style = getStatusStyle(banner._status);
  const Element = as;
  const url = getBannerPictureUrl(banner);

  return (
    <Element
      ref={cardRef}
      className={`mv-mini${selected ? " sel" : ""}`}
      style={{ "--surface": style.surface, "--ring": style.ring }}
      onClick={onClick}
      data-banner-id={banner.id}
    >
      <div className="mv-mini-thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
      <div className="mv-mini-body">
        <div className="mv-mini-title">{banner.title}</div>
        <div className="mv-mini-facts">{bannerFacts(banner)}</div>
        <div className="mv-mini-row">
          <StatusChip status={banner._status} />
          {children}
        </div>
      </div>
      {action}
    </Element>
  );
}

export function OpenBannerLink({ banner, children = "Open", className = "mv-btn primary" }) {
  return (
    <Link className={className} to={`/banner/${banner.id}`} onClick={(event) => event.stopPropagation()}>
      {children}
    </Link>
  );
}

export function useStatusCounts(banners) {
  return useMemo(
    () =>
      banners.reduce(
        (counts, banner) => ({ ...counts, [banner._status]: (counts[banner._status] ?? 0) + 1 }),
        {}
      ),
    [banners]
  );
}
