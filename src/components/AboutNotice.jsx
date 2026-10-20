import React from "react";

export const ABOUT_NOTICE_TEXT =
  "This website is not associated with Bannergress, Ingress and/or Niantic. This website is an alternative, open-source front-end for Bannergress's back-end.";

// Same disclaimer wording as the classic app (Home and Browse header).
export default function AboutNotice({ className = "" }) {
  return (
    <section className={`ob-about small muted ${className}`.trim()} aria-label="About this website">
      {ABOUT_NOTICE_TEXT}
    </section>
  );
}
