import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BannerImage from "../BannerImage";
import { formatLength } from "../../bannerDisplay";
import { t, tn } from "../../i18n";
import { formatMinutes, walkingMinutes } from "./mapMath";
import { StatusChip } from "./shared";

// Card thumbnail: 84 wide, at most 84 × 74; taller banners pan.
const THUMB_ASPECT = 84 / 74;
// Without scrollend, the row counts as settled when it hasn't scrolled for this
// long (and no finger is on it).
const SETTLE_MS = 150;
// Cards re-sorted while the row was being swiped move this long after it settled.
const REORDER_GRACE_MS = 250;
const FOLD_SWIPE_PX = 48;

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

// One banner: thumb, title, length · missions · walk, status. The whole card is
// the link to the banner page; when it isn't the selected one yet, a tap (click)
// selects it instead of opening it.
const RowCard = memo(function RowCard({ banner, selected, onSelect, onHover, onKeyDown, itemRef }) {
  const missions = Number(banner.numberOfMissions);
  const minutes = walkingMinutes(banner.lengthMeters);

  return (
    <li className="mv-rc-item" ref={itemRef} data-banner-id={banner.id}>
      <Link
        to={`/banner/${banner.id}`}
        className={`mv-rc${selected ? " on" : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={(event) => {
          if (!selected) {
            event.preventDefault();
            onSelect(banner.id);
          }
        }}
        onMouseEnter={onHover ? () => onHover(banner.id) : undefined}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
        onFocus={onHover ? () => onHover(banner.id) : undefined}
        onBlur={onHover ? () => onHover(null) : undefined}
        onKeyDown={onKeyDown}
      >
        <BannerImage banner={banner} className="mv-rc-thumb" minAspect={THUMB_ASPECT} />
        <span className="mv-rc-body">
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
          <span className="mv-rc-foot">
            <StatusChip status={banner._status} />
          </span>
        </span>
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

// Phone: a horizontal, snapping row of cards above the bottom bar. The card in
// the middle is the selected banner; swiping only changes the selection and
// never moves the map.
//
// The finger owns the row: while it is down nothing selects, scrolls or
// re-sorts the cards. Once the row has come to rest (scrollend, or no scroll
// event for SETTLE_MS without a finger on it) the middle card is selected; that
// selection never scrolls the row again (it is already in the middle). Cards
// re-sorted meanwhile (map moved, more banners loaded) are applied
// REORDER_GRACE_MS later, keeping the selected card in the middle.
export function BannerCarousel({
  items,
  moreCount,
  count,
  focusId,
  onFocus,
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
  const settleTimer = useRef(null);
  const thawTimer = useRef(null);
  const focusRef = useRef(focusId);
  const touching = useRef(false);
  // Only a scroll the user made selects a card (not one that new cards, a
  // re-sort or a programmatic scroll caused).
  const userScrolled = useRef(false);
  // The id the row selected itself by coming to rest on it.
  const rowPicked = useRef(null);
  // The card order shown while the user is touching/scrolling the row.
  const [frozen, setFrozen] = useState(null);
  const shown = frozen ?? items;
  const shownRef = useRef(shown);
  const itemsKey = useMemo(() => shown.map((banner) => banner.id).join("|"), [shown]);
  // What the row was last brought in line with.
  const last = useRef({ itemsKey: null, focusId: null, scroller: null });
  const touchStart = useRef(null);

  focusRef.current = focusId;
  shownRef.current = shown;

  // Bring the selected card to the middle: smoothly when the selection changed
  // (a dot or a side card was tapped), at once when the cards were re-sorted
  // under it or the row (re)appeared. Never while a finger is on the row.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const card = focusId ? itemRefs.current.get(focusId) : null;

    if (!scroller || !card || touching.current) {
      return;
    }

    const reordered = last.current.itemsKey !== itemsKey || last.current.scroller !== scroller;
    const refocused = last.current.focusId !== focusId;
    const fromRow = rowPicked.current === focusId;
    last.current = { itemsKey, focusId, scroller };
    rowPicked.current = null;

    if (!reordered && (!refocused || fromRow)) {
      return;
    }

    const target = card.offsetLeft + card.offsetWidth / 2 - scroller.clientWidth / 2;

    if (Math.abs(scroller.scrollLeft - target) < 2) {
      return;
    }

    if (typeof scroller.scrollTo !== "function") {
      scroller.scrollLeft = target;
      return;
    }

    scroller.scrollTo({ left: target, behavior: reordered || prefersReducedMotion() ? "instant" : "smooth" });
  }, [focusId, itemsKey, itemRefs, folded, frozen]);

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current);
      clearTimeout(thawTimer.current);
    },
    []
  );

  const settle = () => {
    const scroller = scrollerRef.current;
    clearTimeout(settleTimer.current);

    if (!scroller || touching.current) {
      return;
    }

    const middle = scroller.scrollLeft + scroller.clientWidth / 2;
    let best = null;
    let bestDistance = Infinity;

    for (const [id, element] of itemRefs.current) {
      const distance = Math.abs(element.offsetLeft + element.offsetWidth / 2 - middle);

      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }

    const byUser = userScrolled.current;
    userScrolled.current = false;

    if (best && best !== focusRef.current) {
      const card = focusRef.current ? itemRefs.current.get(focusRef.current) : null;

      if (!byUser) {
        // The cards moved under the row (not the user): put the selected one back.
        if (card) {
          scroller.scrollLeft = card.offsetLeft + card.offsetWidth / 2 - scroller.clientWidth / 2;
        }
      } else if (bestDistance < scroller.clientWidth / 2) {
        // (On the "+N more" card nothing else is close: keep the selection.)
        rowPicked.current = best;
        onFocus(best);
      }
    }

    clearTimeout(thawTimer.current);
    thawTimer.current = setTimeout(() => setFrozen(null), REORDER_GRACE_MS);
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const scheduleSettle = () => {
    clearTimeout(settleTimer.current);
    clearTimeout(thawTimer.current);
    settleTimer.current = setTimeout(() => settleRef.current(), SETTLE_MS);
  };

  // scrollend (where supported) settles right when the snap has finished.
  useEffect(() => {
    const scroller = scrollerRef.current;

    if (folded || !scroller) {
      return undefined;
    }

    const onScrollEnd = () => settleRef.current();
    scroller.addEventListener("scrollend", onScrollEnd);
    return () => {
      scroller.removeEventListener("scrollend", onScrollEnd);
      touching.current = false;
    };
  }, [folded]);

  const onUserScroll = () => {
    userScrolled.current = true;
  };

  const onTouchDown = () => {
    touching.current = true;
    userScrolled.current = true;
    clearTimeout(settleTimer.current);
    clearTimeout(thawTimer.current);
    setFrozen((current) => current ?? shownRef.current);
  };

  const onTouchUp = (event) => {
    if (event.touches.length) {
      return;
    }

    touching.current = false;
    // Momentum and the snap keep scrolling and push this further out; a tap
    // without any scroll still ends the freeze.
    scheduleSettle();
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
        onScroll={scheduleSettle}
        onWheel={onUserScroll}
        onKeyDown={onUserScroll}
        onTouchStart={onTouchDown}
        onTouchEnd={onTouchUp}
        onTouchCancel={onTouchUp}
      >
        {shown.map((banner) => (
          <RowCard
            key={banner.id}
            banner={banner}
            selected={banner.id === focusId}
            onSelect={onFocus}
            itemRef={refFor(banner.id)}
          />
        ))}
        {moreCount ? <MoreCard count={moreCount} onMore={onMore} /> : null}
      </ul>
    </section>
  );
}

// Desktop: the same cards as a list beside the map. Hover/focus lights up the
// dot, a click selects (route), a second click opens the banner. Arrow keys
// move between the cards.
export function BannerSideList({
  items,
  moreCount,
  count,
  focusId,
  onFocus,
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
            onSelect={onFocus}
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
