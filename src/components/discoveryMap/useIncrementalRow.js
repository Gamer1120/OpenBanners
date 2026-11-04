import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ROW_PAGE, buildRow, rowCountFor } from "./rowModel";

// The next ROW_PAGE cards render once the end of the list is this close to
// the visible part of it (a few cards ahead, so a flick rarely reaches the end).
export const LOAD_AHEAD_PX = 900;

function startOf(element, horizontal) {
  return horizontal ? element.offsetLeft : element.offsetTop;
}

function endOf(element, horizontal) {
  return horizontal ? element.offsetLeft + element.offsetWidth : element.offsetTop + element.offsetHeight;
}

// The first card (at least partly) in view and how far its start is from the
// scroll position; null at the start of the list. The cards are in order, so a
// binary search keeps this cheap with hundreds of them. Offsets are relative to
// the scroller (it is position: relative).
function readAnchor(scroller, horizontal) {
  const position = horizontal ? scroller.scrollLeft : scroller.scrollTop;

  if (position <= 1) {
    return null;
  }

  const cards = scroller.children;
  let low = 0;
  let high = cards.length - 1;
  let found = null;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const card = cards[middle];

    if (!card.dataset.bannerId || endOf(card, horizontal) > position + 1) {
      found = card.dataset.bannerId ? card : found;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return found ? { id: found.dataset.bannerId, delta: startOf(found, horizontal) - position } : null;
}

function cardFor(scroller, id) {
  for (const card of scroller.children) {
    if (card.dataset.bannerId === id) {
      return card;
    }
  }

  return null;
}

// Infinite scroll for the banners-in-view row/list. sorted: every banner in
// view in row order (already loaded for the map). Renders ROW_PAGE cards, and
// ROW_PAGE more each time the sentinel after the last card comes within
// LOAD_AHEAD_PX of view (IntersectionObserver on the scroller), so the DOM only
// holds the cards scrolled past plus a few screens.
//
// resetKey (map view, filters, group) changing starts over at ROW_PAGE; the
// component scrolls back to the start / the selected card. When the same view
// re-sorts (more pages of banners arrived, a list status changed) while the
// list is scrolled away from its start, the first card in view keeps its place
// on screen (and stays rendered), so nothing jumps under the reader.
export default function useIncrementalRow({ sorted, focusId, resetKey, horizontal = false }) {
  const scrollerRef = useRef(null);
  const [scroller, setScrollerState] = useState(null);
  const [sentinel, setSentinel] = useState(null);
  const [state, setState] = useState(() => ({ count: ROW_PAGE, sorted, resetKey }));
  const anchor = useRef(null);
  const committed = useRef(null);

  // Derived during render (React's "adjust state on prop change" pattern).
  let count = state.count;
  let changed = false;

  if (state.resetKey !== resetKey) {
    count = ROW_PAGE;
    changed = true;
  } else if (state.sorted !== sorted) {
    changed = true;
    const id = anchor.current?.id;
    const index = id ? sorted.findIndex((banner) => banner.id === id) : -1;

    if (index >= 0) {
      count = Math.max(count, index + ROW_PAGE);
    }
  }

  // A selected card a little further down extends the list to it for good,
  // so it doesn't shrink back when the selection ends.
  count = Math.max(count, rowCountFor(sorted, focusId, count));

  if (changed || count !== state.count) {
    setState({ count, sorted, resetKey });
  }

  const row = useMemo(() => buildRow(sorted, focusId, count), [sorted, focusId, count]);

  const setScroller = useCallback((element) => {
    scrollerRef.current = element;
    setScrollerState(element);
  }, []);

  // Keep the anchor current while scrolling (once per frame at most).
  useEffect(() => {
    if (!scroller) {
      return undefined;
    }

    let frame = 0;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    const onScroll = () => {
      if (!frame) {
        frame = schedule(() => {
          frame = 0;
          anchor.current = readAnchor(scroller, horizontal);
        });
      }
    };

    anchor.current = readAnchor(scroller, horizontal);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) {
        cancel(frame);
      }
    };
  }, [horizontal, scroller]);

  // After a re-sort of the same view: put the anchor card back where it was.
  useLayoutEffect(() => {
    const previous = committed.current;
    committed.current = { sorted, resetKey };
    const element = scrollerRef.current;

    if (!previous || !element) {
      return;
    }

    if (previous.resetKey !== resetKey) {
      anchor.current = null;
      return;
    }

    if (previous.sorted === sorted || !anchor.current) {
      return;
    }

    const card = cardFor(element, anchor.current.id);

    if (!card) {
      return;
    }

    const target = Math.max(0, startOf(card, horizontal) - anchor.current.delta);

    if (horizontal) {
      element.scrollLeft = target;
    } else {
      element.scrollTop = target;
    }
  }, [horizontal, resetKey, sorted]);

  // Render the next cards when the end comes near.
  const { hasMore, shown } = row;

  useEffect(() => {
    if (!scroller || !sentinel || !hasMore) {
      return undefined;
    }

    const grow = () =>
      setState((current) => ({ ...current, count: Math.max(current.count, shown) + ROW_PAGE }));

    if (typeof IntersectionObserver === "function") {
      // A new observer after every step: its first callback says whether the
      // end is still near (a fast fling), and then it grows again.
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            grow();
          }
        },
        {
          root: scroller,
          rootMargin: horizontal ? `0px ${LOAD_AHEAD_PX}px 0px 0px` : `0px 0px ${LOAD_AHEAD_PX}px 0px`,
        }
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    }

    // No IntersectionObserver: check the distance to the end on scroll.
    let done = false;
    const check = () => {
      const remaining = horizontal
        ? scroller.scrollWidth - scroller.scrollLeft - scroller.clientWidth
        : scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;

      if (!done && remaining < LOAD_AHEAD_PX) {
        done = true;
        grow();
      }
    };

    scroller.addEventListener("scroll", check, { passive: true });
    check();
    return () => scroller.removeEventListener("scroll", check);
  }, [hasMore, horizontal, scroller, sentinel, shown]);

  return { items: row.items, hasMore, scrollerRef, setScroller, sentinelRef: setSentinel };
}
