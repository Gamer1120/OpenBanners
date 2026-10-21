import L from "leaflet";
import { Marker } from "react-leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getBannerPictureUrl } from "../../bannerDisplay";
import useVariantMap from "./useVariantMap";
import {
  BannerPicture,
  LocateButton,
  MapStatusPill,
  OpenBannerLink,
  StatusChip,
  VariantBaseMap,
  bannerFacts,
} from "./shared";
import { bannerPoint, clusterByPixels, escapeHtml, sortByDistanceFrom } from "./mapMath";
import { getStatusStyle } from "./mapStatus";

const THUMB_PX = 54;
const CLUSTER_RADIUS_PX = 62;
const SWIPE_PX = 56;
const STATUS_PRIORITY = { todo: 0, none: 1, done: 2 };

const pictureIconCache = new globalThis.Map();

function pictureIcon(banner, count, selected) {
  const key = `${banner.id}:${banner._status}:${count}:${selected}`;

  if (!pictureIconCache.has(key)) {
    if (pictureIconCache.size > 800) {
      pictureIconCache.clear();
    }

    pictureIconCache.set(key, createPictureIcon(banner, count, selected));
  }

  return pictureIconCache.get(key);
}

function createPictureIcon(banner, count, selected) {
  const style = getStatusStyle(banner._status);
  const url = getBannerPictureUrl(banner);
  const size = selected ? THUMB_PX + 10 : THUMB_PX;

  return L.divIcon({
    className: `mv-photo${selected ? " sel" : ""}${count > 1 ? " stack" : ""}`,
    html: `<span class="mv-photo-img" style="--ring:${style.ring};${
      url ? `background-image:url('${escapeHtml(url)}')` : ""
    }"></span>${count > 1 ? `<b class="mv-photo-count">${count > 99 ? "99+" : count}</b>` : ""}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Bottom card: swipe up → banner page, sideways → next/previous banner nearby.
function PictureCard({ banner, index, total, onStep, onClose }) {
  const navigate = useNavigate();
  const startRef = useRef(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });

  const handlePointerDown = (event) => {
    if (event.target.closest("a,button")) {
      return;
    }

    startRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!startRef.current) {
      return;
    }

    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    setDrag(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.min(dy, 40) });
  };

  const handlePointerUp = () => {
    if (!startRef.current) {
      return;
    }

    startRef.current = null;
    const { x, y } = drag;
    setDrag({ x: 0, y: 0 });

    if (y < -SWIPE_PX) {
      navigate(`/banner/${banner.id}`);
    } else if (y > SWIPE_PX / 2 + 10) {
      onClose();
    } else if (x < -SWIPE_PX) {
      onStep(1);
    } else if (x > SWIPE_PX) {
      onStep(-1);
    }
  };

  return (
    <div
      className="mv-sheet mv-photo-card"
      style={{
        transform: `translate(${drag.x}px, ${drag.y}px)`,
        transition: drag.x || drag.y ? "none" : undefined,
        opacity: 1 - Math.min(Math.abs(drag.x) / 400, 0.4),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="mv-grip" aria-hidden="true" />
      <BannerPicture banner={banner} maxHeight={150} />
      <div className="mv-card-head">
        <div className="mv-card-title">{banner.title}</div>
        <StatusChip status={banner._status} />
      </div>
      <div className="mv-card-facts">{bannerFacts(banner)}</div>
      {banner.formattedAddress ? <div className="mv-card-sub">{banner.formattedAddress}</div> : null}
      <div className="mv-card-actions">
        <button type="button" className="mv-btn icon" aria-label="Previous banner" disabled={index <= 0} onClick={() => onStep(-1)}>
          ‹
        </button>
        <span className="mv-card-count">
          {index + 1} / {total} nearby
        </span>
        <button
          type="button"
          className="mv-btn icon"
          aria-label="Next banner"
          disabled={index >= total - 1}
          onClick={() => onStep(1)}
        >
          ›
        </button>
        <span className="mv-spacer" />
        <OpenBannerLink banner={banner}>Open banner</OpenBannerLink>
      </div>
      <div className="mv-card-hint">Swipe up to open · sideways for the next one</div>
    </div>
  );
}

export default function PicturesMap() {
  const vm = useVariantMap();
  const { map, zoom, banners } = vm;
  const [card, setCard] = useState(null); // { list: banner[], index }

  const prioritized = useMemo(
    () =>
      [...banners].sort(
        (a, b) => (STATUS_PRIORITY[a._status] ?? 1) - (STATUS_PRIORITY[b._status] ?? 1)
      ),
    [banners]
  );

  const clusters = useMemo(() => {
    if (!map) {
      return [];
    }

    const items = prioritized.flatMap((banner) => {
      const point = bannerPoint(banner);

      if (!point) {
        return [];
      }

      const pixel = map.project([point.latitude, point.longitude], zoom);
      return [{ id: banner.id, x: pixel.x, y: pixel.y, banner }];
    });

    return clusterByPixels(items, CLUSTER_RADIUS_PX).map((cluster) => ({
      key: cluster.items[0].id,
      banner: cluster.items[0].banner,
      banners: cluster.items.map((item) => item.banner),
    }));
  }, [map, prioritized, zoom]);

  const selected = card ? card.list[card.index] : null;

  const openCard = (cluster) => {
    if (cluster.banners.length > 1 && map && zoom < 18) {
      const bounds = L.latLngBounds(
        cluster.banners.map((banner) => [banner._latitude, banner._longitude])
      );

      if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) > 25) {
        map.flyToBounds(bounds.pad(0.35), { maxZoom: 18, duration: 0.6 });
        return;
      }
    }

    const point = bannerPoint(cluster.banner);
    const nearby = sortByDistanceFrom(banners, point);
    setCard({ list: nearby, index: Math.max(0, nearby.findIndex((banner) => banner.id === cluster.banner.id)) });
  };

  const step = (delta) => {
    setCard((current) => {
      if (!current) {
        return current;
      }

      const index = Math.min(current.list.length - 1, Math.max(0, current.index + delta));
      return { ...current, index };
    });
  };

  useEffect(() => {
    if (selected && map) {
      // Keep the marker in the part of the map the card doesn't cover.
      const point = map.latLngToContainerPoint([selected._latitude, selected._longitude]);
      const size = map.getSize();
      const cardHeight = size.x >= 900 ? 0 : Math.min(360, size.y * 0.5);
      const visibleBottom = size.y - cardHeight;

      if (point.y > visibleBottom - 50 || point.y < 70 || point.x < 40 || point.x > size.x - 40) {
        map.panBy([point.x - size.x / 2, point.y - (visibleBottom + 50) / 2], { duration: 0.4 });
      }
    }
  }, [map, selected]);

  return (
    <div className="mv-root">
      <VariantBaseMap vm={vm} onMapClick={() => setCard(null)}>
        {clusters.map((cluster) => {
          const isSelected = selected && cluster.banners.some((banner) => banner.id === selected.id);
          const shown = isSelected ? selected : cluster.banner;

          return (
            <Marker
              key={cluster.key}
              position={[shown._latitude, shown._longitude]}
              icon={pictureIcon(shown, cluster.banners.length, isSelected)}
              zIndexOffset={isSelected ? 1000 : cluster.banners.length}
              title={cluster.banners.length > 1 ? `${cluster.banners.length} banners` : shown.title}
              eventHandlers={{ click: () => openCard(cluster) }}
            />
          );
        })}
      </VariantBaseMap>
      <LocateButton vm={vm} style={{ bottom: selected ? 300 : 24 }} />
      <MapStatusPill vm={vm} count={banners.length} />
      {selected ? (
        <PictureCard
          banner={selected}
          index={card.index}
          total={card.list.length}
          onStep={step}
          onClose={() => setCard(null)}
        />
      ) : null}
    </div>
  );
}
