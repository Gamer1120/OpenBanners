import React from "react";
import { getSlotCount } from "../../bannerMissions";
import { t, tn } from "../../i18n";
import { getTileGap } from "./artViewer";

function isOffline(mission) {
  return typeof mission?.status === "string" && mission.status !== "published";
}

// The banner artwork from its mission pictures, mission 1 bottom-right like in the
// Ingress scanner. Tiles aren't links: tapping the artwork opens the viewer.
// slots[i] is mission i's position in the banner; a position without a mission
// (a filler slot) stays an empty tile, like on Bannergress.
// tile: tile size in px (the viewer); without it the tiles fill the width up to the
// CSS --t (the hero). numbers: show each tile's mission number. rowRange [from, to]:
// only rows in it get their picture (the viewer's rows near the screen; native lazy
// loading inside a scroll box still fetched all 1152 pictures of a966 at once).
export default function MissionMosaic({
  banner,
  missions,
  slots,
  colors,
  tile = null,
  numbers = false,
  pictureSize = 160,
  rowRange = null,
  className = "",
}) {
  const width = Number(banner.width) || 6;
  const count = missions.length;
  const missionSlots =
    Array.isArray(slots) && slots.length === count ? slots : missions.map((_, index) => index);
  const slotCount = getSlotCount(missionSlots);
  const indexBySlot = new Map(missionSlots.map((slot, index) => [slot, index]));
  const rows = Math.max(1, Math.ceil(slotCount / width));
  const padding = rows * width - slotCount;
  const hasPictures = missions.some((mission) => mission?.picture);

  if (!count || !hasPictures) {
    return null;
  }

  const cells = [];

  for (let cell = 0; cell < rows * width; cell += 1) {
    if (cell < padding) {
      cells.push(<span key={`void-${cell}`} className="void" aria-hidden="true" />);
      continue;
    }

    const slot = slotCount - 1 - (cell - padding);
    const index = indexBySlot.get(slot);

    if (index === undefined) {
      cells.push(<span key={`gap-${slot}`} className="void gap" aria-hidden="true" />);
      continue;
    }

    const mission = missions[index];

    cells.push(
      <span
        key={mission.id ?? index}
        className={`tile${isOffline(mission) ? " off" : ""}`}
        style={{ "--c": colors[index] }}
        data-n={index + 1}
        title={tile ? t("Mission {number}: {title}", { number: index + 1, title: mission.title ?? "" }) : undefined}
      >
        {mission.picture && (!rowRange || (Math.floor(cell / width) >= rowRange[0] && Math.floor(cell / width) <= rowRange[1])) ? (
          <img
            src={`${mission.picture}=s${pictureSize}`}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </span>
    );
  }

  const sizing = tile ? { "--t": `${tile}px`, "--gap": `${getTileGap(tile)}px` } : null;

  return (
    <div
      className={`mosaic${tile ? " fixed" : ""}${numbers ? " nums" : ""}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={tn(
        "Banner artwork: {count} mission tile, {width} per row.",
        "Banner artwork: {count} mission tiles, {width} per row.",
        count,
        { width }
      )}
      style={{ "--w": width, "--rows": rows, ...sizing }}
    >
      {cells}
    </div>
  );
}

// Banners without mission pictures: the banner's own picture.
export function hasMissionPictures(missions) {
  return missions.some((mission) => mission?.picture);
}
