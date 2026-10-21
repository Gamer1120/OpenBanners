import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Map from "../Map";
import PicturesMap from "./PicturesMap";
import ListStripMap from "./ListStripMap";
import RoutePreviewMap from "./RoutePreviewMap";
import FiltersMap from "./FiltersMap";
import PlanDayMap from "./PlanDayMap";
import MapVariantSwitcher from "./MapVariantSwitcher";
import { MAP_VARIANTS, readMapVariant, saveMapVariant, withMapVariantParam } from "./mapVariantChoice";
import "./mapVariants.css";

const VARIANT_COMPONENTS = {
  a: PicturesMap,
  b: ListStripMap,
  c: RoutePreviewMap,
  d: FiltersMap,
  e: PlanDayMap,
};

// /map: the classic map ("Now") or one of the prototypes A–E, with a small switcher.
export default function MapVariantsHost({ bannerFilters, onBannerFiltersChange }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [variant, setVariant] = useState(() => readMapVariant(location.search));

  useEffect(() => {
    setVariant(readMapVariant(location.search));
  }, [location.search]);

  const handleChange = (nextVariant) => {
    saveMapVariant(nextVariant);
    setVariant(nextVariant);

    if (new URLSearchParams(location.search).has("map")) {
      navigate({ pathname: location.pathname, search: withMapVariantParam(location.search, nextVariant) }, { replace: true });
    }
  };

  const VariantComponent = VARIANT_COMPONENTS[variant];
  const title = MAP_VARIANTS.find((item) => item.id === variant)?.title;

  return (
    <div className={`mv-host mv-host-${variant}`} data-map-variant={variant}>
      {VariantComponent ? (
        <VariantComponent key={variant} />
      ) : (
        <Map bannerFilters={bannerFilters} onBannerFiltersChange={onBannerFiltersChange} />
      )}
      <MapVariantSwitcher value={variant} onChange={handleChange} />
      {VariantComponent ? <span className="sr">Map prototype: {title}</span> : null}
    </div>
  );
}
