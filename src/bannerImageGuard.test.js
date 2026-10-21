import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getBoxAspect,
  measurePan,
  MIN_PAN_FRACTION,
  MIN_PAN_PX,
} from "./components/BannerImage";

// Every banner picture must be rendered through <BannerImage> (src/components/
// BannerImage.jsx), which owns the tall-banner pan. This scans the source so a new
// page that renders banner.picture itself (an <img>, CSS background-image, MUI
// CardMedia…) fails here instead of shipping a cropped, non-panning banner.

const SRC = path.dirname(new URL(import.meta.url).pathname);
const OWNER = path.join(SRC, "components", "BannerImage.jsx");

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(full);
    }

    return /\.jsx$/.test(entry.name) && !/\.test\.jsx$/.test(entry.name) ? [full] : [];
  });
}

// Returns a description of every way `source` renders a banner picture itself.
export function findBannerPictureUses(source) {
  const problems = [];
  // Drop comments (but not the // of a URL).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  if (/\bgetBannerPictureUrl\b/.test(code)) {
    problems.push("uses getBannerPictureUrl");
  }

  if (/\bBANNERGRESS_ORIGIN\b/.test(code)) {
    problems.push("builds a URL from BANNERGRESS_ORIGIN");
  }

  if (/api\.bannergress\.com\$\{/.test(code)) {
    problems.push("builds an api.bannergress.com${…} picture URL");
  }

  // `x.picture` is only fine for mission pictures (mission.picture, mission?.picture).
  for (const match of code.matchAll(/([\w$]+)\s*\??\.\s*picture\b/g)) {
    if (!/mission/i.test(match[1])) {
      problems.push(`reads ${match[1]}.picture`);
    }
  }

  return problems;
}

describe("banner pictures go through <BannerImage>", () => {
  it("no component renders a banner picture itself", () => {
    const offenders = listSourceFiles(SRC)
      .filter((file) => file !== OWNER)
      .flatMap((file) =>
        findBannerPictureUses(fs.readFileSync(file, "utf8")).map(
          (problem) => `${path.relative(SRC, file)}: ${problem}`
        )
      );

    expect(offenders, "use <BannerImage banner={…}> from components/BannerImage.jsx").toEqual([]);
  });

  it("catches the usual ways of sneaking one in", () => {
    expect(findBannerPictureUses('<img src={getBannerPictureUrl(banner)} />')).not.toEqual([]);
    expect(
      findBannerPictureUses('<div style={{ backgroundImage: `url(${BANNERGRESS_ORIGIN}${b.picture})` }} />')
    ).not.toEqual([]);
    expect(findBannerPictureUses("<img src={`https://api.bannergress.com${banner.picture}`} />")).not.toEqual([]);
    expect(findBannerPictureUses("<CardMedia image={item.banner?.picture} />")).not.toEqual([]);
    expect(findBannerPictureUses("<img src={`${mission.picture}=s160`} />")).toEqual([]);
    expect(findBannerPictureUses("missions.some((mission) => mission?.picture)")).toEqual([]);
  });

  it("the owner component exists and keeps the rule comment", () => {
    expect(fs.readFileSync(OWNER, "utf8")).toMatch(/ONLY PLACE THAT RENDERS A BANNER PICTURE/);
  });
});

describe("pan measurement", () => {
  const box = (width, height) => ({ clientWidth: width, clientHeight: height });
  const image = (width, height) => ({ naturalWidth: width, naturalHeight: height });
  // 48 missions = 8 rows of 6: 604 × 804
  const tall = image(604, 804);

  it("pans a 48-mission banner in a wall tile as a share of its own height", () => {
    // 180 wide tile at aspect 0.8 → 225 tall; image is 239.6 tall
    expect(measurePan(box(180, 225), tall, 1)).toBe("-6.095%");
  });

  it("pans in a phone list-row thumbnail", () => {
    // 84 × 54: image 111.8 tall → 51.7 % of it scrolls away
    expect(measurePan(box(84, 54), tall, 1)).toBe("-51.706%");
  });

  it("does not pan tiny overflows (< 3 % or < 12 px)", () => {
    expect(measurePan(box(604, 790), tall, 1)).toBe(""); // 14 px but 1.7 %
    expect(measurePan(box(60, 70), tall, 1)).toBe(""); // 13 % but 9.9 px
    expect(MIN_PAN_FRACTION).toBe(0.03);
    expect(MIN_PAN_PX).toBe(12);
  });

  it("uses the banner aspect until the picture has loaded, and waits while hidden", () => {
    expect(measurePan(box(180, 225), image(0, 0), 604 / 804)).toBe("-6.095%");
    expect(measurePan(box(0, 0), tall, 1)).toBeNull();
  });

  it("keeps barely-too-tall banners at their own aspect", () => {
    expect(getBoxAspect(0.79, 0.8)).toBe(0.79);
    expect(getBoxAspect(604 / 804, 0.8)).toBe(0.8);
    expect(getBoxAspect(3, 0.8)).toBe(3);
  });
});
