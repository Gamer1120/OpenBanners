import L from "leaflet";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TileLayer, useMap } from "react-leaflet";
import { useMapLayer } from "../mapLayers";
import { MapLayerButton } from "./MapLayerButton";

export { MapLayerButton };

// The tiles of the chosen map layer (see src/mapLayers.js). Keyed by layer so
// the attribution and the dark filter change with it.
export function MapTileLayer({ defaultLayer }) {
  const layer = useMapLayer(defaultLayer);

  return (
    <TileLayer
      key={layer.id}
      url={layer.url}
      attribution={layer.attribution()}
      className={layer.className ?? ""}
      maxZoom={18}
    />
  );
}

// The same button as a Leaflet control, for maps without their own button
// column (BannerGuider, planner, rerouter preview). Use inside MapContainer.
export function MapLayerControl({ defaultLayer, position = "topright" }) {
  const map = useMap();
  const [container, setContainer] = useState(null);

  useEffect(() => {
    const control = L.control({ position });
    control.onAdd = () => {
      const element = L.DomUtil.create("div", "leaflet-control ob-layers-ctl");
      L.DomEvent.disableClickPropagation(element);
      L.DomEvent.disableScrollPropagation(element);
      return element;
    };
    control.addTo(map);
    setContainer(control.getContainer());
    return () => {
      control.remove();
      setContainer(null);
    };
  }, [map, position]);

  return container
    ? createPortal(<MapLayerButton defaultLayer={defaultLayer} className="ob-layers-leaflet-btn" />, container)
    : null;
}
