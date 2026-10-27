import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BannerImage from "../BannerImage";
import { formatLength } from "../../bannerDisplay";
import { t, tn } from "../../i18n";
import { formatMinutes, walkingMinutes } from "./mapMath";
import { StatusChip } from "./shared";

// Card thumbnail: 84 wide, at most 84 × 74; taller banners pan.
const THUMB_ASPECT = 84 / 74;
// Cards re-sorted while the row was touched move once it hasn't scrolled for this long.
const THAW_MS = 400;
const FOLD_SWIPE_PX = 48;

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

// One banner: thumb, title, length · missions · walk, status. Tapping (clicking)
// the card selects it (route on the map), tapping it again deselects it; the "Details" button in its bottom-right corner opens
// the banner page. The button is a sibling of the card button laid over it (no
// nested interactive elements); an invisible copy of its label in the foot row
// keeps the status chip clear of it.
const RowCard = memo(function RowCard({ banner, selected, onToggle, onHover, onKeyDown, itemRef }) {
  const missions = Number(banner.numberOfMissions);
  const minutes = walkingMinutes(banner.lengthMeters);
  const details = (
    <>
      {t("Details")}
      <span className="mv-rc-details-chev" aria-hidden="true">
        ›
      </span>
    </>
  );

  const hover = onHover
    ? {
        onMouseEnter: () => onHover(banner.id),
        onMouseLeave: () => onHover(null),
        onFocus: () => onHover(banner.id),
        onBlur: () => onHover(null),
      }
    : null;

  return (
    <li className="mv-rc-item" ref={itemRef} data-banner-id={banner.id} {...hover}>
      <button
        type="button"
        className={`mv-rc${selected ? " on" : ""}`}
        aria-pressed={selected}
        onClick={() => onToggle(banner.id)}
        onKeyDown={onKeyDown}
      >
        <BannerImage banner={banner} className="mv-rc-thumb" minAspect={THUMB_ASPECT} />
        <span className="mv-rc-body">
          <span className="mv-rc-text">
            <span className="mv-rc-title">{banner.title}</span>
            <span className="mv-rc-stats">
              {formatLength(banner.lengthMeters)}
              {" · "}
              {Number.isFinite(missions) ? tn("{count} mission", "{count} missions", missions) : t("? missions")}
              {minutes !== null ? (
                <>
                  {" · "}
                  {t("{time} walk", { time: `~${formatMinutes(minutes)}` })}
                </>
              ) : null}
            </span>
          </span>
          <span className="mv-rc-foot">
            <StatusChip status={banner._status} />
            <span className="mv-rc-details mv-rc-details-space" aria-hidden="true">
              {details}
            </span>
          </span>
        </span>
      </button>
      <Link
        to={`/banner/${banner.id}`}
        className="mv-rc-details"
        aria-label={t("Details for {title}", { title: banner.title })}
        draggable={false}
        onClick={(event) => event.stopPropagation()}
      >
        {details}
      </Link>
    </li>
  );
});

function MoreCard({ count, onMore }) {
  return (
    <li className="mv-rc-item mv-rc-more-item">
      <button type="button" className="mv-rc mv-rc-more" onClick={onMore}>
        {tn("+{count} more · show list", "+{count} more · show list", count)}
      </button>
    </li>
  );
}

function RowHead({ count, inGroup, onExitGroup, routeStatus, children }) {
  return (
    <div className="mv-row-head">
      <span className="mv-row-count" role="status">
        {tn("{count} banner here", "{count} banners here", count)}
      </span>
      {inGroup ? (
        <button type="button" className="mv-row-link" onClick={onExitGroup}>
          {t("Show all in view")}
        </button>
      ) : null}
      {routeStatus === "loading" ? <span className="mv-row-note">{t("Loading route…")}</span> : null}
      {routeStatus === "error" ? <span className="mv-row-note">{t("Couldn't load the route")}</span> : null}
      <span className="mv-spacer" />
      {children}
    </div>
  );
}

function useItemRefs() {
  const refs = useRef(new globalThis.Map());
  const setters = useRef(new globalThis.Map());

  const refFor = useCallback((id) => {
    if (!setters.current.has(id)) {
      setters.current.set(id, (element) => {
        if (element) {
          refs.current.set(id, element);
        } else {
          refs.current.delete(id);
        }
      });
    }

    return setters.current.get(id);
  }, []);

  return [refs, refFor];
}

// Phone: a horizontal, freely scrolling row of cards above the bottom bar.
// Scrolling never selects anything and never moves the map: only tapping a card
// (or its dot) selects it, tapping it again deselects it.
//
// The finger owns the row: while it is down the cards keep their order, and the
// row is never nudged after it is let go: it stays wherever the momentum leaves
// it. Cards re-sorted meanwhile (map moved, more banners loaded) are applied once
// the row has been still for THAW_MS.
//
// The row scrolls by itself only to bring the selected card into view when it was
// picked on the map or by a half-hidden card, or after a re-sort, and then just
// far enough (like scrollIntoView "nearest"). A re-sort without a selection puts
// the row back at its start.
export function BannerCarousel({
  items,
  moreCount,
  count,
  focusId,
  onToggle,
  onMore,
  inGroup,
  onExitGroup,
  routeStatus,
  folded,
  onFold,
  onUnfold,
  rowRef,
}) {
  const scrollerRef = useRef(null);
  const [itemRefs, refFor] = useItemRefs();
  const thawTimer = useRef(null);
  const touching = useRef(false);
  // The card order shown while the user is touching/scrolling the row.
  const [frozen, setFrozen] = useState(null);
  const shown = frozen ?? items;
  const shownRef = useRef(shown);
  const itemsKey = useMemo(() => shown.map((banner) => banner.id).join("|"), [shown]);
  // What the row was last brought in line with.
  const last = useRef({ itemsKey: null, focusId: null, scroller: null });
  const touchStart = useRef(null);

  shownRef.current = shown;

  // Bring the selected card into view, as little as needed: smoothly when it was
  // just selected, at once when the cards were re-sorted or the row (re)appeared.
  // Re-sorted without a selection: back to the start. Never while a finger is on
  // the row.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller || touching.current) {
      return;
    }

    const reordered = last.current.itemsKey !== itemsKey || last.current.scroller !== scroller;
    const refocused = last.current.focusId !== focusId;
    last.current = { itemsKey, focusId, scroller };
    const card = focusId ? itemRefs.current.get(focusId) : null;
    let target = null;

    if (!card) {
      target = reordered ? 0 : null;
    } else if (reordered || refocused) {
      const padding = parseFloat(window.getComputedStyle(scroller).paddingLeft) || 0;
      const from = card.offsetLeft - padding;
      const to = card.offsetLeft + card.offsetWidth + padding - scroller.clientWidth;
      const left = scroller.scrollLeft;

      if (left > from + 1 || (to > from && left < from - 1)) {
        // Cut off on the left (or wider than the row): align its left edge.
        target = from;
      } else if (to <= from && left < to - 1) {
        // Cut off on the right: align its right edge.
        target = to;
      }
    }

    if (target === null) {
      return;
    }

    target = Math.max(0, target);

    if (Math.abs(target - scroller.scrollLeft) < 1) {
      return;
    }

    if (typeof scroller.scrollTo !== "function") {
      scroller.scrollLeft = target;
      return;
    }

    scroller.scrollTo({ left: target, behavior: reordered || prefersReducedMotion() ? "instant" : "smooth" });
  }, [focusId, itemsKey, itemRefs, folded, frozen]);

  useEffect(() => () => clearTimeout(thawTimer.current), []);

  useEffect(
    () => () => {
      touching.current = false;
    },
    [folded]
  );

  // Re-sorted cards wait until the row has been still for a moment.
  const scheduleThaw = () => {
    clearTimeout(thawTimer.current);
    thawTimer.current = setTimeout(() => setFrozen(null), THAW_MS);
  };

  const onScroll = () => {
    if (!touching.current) {
      scheduleThaw();
    }
  };

  const onTouchDown = () => {
    touching.current = true;
    clearTimeout(thawTimer.current);
    setFrozen((current) => current ?? shownRef.current);
  };

  const onTouchUp = (event) => {
    if (event.touches.length) {
      return;
    }

    touching.current = false;
    // Momentum keeps scrolling and pushes this further out; a tap without any
    // scroll still ends the freeze.
    scheduleThaw();
  };

  if (folded) {
    return (
      <button
        type="button"
        className="mv-row-handle"
        ref={rowRef}
        aria-label={t("Show the list")}
        aria-expanded="false"
        onClick={onUnfold}
      >
        {tn("{count} banner", "{count} banners", count)}
        <span aria-hidden="true">▴</span>
      </button>
    );
  }

  return (
    <section
      className="mv-row"
      ref={rowRef}
      aria-label={t("Banners in view")}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const touch = event.changedTouches[0];
        touchStart.current = null;

        if (!start || !touch) {
          return;
        }

        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;

        if (dy > FOLD_SWIPE_PX && dy > Math.abs(dx) * 1.5) {
          onFold();
        }
      }}
    >
      <RowHead count={count} inGroup={inGroup} onExitGroup={onExitGroup} routeStatus={routeStatus}>
        <button
          type="button"
          className="mv-row-fold"
          aria-label={t("Fold the list")}
          title={t("Fold the list")}
          aria-expanded="true"
          onClick={onFold}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
          </svg>
        </button>
      </RowHead>
      <ul
        className="mv-row-scroll"
        ref={scrollerRef}
        onScroll={onScroll}
        onTouchStart={onTouchDown}
        onTouchEnd={onTouchUp}
        onTouchCancel={onTouchUp}
      >
        {shown.map((banner) => (
          <RowCard
            key={banner.id}
            banner={banner}
            selected={banner.id === focusId}
            onToggle={onToggle}
            itemRef={refFor(banner.id)}
          />
        ))}
        {moreCount ? <MoreCard count={moreCount} onMore={onMore} /> : null}
      </ul>
    </section>
  );
}

// Desktop: the same cards as a list beside the map. Hover/focus lights up the
// dot, a click selects (route) or deselects, the card's Details button opens the
// banner. Arrow keys only move between the cards (Enter/Space toggles).
export function BannerSideList({
  items,
  moreCount,
  count,
  focusId,
  onToggle,
  onHover,
  onMore,
  inGroup,
  onExitGroup,
  routeStatus,
}) {
  const listRef = useRef(null);
  const [itemRefs, refFor] = useItemRefs();

  useEffect(() => {
    const card = focusId ? itemRefs.current.get(focusId) : null;
    card?.scrollIntoView?.({ block: "nearest" });
  }, [focusId, itemRefs]);

  const onKeyDown = useCallback((event) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };

    if (!(event.key in keys) || !listRef.current) {
      return;
    }

    const links = [...listRef.current.querySelectorAll(".mv-rc")];
    const index = links.indexOf(event.currentTarget);
    const step = keys[event.key];
    const next =
      step === "first" ? 0 : step === "last" ? links.length - 1 : Math.min(links.length - 1, Math.max(0, index + step));

    event.preventDefault();
    links[next]?.focus();
  }, []);

  return (
    <section className="mv-side" aria-label={t("Banners in view")}>
      <RowHead count={count} inGroup={inGroup} onExitGroup={onExitGroup} routeStatus={routeStatus} />
      <ul className="mv-side-list" ref={listRef}>
        {items.map((banner) => (
          <RowCard
            key={banner.id}
            banner={banner}
            selected={banner.id === focusId}
            onToggle={onToggle}
            onHover={onHover}
            onKeyDown={onKeyDown}
            itemRef={refFor(banner.id)}
          />
        ))}
        {moreCount ? <MoreCard count={moreCount} onMore={onMore} /> : null}
      </ul>
    </section>
  );
}
