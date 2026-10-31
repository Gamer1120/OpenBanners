import React, { useLayoutEffect, useRef, useState } from "react";
import { AccountCircleOutlined } from "@mui/icons-material";
import { t } from "../i18n";

// Widest the signed-in button may get with the long label; past this (or when
// the bar has no room) it shows only the agent name.
const LONG_LABEL_MAX_WIDTH = 360;

function horizontalExtra(style, kind) {
  return (
    (parseFloat(style[`${kind}Left`]) || 0) +
    (parseFloat(style[`${kind}Right`]) || 0)
  );
}

function outerWidth(element) {
  const style = window.getComputedStyle(element);

  if (
    style.display === "none" ||
    style.position === "absolute" ||
    style.position === "fixed"
  ) {
    return 0;
  }

  return (
    element.getBoundingClientRect().width + horizontalExtra(style, "margin")
  );
}

// Room the account button can take in the top bar: the bar's content width
// minus everything else in it (brand, other buttons, gaps).
function measureRoom(button) {
  const actions = button.parentElement;
  const bar = actions?.parentElement;

  // No layout (hidden bar, or jsdom in tests): keep the long label.
  if (!actions || !bar || bar.clientWidth === 0) {
    return Infinity;
  }

  const barStyle = window.getComputedStyle(bar);
  const barGap = parseFloat(barStyle.columnGap) || 0;
  const barChildren = [...bar.children].filter(
    (child) => child === actions || outerWidth(child) > 0
  );
  const actionsStyle = window.getComputedStyle(actions);
  const actionsGap = parseFloat(actionsStyle.columnGap) || 0;
  const actionChildren = [...actions.children].filter(
    (child) => child === button || outerWidth(child) > 0
  );
  const others =
    barChildren
      .filter((child) => child !== actions)
      .reduce((sum, child) => sum + outerWidth(child), 0) +
    barGap * Math.max(0, barChildren.length - 1) +
    horizontalExtra(actionsStyle, "padding") +
    actionChildren
      .filter((child) => child !== button)
      .reduce((sum, child) => sum + outerWidth(child), 0) +
    actionsGap * Math.max(0, actionChildren.length - 1) +
    horizontalExtra(window.getComputedStyle(button), "margin");

  return bar.clientWidth - horizontalExtra(barStyle, "padding") - others;
}

// Signed-in indicator in the top bar: "Signed in as <agent>" when it fits,
// otherwise just the agent name (cut with "…" if even that is too wide).
// Without a known agent name: person icon + "Signed in". The full text is
// always the tooltip and the accessible name.
export default function AccountButton({ agentName, title, onClick }) {
  const buttonRef = useRef(null);
  const measureRef = useRef(null);
  const [showLong, setShowLong] = useState(true);
  const longLabel = agentName
    ? t("Signed in as {agent}", { agent: agentName })
    : null;

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const measure = measureRef.current;

    if (!button || !measure || !longLabel) {
      return undefined;
    }

    let frame = null;
    const update = () => {
      frame = null;
      const buttonStyle = window.getComputedStyle(button);
      const need =
        Math.ceil(measure.getBoundingClientRect().width) +
        horizontalExtra(buttonStyle, "padding") +
        horizontalExtra(buttonStyle, "border");
      const room = measureRoom(button);
      setShowLong(need <= room && need <= LONG_LABEL_MAX_WIDTH);
    };
    const schedule = () => {
      if (frame !== null) {
        return;
      }

      if (typeof window.requestAnimationFrame === "function") {
        frame = window.requestAnimationFrame(update);
      } else {
        update();
      }
    };

    update();
    const bar = button.parentElement?.parentElement;
    const observer =
      typeof window.ResizeObserver === "function" && bar
        ? new window.ResizeObserver(schedule)
        : null;
    observer?.observe(bar);
    window.addEventListener("resize", schedule);
    document.fonts?.ready?.then(schedule, () => {});

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);

      if (frame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [longLabel]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`btn tonal sl ob-account${agentName ? "" : " no-name"}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {agentName ? (
        <>
          <span
            className="ob-account-label"
            data-mode={showLong ? "long" : "short"}
          >
            {showLong ? longLabel : agentName}
          </span>
          <span
            ref={measureRef}
            className="ob-account-measure"
            aria-hidden="true"
          >
            {longLabel}
          </span>
        </>
      ) : (
        <>
          <AccountCircleOutlined aria-hidden="true" />
          <span className="ob-account-label">{t("Signed in")}</span>
        </>
      )}
    </button>
  );
}
