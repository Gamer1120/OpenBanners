import React from "react";

export default function AppLogo({ className = "ob-logo" }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="9" fill="var(--primary)" />
      <g fill="var(--on-primary)">
        <circle cx="10" cy="11" r="3" />
        <circle cx="16" cy="11" r="3" />
        <circle cx="22" cy="11" r="3" />
        <circle cx="10" cy="21" r="3" />
        <circle cx="16" cy="21" r="3" opacity=".55" />
        <circle cx="22" cy="21" r="3" opacity=".55" />
      </g>
    </svg>
  );
}
