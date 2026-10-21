import { Marker, Tooltip } from "react-leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useVariantMap from "./useVariantMap";
import {
  BannerMiniCard,
  LocateButton,
  MapStatusPill,
  SearchAreaButton,
  VariantBaseMap,
  statusDotIcon,
} from "./shared";
import { isInsideArea, sortByDistanceFrom } from "./mapMath";

const MAX_CARDS = 80;

export default function ListStripMap() {
  const vm = useVariantMap({ manualSearch: true, trackMove: true });
  const { map, banners, liveArea } = vm;
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(null);
  const cardRefs = useRef(new globalThis.Map());

  // Banners in the current view, nearest to the map centre first; follows the drag.
  const inView = useMemo(() => {
    if (!liveArea) {
      return [];
    }

    return sortByDistanceFrom(
      banners.filter((banner) => isInsideArea(banner, liveArea)),
      { latitude: liveArea.centerLatitude, longitude: liveArea.centerLongitude }
    ).slice(0, MAX_CARDS);
  }, [banners, liveArea]);

  const selected = banners.find((banner) => banner.id === selectedId) ?? null;

  useEffect(() => {
    const element = selectedId ? cardRefs.current.get(selectedId) : null;
    element?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedId]);

  const selectFromMarker = (banner) => setSelectedId(banner.id);

  const selectFromCard = (banner) => {
    if (selectedId === banner.id) {
      navigate(`/banner/${banner.id}`);
      return;
    }

    setSelectedId(banner.id);

    if (map) {
      const position = [banner._latitude, banner._longitude];

      if (!map.getBounds().pad(-0.15).contains(position)) {
        map.panTo(position, { duration: 0.4 });
      }
    }
  };

  return (
    <div className="mv-root mv-split">
      <div className="mv-split-map">
        <VariantBaseMap vm={vm} onMapClick={() => setSelectedId(null)}>
          {banners.map((banner) => {
            const isSelected = banner.id === selectedId;

            return (
              <Marker
                key={banner.id}
                position={[banner._latitude, banner._longitude]}
                icon={statusDotIcon(banner._status, { selected: isSelected })}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{ click: () => selectFromMarker(banner) }}
              >
                {isSelected ? (
                  <Tooltip permanent direction="top" offset={[0, -14]} className="mv-tip">
                    {banner.title}
                  </Tooltip>
                ) : null}
              </Marker>
            );
          })}
        </VariantBaseMap>
        <SearchAreaButton vm={vm} />
        <LocateButton vm={vm} />
        <MapStatusPill vm={vm} count={inView.length} bottom={140} />
      </div>
      <div className="mv-strip" aria-label="Banners in view">
        <div className="mv-strip-head">
          {inView.length} banner{inView.length === 1 ? "" : "s"} in view
          {vm.loading ? " · loading…" : ""}
          {vm.hasMore ? " · more nearby" : ""}
          {selected && !inView.includes(selected) ? (
            <button type="button" className="mv-link" onClick={() => selectFromCard(selected)}>
              Show selected
            </button>
          ) : null}
        </div>
        <div className="mv-strip-cards">
          {inView.map((banner) => (
            <BannerMiniCard
              key={banner.id}
              banner={banner}
              selected={banner.id === selectedId}
              onClick={() => selectFromCard(banner)}
              cardRef={(element) => {
                if (element) {
                  cardRefs.current.set(banner.id, element);
                } else {
                  cardRefs.current.delete(banner.id);
                }
              }}
            >
              {banner.id === selectedId ? <span className="mv-mini-open">Tap again to open</span> : null}
            </BannerMiniCard>
          ))}
          {!inView.length && !vm.loading ? (
            <div className="mv-strip-empty">Move the map to find banners</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
