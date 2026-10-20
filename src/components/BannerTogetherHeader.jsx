import React from "react";
import { Link } from "react-router-dom";

// Shared header for the Banner Together screens (they live under Lists).
export default function BannerTogetherHeader({ placeLabel, subtitle }) {
  return (
    <header className="ob-sec-head bt-head">
      <div style={{ minWidth: 0 }}>
        <nav className="crumbs" aria-label="Banner Together">
          <Link to="/lists">Lists</Link>
          <span aria-hidden="true">›</span>
          <Link to="/lists/together">Banner Together</Link>
        </nav>
        <h1 className="ob-h1">Banner Together</h1>
        <p className="small muted">
          {placeLabel ? (
            <>
              <span>{placeLabel}</span>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          <span>{subtitle}</span>
        </p>
      </div>
    </header>
  );
}
