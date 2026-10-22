import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Close } from "@mui/icons-material";

// Small design-X modal: closes with the X, Escape or a tap outside. Bottom
// sheet on phones, centred card on wider screens.
export default function ObModal({ title, onClose, children, labelId = "ob-modal-title" }) {
  const cardRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement;
    cardRef.current?.querySelector("button, input, a")?.focus?.();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="ob-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ob-modal-card" role="dialog" aria-modal="true" aria-labelledby={labelId} ref={cardRef}>
        <div className="ob-modal-head">
          <h2 id={labelId}>{title}</h2>
          <button type="button" className="icon-btn sl" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
