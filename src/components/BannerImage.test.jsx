import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BannerImage, { getPanSlowdown, getPanSpeedClass } from "./BannerImage";
import { HeroMosaic } from "./bannerDetails/shared";

const banner = (numberOfMissions) => ({
  id: `b${numberOfMissions}`,
  title: "Test",
  width: 6,
  numberOfMissions,
  picture: "/bnrs/pictures/test",
});

describe("big banners pan slower outside the banner page", () => {
  it("half speed above 250 missions, a quarter above 500", () => {
    expect(getPanSlowdown(undefined)).toBe(1);
    expect(getPanSlowdown(250)).toBe(1);
    expect(getPanSlowdown(251)).toBe(2);
    expect(getPanSlowdown(500)).toBe(2);
    expect(getPanSlowdown(501)).toBe(4);
    expect(getPanSlowdown(1152)).toBe(4);
    expect(getPanSpeedClass(banner(250))).toBe("");
    expect(getPanSpeedClass(banner(251))).toBe("slow2");
    expect(getPanSpeedClass(banner(500))).toBe("slow2");
    expect(getPanSpeedClass(banner(501))).toBe("slow4");
    expect(getPanSpeedClass(banner(1152), true)).toBe("");
  });

  it("puts the speed class on banner cards", () => {
    const classesFor = (count, props = {}) =>
      render(<BannerImage banner={banner(count)} minAspect={1} {...props} />).container.firstChild.className;

    expect(classesFor(250)).not.toMatch(/slow/);
    expect(classesFor(251)).toMatch(/\bslow2\b/);
    expect(classesFor(501)).toMatch(/\bslow4\b/);
    expect(classesFor(1152, { steadyPan: true })).not.toMatch(/slow/);
  });

  it("leaves the banner page picture at normal speed", () => {
    const missions = Array.from({ length: 1152 }, (_, index) => ({ id: `m${index}`, title: "m" }));
    const { container } = render(<HeroMosaic banner={banner(1152)} missions={missions} slots={null} colors={[]} />);
    const picture = container.querySelector(".bimg");
    expect(picture).not.toBeNull();
    expect(picture.className).not.toMatch(/slow/);
  });

  it("keeps the 1 s pauses in the slower loops", () => {
    const css = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "BannerImage.css"), "utf8");
    const stops = (name) =>
      [...css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))[1].matchAll(/([\d.]+)% \{/g)].map((m) => Number(m[1]));
    const seconds = (name, total) => stops(name).map((stop) => Math.round((stop / 100) * total * 10) / 10);

    expect(css).toMatch(/\.slow2 > \.bimg-i \{\s*animation-name: bimg-pan-2;\s*animation-duration: 14s;/);
    expect(css).toMatch(/\.slow4 > \.bimg-i \{\s*animation-name: bimg-pan-4;\s*animation-duration: 26s;/);
    expect(seconds("bimg-pan", 8)).toEqual([0, 5, 6, 7, 8]);
    expect(seconds("bimg-pan-2", 14)).toEqual([0, 10, 11, 13, 14]);
    expect(seconds("bimg-pan-4", 26)).toEqual([0, 20, 21, 25, 26]);
  });
});
