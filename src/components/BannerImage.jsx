import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getBannerAspect, getBannerPictureUrl } from "../bannerDisplay";
import "./BannerImage.css";

// THE ONLY PLACE THAT RENDERS A BANNER PICTURE.
// Banner pictures can be very tall (a 48-mission banner is 8 rows of 6), and every
// fixed-height box that crops one must slowly pan it (Bannergress's 8 s loop: 5 s
// down, 1 s pause, 1 s back up, 1 s pause; also under reduced motion), or a long
// banner only ever shows its top. Doing that
// separately per page kept breaking, so every <img> / background-image of
// banner.picture goes through <BannerImage>. src/bannerImageGuard.test.js fails
// the build when a component renders getBannerPictureUrl / banner.picture itself.
//
// Modes:
//   pan      (default) the picture fills the box width and pans when it is taller.
//            The box gets its size from minAspect (box aspect = the banner's own
//            aspect, but never narrower than minAspect) or from the caller's CSS.
//   contain  the whole picture, centred in a box sized by the caller's CSS
//            (tiny thumbnails ≤ ~56 px tall: too small to pan).
//   natural  a bare <img> at its own aspect, sized by the caller (shown whole).
//   backdrop decorative background-image (e.g. the blurred hero backdrop).

// Overflow smaller than this is not worth a pan: the picture stays still, centred.
export const MIN_PAN_FRACTION = 0.03;
export const MIN_PAN_PX = 12;

// Upward pan as a share of the image's own height, so it never depends on the
// box size (container query units resolved against the viewport in some browsers).
export function getPanFraction(imageAspect, boxAspect) {
  return Math.max(0, 1 - imageAspect / boxAspect);
}

// Box aspect for a banner of aspect `aspect` that should be no narrower than
// minAspect. Barely-too-tall banners keep their own aspect instead of panning.
export function getBoxAspect(aspect, minAspect) {
  return aspect < minAspect * (1 - MIN_PAN_FRACTION) ? minAspect : aspect;
}

export function measurePan(box, image, fallbackAspect) {
  const boxWidth = box.clientWidth;
  const boxHeight = box.clientHeight;

  // Hidden or not laid out yet: keep the last state, the ResizeObserver retries.
  if (!boxWidth || !boxHeight) {
    return null;
  }

  const imageAspect =
    image && image.naturalWidth && image.naturalHeight
      ? image.naturalWidth / image.naturalHeight
      : fallbackAspect;
  const fraction = getPanFraction(imageAspect, boxWidth / boxHeight);
  const overflowPx = fraction * (boxWidth / imageAspect);

  return fraction >= MIN_PAN_FRACTION && overflowPx >= MIN_PAN_PX
    ? `${(-fraction * 100).toFixed(3)}%`
    : "";
}

function PanningImage({ banner, url, minAspect, className, style, alt, eager, children }) {
  const boxRef = useRef(null);
  const imageRef = useRef(null);
  const [pan, setPan] = useState("");
  const aspect = getBannerAspect(banner);

  const measure = useCallback(() => {
    if (!boxRef.current) {
      return;
    }

    const next = measurePan(boxRef.current, imageRef.current, aspect);

    if (next !== null) {
      setPan((current) => (current === next ? current : next));
    }
  }, [aspect]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    measure();

    if (!box) {
      return undefined;
    }

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure, url]);

  const boxStyle = minAspect
    ? { aspectRatio: getBoxAspect(aspect, minAspect).toFixed(4), ...style }
    : style;

  return (
    <span
      ref={boxRef}
      className={`bimg${pan ? " pan" : ""}${className ? ` ${className}` : ""}`}
      style={pan ? { ...boxStyle, "--pan": pan } : boxStyle}
    >
      {url ? (
        <img
          ref={imageRef}
          className="bimg-i"
          src={url}
          alt={alt}
          loading={eager ? undefined : "lazy"}
          decoding="async"
          width="604"
          height={Math.round(604 / aspect)}
          onLoad={measure}
        />
      ) : null}
      {children}
    </span>
  );
}

export default function BannerImage({
  banner,
  mode = "pan",
  minAspect,
  className = "",
  style,
  alt = "",
  eager = false,
  children,
}) {
  const url = getBannerPictureUrl(banner);

  if (mode === "backdrop") {
    return url ? (
      <div
        className={className}
        style={{ ...style, backgroundImage: `url("${url}")` }}
        aria-hidden="true"
      />
    ) : null;
  }

  if (mode === "natural") {
    return url ? (
      <img
        className={className}
        style={style}
        src={url}
        alt={alt}
        loading={eager ? undefined : "lazy"}
        decoding="async"
      />
    ) : null;
  }

  if (mode === "contain") {
    return (
      <span className={`bimg contain${className ? ` ${className}` : ""}`} style={style}>
        {url ? (
          <img className="bimg-i" src={url} alt={alt} loading="lazy" decoding="async" />
        ) : null}
        {children}
      </span>
    );
  }

  return (
    <PanningImage
      banner={banner}
      url={url}
      minAspect={minAspect}
      className={className}
      style={style}
      alt={alt}
      eager={eager}
    >
      {children}
    </PanningImage>
  );
}
