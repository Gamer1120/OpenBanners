import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bookmark,
  BookmarkBorder,
  CheckCircle,
  CheckCircleOutline,
  CloudOff,
  DirectionsWalk,
  FormatListNumbered,
  Straighten,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import {
  getBannerListType,
  isBannergressAuthSupportedOrigin,
  updateBannergressBannerListType,
  useBannergressSync,
} from "../bannergressSync";
import {
  formatLength,
  getBannerAspect,
  getDisabledMissionCount,
  getDistanceMeters,
  getMissionsPerKm,
} from "../bannerDisplay";
import BannerImage, { getBoxAspect } from "./BannerImage";

const LIST_META = {
  todo: { label: "To do", icon: BookmarkBorder },
  done: { label: "Done", icon: CheckCircleOutline },
  blacklist: { label: "Hidden", icon: VisibilityOff },
};
const MIN_TILE_ASPECT = 0.8;
// List-row thumbnails are 112 × 72.
const ROW_THUMB_ASPECT = 112 / 72;

const ROW_ACTIONS = [
  { listType: "todo", label: "To do", icon: BookmarkBorder, activeIcon: Bookmark },
  { listType: "done", label: "Done", icon: CheckCircleOutline, activeIcon: CheckCircle },
  { listType: "blacklist", label: "Hide", icon: Visibility, activeIcon: VisibilityOff },
];

// To do / Done / Hide toggles on a compact row (same Bannergress call as the banner page).
function RowListActions({ banner, listType }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const title = (banner.title || "Untitled").trim();

  const toggle = async (nextListType) => {
    if (pending) {
      return;
    }

    const requested = listType === nextListType ? "none" : nextListType;
    setPending(nextListType);
    setError("");

    try {
      await updateBannergressBannerListType(banner.id, requested, {
        keepHiddenVisible: requested === "blacklist",
      });
    } catch (updateError) {
      console.error("Couldn't update Bannergress list type.", updateError);
      setError(
        updateError?.status === 401 || updateError?.status === 403
          ? "Authenticate again."
          : "Update failed."
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="brow-acts" role="group" aria-label={`Lists for ${title}`}>
      {ROW_ACTIONS.map((action) => {
        const active = listType === action.listType;
        const Icon = active ? action.activeIcon : action.icon;

        return (
          <button
            key={action.listType}
            type="button"
            className={`brow-act sl ${action.listType}${active ? " on" : ""}`}
            aria-pressed={active}
            aria-label={`${action.label}: ${title}`}
            title={action.label}
            disabled={Boolean(pending)}
            onClick={() => toggle(action.listType)}
          >
            <Icon />
          </button>
        );
      })}
      {error ? (
        <span className="brow-err" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function OfflineFlag({ banner }) {
  const disabled = getDisabledMissionCount(banner);

  if (!disabled) {
    return null;
  }

  return (
    <span className="aflag bad">
      <CloudOff />
      {disabled >= Number(banner.numberOfMissions) ? "Offline" : `${disabled} offline`}
    </span>
  );
}

function describeBanner(banner, distance, listType) {
  const parts = [
    (banner.title || "Untitled").trim(),
    `${banner.numberOfMissions ?? "?"} missions, ${formatLength(banner.lengthMeters)}`,
  ];

  if (distance !== null) {
    parts.push(`${formatLength(distance)} away`);
  }

  if (getDisabledMissionCount(banner)) {
    parts.push("has offline missions");
  }

  if (LIST_META[listType]) {
    parts.push(LIST_META[listType].label);
  }

  return parts.join(". ");
}

export function BannerTile({ banner, here, showAddress = true, listType }) {
  const distance = here
    ? getDistanceMeters(here, {
        latitude: Number(banner.startLatitude),
        longitude: Number(banner.startLongitude),
      })
    : null;
  const perKm = getMissionsPerKm(banner);
  const classes = ["art"];

  if (getDisabledMissionCount(banner)) {
    classes.push("off");
  }

  if (LIST_META[listType]) {
    classes.push(`ls-${listType}`);
  }

  return (
    <div className={classes.join(" ")}>
      <Link
        className="art-a"
        to={`/banner/${encodeURIComponent(banner.id)}`}
        aria-label={describeBanner(banner, distance, listType)}
      >
        <BannerImage banner={banner} className="art-pic" minAspect={MIN_TILE_ASPECT}>
          <span className="art-flags">
            <OfflineFlag banner={banner} />
          </span>
        </BannerImage>
        <span className="art-cap" aria-hidden="true">
          <span className="art-t">{(banner.title || "Untitled").trim()}</span>
          <span className="art-m">
            {distance !== null ? <b>{formatLength(distance)} away</b> : null}
            <span>
              <FormatListNumbered />
              {banner.numberOfMissions ?? "?"}
            </span>
            <span>
              <Straighten />
              {formatLength(banner.lengthMeters)}
            </span>
            {perKm !== null && distance === null ? (
              <span>
                <DirectionsWalk />
                {perKm.toFixed(1)}/km
              </span>
            ) : null}
          </span>
          {showAddress && banner.formattedAddress ? (
            <span className="art-ad">{banner.formattedAddress}</span>
          ) : null}
        </span>
      </Link>
    </div>
  );
}

function SkeletonTile({ aspect }) {
  return (
    <div className="art sk" aria-hidden="true" style={{ "--ar": aspect }}>
      <span className="art-a">
        <span className="art-pic" />
        <span className="art-cap">
          <span className="sk-line" />
          <span className="sk-line short" />
        </span>
      </span>
    </div>
  );
}

const SKELETON_ASPECTS = [5.8, 2.96, 1.5, 0.86, 5.8, 1.98, 1.19, 2.96, 0.86];

function useWallColumns(containerRef) {
  const [layout, setLayout] = useState({ columns: 2, columnWidth: 180, gap: 10 });

  useLayoutEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return undefined;
    }

    const measure = () => {
      const width = element.clientWidth || window.innerWidth || 1024;
      const small = width < 560;
      const gap = small ? 10 : 16;
      const minimumColumnWidth = small ? 150 : 220;
      const columns = Math.max(
        2,
        Math.min(6, Math.floor((width + gap) / (minimumColumnWidth + gap)))
      );
      const columnWidth = (width - gap * (columns - 1)) / columns;

      setLayout((current) =>
        current.columns === columns &&
        current.gap === gap &&
        Math.abs(current.columnWidth - columnWidth) < 1
          ? current
          : { columns, columnWidth, gap }
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  return layout;
}

// Masonry by real banner aspect: every tile is one column wide and goes into the
// currently shortest column, so appending a page never reshuffles earlier tiles.
export default function BannerWall({
  banners,
  here = null,
  showAddress = true,
  loadingMore = false,
  skeletonCount = 0,
  label = "Banners",
}) {
  const containerRef = useRef(null);
  const syncState = useBannergressSync();
  const { columns, columnWidth, gap } = useWallColumns(containerRef);
  const columnItems = useMemo(() => {
    const heights = new Array(columns).fill(0);
    const buckets = Array.from({ length: columns }, () => []);
    const place = (item, aspect) => {
      let shortest = 0;

      for (let index = 1; index < columns; index += 1) {
        if (heights[index] < heights[shortest] - 0.5) {
          shortest = index;
        }
      }

      buckets[shortest].push(item);
      heights[shortest] +=
        (columnWidth - 12) / getBoxAspect(aspect, MIN_TILE_ASPECT) +
        (showAddress ? 86 : 70) +
        gap;
    };

    banners.forEach((banner) => {
      place({ type: "banner", banner }, getBannerAspect(banner));
    });

    const skeletons = loadingMore ? Math.max(skeletonCount, 3) : skeletonCount;

    for (let index = 0; index < skeletons; index += 1) {
      const aspect = SKELETON_ASPECTS[index % SKELETON_ASPECTS.length];
      place({ type: "skeleton", key: `sk-${index}`, aspect }, aspect);
    }

    return buckets;
  }, [banners, columnWidth, columns, gap, loadingMore, showAddress, skeletonCount]);

  return (
    <div
      className="wall"
      ref={containerRef}
      role="list"
      aria-label={label}
      style={{ "--wall-gap": `${gap}px` }}
    >
      {columnItems.map((items, columnIndex) => (
        <div className="wall-col" key={columnIndex}>
          {items.map((item) =>
            item.type === "banner" ? (
              <div role="listitem" key={item.banner.id}>
                <BannerTile
                  banner={item.banner}
                  here={here}
                  showAddress={showAddress}
                  listType={getBannerListType(
                    syncState,
                    item.banner.id,
                    item.banner.listType
                  )}
                />
              </div>
            ) : (
              <SkeletonTile key={item.key} aspect={item.aspect} />
            )
          )}
        </div>
      ))}
    </div>
  );
}

export function BannerRows({ banners, here = null, label = "Banners", loadingMore = false }) {
  const syncState = useBannergressSync();
  const canUpdateLists = isBannergressAuthSupportedOrigin();

  return (
    <ul className="brows" aria-label={label}>
      {banners.map((banner) => {
        const listType = getBannerListType(syncState, banner.id, banner.listType);
        const distance = here
          ? getDistanceMeters(here, {
              latitude: Number(banner.startLatitude),
              longitude: Number(banner.startLongitude),
            })
          : null;
        const perKm = getMissionsPerKm(banner);

        return (
          <li
            key={banner.id}
            className={`brow${getDisabledMissionCount(banner) ? " off" : ""}${
              LIST_META[listType] ? ` ls-${listType}` : ""
            }`}
          >
            <Link className="brow-a sl" to={`/banner/${encodeURIComponent(banner.id)}`}>
              <BannerImage banner={banner} className="brow-pic" minAspect={ROW_THUMB_ASPECT} />
              <span className="brow-txt">
                <span className="brow-t">{(banner.title || "Untitled").trim()}</span>
                <span className="brow-s">
                  {banner.numberOfMissions ?? "?"} missions ·{" "}
                  {formatLength(banner.lengthMeters)}
                  {perKm !== null ? ` · ${perKm.toFixed(1)}/km` : ""}
                  {distance !== null ? ` · ${formatLength(distance)} away` : ""}
                </span>
                {banner.formattedAddress ? (
                  <span className="brow-s">{banner.formattedAddress}</span>
                ) : null}
              </span>
              <span className="brow-end">
                <OfflineFlag banner={banner} />
              </span>
            </Link>
            {canUpdateLists ? <RowListActions banner={banner} listType={listType} /> : null}
          </li>
        );
      })}
      {loadingMore
        ? Array.from({ length: 3 }).map((_, index) => (
            <li key={`row-sk-${index}`} className="brow" aria-hidden="true">
              <span className="brow-a">
                <span className="brow-pic" style={{ height: 56 }} />
                <span className="brow-txt">
                  <span className="sk-line" />
                  <span className="sk-line short" />
                </span>
              </span>
            </li>
          ))
        : null}
    </ul>
  );
}

// Calls onLoadMore whenever the sentinel is within ~1.5 screens of the viewport:
// on intersection, on scroll/resize and again after each page renders.
export function useInfiniteScroll(sentinelRef, { enabled, onLoadMore, itemCount }) {
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!enabled || !sentinel) {
      return undefined;
    }

    const margin = () => Math.max(600, (window.innerHeight || 800) * 1.5);
    const check = () => {
      const rect = sentinel.getBoundingClientRect();

      if (rect.top - (window.innerHeight || 800) < margin()) {
        onLoadMoreRef.current?.();
      }
    };
    let observer = null;

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            onLoadMoreRef.current?.();
          }
        },
        { rootMargin: `${Math.round(margin())}px 0px` }
      );
      observer.observe(sentinel);
    }

    const frame = window.requestAnimationFrame(check);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [enabled, itemCount, sentinelRef]);
}
