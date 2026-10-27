import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import { t } from "../../i18n";
import { getStatusStyle } from "./mapStatus";

const iconCache = new globalThis.Map();

function cachedIcon(key, create) {
  if (!iconCache.has(key)) {
    iconCache.set(key, create());
  }

  return iconCache.get(key);
}

// hover: the dot of the card under the pointer in the desktop list.
export function statusDotIcon(status, { selected = false, hover = false, dim = false } = {}) {
  const style = getStatusStyle(status);
  const size = selected ? 26 : hover ? 22 : 16;

  return cachedIcon(`dot:${status}:${selected}:${hover}:${dim}`, () =>
    L.divIcon({
      className: `mv-dot${selected ? " sel" : ""}${hover ? " hov" : ""}${dim ? " dim" : ""}`,
      html: `<span style="--ring:${style.dot ?? style.ring}"></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  );
}

// A group of nearby banners: a neutral bubble with the count, ringed by a pie of
// its statuses (amber To do, green Done, blue the rest) in proportion.
export function clusterIcon(banners, { dim = false } = {}) {
  const count = banners.length;
  const size = count < 10 ? 30 : count < 100 ? 36 : 42;
  const tally = { todo: 0, done: 0, none: 0 };

  for (const banner of banners) {
    tally[banner._status === "todo" || banner._status === "done" ? banner._status : "none"] += 1;
  }

  const stops = [];
  let start = 0;

  for (const status of ["todo", "done", "none"]) {
    if (!tally[status]) {
      continue;
    }

    const style = getStatusStyle(status);
    const end = start + (tally[status] / count) * 360;
    stops.push(`${style.dot ?? style.ring} ${start}deg ${end}deg`);
    start = end;
  }

  return cachedIcon(`cluster:${count}:${tally.todo}:${tally.done}:${dim}`, () =>
    L.divIcon({
      className: `mv-cluster${dim ? " dim" : ""}`,
      html: `<span style="--pie:conic-gradient(${stops.join(",")})"><b>${count}</b></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  );
}

const locationIcon = L.divIcon({
  className: "mv-me",
  html: "<span></span>",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function DiscoveryMapEvents({ onViewportChange, onMapClick }) {
  useMapEvents({
    moveend: (event) => onViewportChange(event.target),
    click: (event) => onMapClick?.(event),
  });

  return null;
}

// MapContainer + OSM tiles + user location, wired to useDiscoveryMap.
export function DiscoveryBaseMap({ vm, onMapClick, children }) {
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
        attribution={t("© {osm} contributors. Not affiliated with Bannergress.", {
          osm: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })}
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
      <DiscoveryMapEvents onViewportChange={vm.handleViewportChange} onMapClick={onMapClick} />
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
      aria-label={t("Go to my location")}
      title={t("My location")}
      onClick={() => vm.requestLocation({ recenter: true })}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" />
      </svg>
    </button>
  );
}

// "Loading…", errors and the empty state, as a small pill.
export function MapStatusPill({ vm, count, emptyText, bottom = 16 }) {
  let text = "";

  if (vm.error) {
    text = vm.error;
  } else if (vm.loading && !vm.banners.length) {
    text = t("Loading banners…");
  } else if (count === 0 && vm.searchArea) {
    text = emptyText ?? t("No banners here – zoom out or move the map");
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
      {t(style.label)}
    </span>
  );
}

export function OpenBannerLink({ banner, children, className = "mv-btn primary" }) {
  return (
    <Link className={className} to={`/banner/${banner.id}`} onClick={(event) => event.stopPropagation()}>
      {children ?? t("Open")}
    </Link>
  );
}
