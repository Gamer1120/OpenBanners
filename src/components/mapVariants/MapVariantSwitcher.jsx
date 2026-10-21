import { MAP_VARIANTS } from "./mapVariantChoice";

export default function MapVariantSwitcher({ value, onChange }) {
  return (
    <div className="mv-switch" role="radiogroup" aria-label="Map prototype">
      {MAP_VARIANTS.map((variant) => (
        <button
          type="button"
          key={variant.id}
          role="radio"
          aria-checked={value === variant.id}
          aria-label={`${variant.label}: ${variant.title}`}
          title={variant.title}
          className={value === variant.id ? "on" : ""}
          onClick={() => onChange(variant.id)}
        >
          {variant.label}
        </button>
      ))}
    </div>
  );
}
