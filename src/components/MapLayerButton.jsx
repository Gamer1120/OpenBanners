import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { MAP_LAYERS, getMapLayerPreview, setMapLayerChoice, useMapLayer } from "../mapLayers";
import "./MapLayers.css";

// The map layer picker (src/mapLayers.js). No Leaflet here, so pages can show
// it without pulling Leaflet into their first chunk.
function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"
      />
    </svg>
  );
}

// A button that opens the layer picker. className styles the button like the
// map's other buttons; placement "up" opens the menu above it; rootClassName
// and style go on the wrapper (e.g. to position it).
export function MapLayerButton({ defaultLayer, className = "", placement = "down", rootClassName = "", style }) {
  const current = useMapLayer(defaultLayer);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`ob-layers ${placement} ${rootClassName}`.trim()} style={style} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={t("Map layers")}
        title={t("Map layers")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <LayersIcon />
      </button>
      {open ? (
        <div className="ob-layers-menu" role="menu" aria-label={t("Map layers")}>
          {MAP_LAYERS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              role="menuitemradio"
              aria-checked={layer.id === current.id}
              className={`ob-layers-item${layer.id === current.id ? " on" : ""}`}
              onClick={() => {
                setMapLayerChoice(layer.id);
                setOpen(false);
              }}
            >
              <span className="ob-layers-thumb">
                <img src={getMapLayerPreview(layer)} className={layer.className} alt="" draggable="false" />
              </span>
              <span className="ob-layers-name">{layer.id === "osm" ? layer.label : t(layer.label)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
