// Full-screen viewer of a banner's artwork: zoom (pinch, ctrl/trackpad wheel, double
// click, + / − buttons and keys) and pan (scroll / drag) through the mission tiles, the
// same for every banner. It opens at a readable size: the whole banner when its tiles
// are big enough there, otherwise the full width, scrolling down through the rows.
// Closes with ×, Escape, the back button/gesture or a tap beside the artwork.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Close, FitScreen, Tag, ZoomIn, ZoomOut } from "@mui/icons-material";
import BannerImage from "../BannerImage";
import { getSlotCount } from "../../bannerMissions";
import { t } from "../../i18n";
import {
  clampTile,
  COMPOSITE_BELOW,
  getFitTile,
  getMosaicSize,
  getPictureSize,
  getStartTile,
  getTileGap,
  getTileRange,
  NUMBERS_FROM,
} from "./artViewer";
import MissionMosaic from "./MissionMosaic";

const STEP = 1.5;
const PADDING = 16;
const HISTORY_KEY = "obArtViewer";

function getGrid(banner, missions, slots) {
  const columns = Number(banner?.width) || 6;
  const missionSlots =
    Array.isArray(slots) && slots.length === missions.length ? slots : missions.map((_, index) => index);
  const rows = Math.max(1, Math.ceil(Math.max(1, getSlotCount(missionSlots)) / columns));

  return { columns, rows };
}

export default function BannerViewer({ banner, missions, slots, colors, onClose }) {
  const scrollerRef = useRef(null);
  const contentRef = useRef(null);
  const closeRef = useRef(null);
  const anchorRef = useRef(null);
  const pinchRef = useRef(null);
  const frameRef = useRef(0);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [view, setView] = useState(null);
  const [tile, setTile] = useState(null);
  const [numbers, setNumbers] = useState(false);
  const [rowRange, setRowRange] = useState([0, 0]);
  const { columns, rows } = useMemo(() => getGrid(banner, missions, slots), [banner, missions, slots]);
  const hasTiles = missions.some((mission) => mission?.picture);
  const range = useMemo(
    () => (view ? getTileRange(view.width, view.height, columns, rows) : { min: 1, max: 1 }),
    [columns, rows, view]
  );
  const tileRef = useRef(tile);
  tileRef.current = tile;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // Close through history when we added an entry, so back and × behave the same.
  const requestClose = useCallback(() => {
    if (closedRef.current) {
      return;
    }

    if (window.history.state?.[HISTORY_KEY]) {
      window.history.back();
      return;
    }

    closedRef.current = true;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.history.pushState({ ...(window.history.state || {}), [HISTORY_KEY]: true }, "");
    const onPop = () => {
      if (!closedRef.current) {
        closedRef.current = true;
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    closeRef.current?.focus({ preventScroll: true });

    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // Screen size → start size (and again on rotation / window resize).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return undefined;
    }

    const measure = () => {
      const width = (scroller.clientWidth || window.innerWidth || 360) - 2 * PADDING;
      const height = (scroller.clientHeight || window.innerHeight || 640) - 2 * PADDING;
      setView((current) =>
        current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height }
      );
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (view) {
      setTile((current) =>
        current === null ? getStartTile(view.width, view.height, columns, rows) : clampTile(current, rangeRef.current)
      );
    }
  }, [columns, rows, view]);

  // Zoom to `next` keeping the artwork point under (clientX, clientY) where it is.
  const zoomTo = useCallback((next, clientX, clientY) => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    const current = tileRef.current;

    if (!scroller || !content || current === null) {
      return;
    }

    const clamped = clampTile(next, rangeRef.current);

    if (Math.abs(clamped - current) < 0.01) {
      return;
    }

    const box = scroller.getBoundingClientRect();
    const x = clientX ?? box.left + box.width / 2;
    const y = clientY ?? box.top + box.height / 2;
    const rect = content.getBoundingClientRect();
    anchorRef.current = {
      x,
      y,
      fx: rect.width ? Math.min(1, Math.max(0, (x - rect.left) / rect.width)) : 0.5,
      fy: rect.height ? Math.min(1, Math.max(0, (y - rect.top) / rect.height)) : 0,
    };
    tileRef.current = clamped;
    setTile(clamped);
  }, []);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    anchorRef.current = null;

    if (!anchor || !scroller || !content) {
      return;
    }

    const rect = content.getBoundingClientRect();
    scroller.scrollLeft += rect.left + anchor.fx * rect.width - anchor.x;
    scroller.scrollTop += rect.top + anchor.fy * rect.height - anchor.y;
  }, [tile]);

  // Rows within a screen of the visible part get their pictures; the rest wait.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;

    if (!scroller || !content || tile === null) {
      return undefined;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const pitch = tile + getTileGap(tile);
      // How far the artwork's top is above the scroll box's top.
      const top = scroller.getBoundingClientRect().top - content.getBoundingClientRect().top - PADDING;
      const screen = scroller.clientHeight || window.innerHeight || 800;
      const from = Math.max(0, Math.floor((top - screen) / pitch));
      const to = Math.min(rows - 1, Math.ceil((top + 2 * screen) / pitch));
      setRowRange((current) => (current[0] === from && current[1] === to ? current : [from, to]));
    };
    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rows, tile]);

  const zoomBy = useCallback(
    (factor, clientX, clientY) => {
      if (tileRef.current !== null) {
        zoomTo(tileRef.current * factor, clientX, clientY);
      }
    },
    [zoomTo]
  );

  const showWhole = useCallback(() => {
    if (view) {
      zoomTo(getFitTile(view.width, view.height, columns, rows));
    }
  }, [columns, rows, view, zoomTo]);

  // Keys: Escape closes, + / − / 0 zoom.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      } else if (event.key === "+" || event.key === "=") {
        zoomBy(STEP);
      } else if (event.key === "-" || event.key === "_") {
        zoomBy(1 / STEP);
      } else if (event.key === "0") {
        showWhole();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose, showWhole, zoomBy]);

  // Pinch (two fingers) and ctrl+wheel / trackpad pinch zoom; one finger scrolls natively.
  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return undefined;
    }

    const distance = (touches) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const middle = (touches) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const onTouchStart = (event) => {
      if (event.touches.length === 2 && tileRef.current !== null) {
        pinchRef.current = { distance: distance(event.touches) || 1, tile: tileRef.current };
      }
    };
    const onTouchMove = (event) => {
      const pinch = pinchRef.current;

      if (!pinch || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      const next = (pinch.tile * distance(event.touches)) / pinch.distance;
      const { x, y } = middle(event.touches);
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => zoomTo(next, x, y));
    };
    const onTouchEnd = (event) => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
      }
    };
    const onWheel = (event) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomBy(Math.exp(-Math.max(-100, Math.min(100, delta)) / 100), event.clientX, event.clientY);
    };

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [zoomBy, zoomTo]);

  const pixelRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const composite = tile !== null && (!hasTiles || tile < COMPOSITE_BELOW);
  const size = tile !== null ? getMosaicSize(tile, columns, rows) : null;
  const atMin = tile !== null && tile <= range.min + 0.01;
  const atMax = tile !== null && tile >= range.max - 0.01;

  return createPortal(
    <div
      className="bv"
      role="dialog"
      aria-modal="true"
      aria-label={t("Banner artwork")}
      // React bubbles portal events to the enlarge button, which would reopen the viewer.
      onClick={(event) => event.stopPropagation()}
    >
      <div className="bv-bar">
        <b className="bv-title" title={banner?.title || ""}>
          {banner?.title || t("Banner artwork")}
        </b>
        {hasTiles ? (
          <button
            type="button"
            className={`bv-btn${numbers ? " on" : ""}`}
            aria-label={t("Show mission numbers")}
            title={t("Show mission numbers")}
            aria-pressed={numbers}
            onClick={() => setNumbers((value) => !value)}
          >
            <Tag />
          </button>
        ) : null}
        <button
          type="button"
          className="bv-btn"
          aria-label={t("Zoom out")}
          title={t("Zoom out")}
          disabled={atMin}
          onClick={() => zoomBy(1 / STEP)}
        >
          <ZoomOut />
        </button>
        <button
          type="button"
          className="bv-btn"
          aria-label={t("Zoom in")}
          title={t("Zoom in")}
          disabled={atMax}
          onClick={() => zoomBy(STEP)}
        >
          <ZoomIn />
        </button>
        <button
          type="button"
          className="bv-btn"
          aria-label={t("Show whole banner")}
          title={t("Show whole banner")}
          disabled={atMin}
          onClick={showWhole}
        >
          <FitScreen />
        </button>
        <button ref={closeRef} type="button" className="bv-btn bv-close" aria-label={t("Close")} title={t("Close")} onClick={requestClose}>
          <Close />
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="bv-scroll"
        onClick={(event) => {
          // A tap beside the artwork closes; taps on it don't (they're for zooming).
          if (!event.target.closest?.(".bv-art")) {
            requestClose();
          }
        }}
        onDoubleClick={(event) => {
          if (!event.target.closest?.(".bv-art") || tile === null) {
            return;
          }

          if (atMax) {
            zoomTo(getStartTile(view.width, view.height, columns, rows), event.clientX, event.clientY);
          } else {
            zoomBy(2, event.clientX, event.clientY);
          }
        }}
      >
        <div ref={contentRef} className="bv-content">
          {size ? (
            <div className="bv-art" style={{ width: `${size.width}px`, height: `${size.height}px` }}>
              {composite ? (
                <BannerImage banner={banner} mode="natural" className="bv-pic" alt="" eager />
              ) : (
                <MissionMosaic
                  banner={banner}
                  missions={missions}
                  slots={slots}
                  colors={colors}
                  tile={tile}
                  numbers={numbers && tile >= NUMBERS_FROM}
                  pictureSize={getPictureSize(tile, pixelRatio)}
                  rowRange={rowRange}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
