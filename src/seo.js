const SITE_NAME = "OpenBanners";
const DEFAULT_TITLE = SITE_NAME;
const DEFAULT_DESCRIPTION = "An open-source front-end for banners";
const DEFAULT_PATH = "/";
const DEFAULT_IMAGE_PATH = "/logo512.png";
const BANNERGRESS_IMAGE_ORIGIN = "https://api.bannergress.com";

function getDocumentOrigin() {
  if (typeof window === "undefined" || !window.location?.origin) {
    return "https://openbanners.org";
  }

  return window.location.origin;
}

function toAbsoluteSiteUrl(value, fallbackPath = "/") {
  if (!value) {
    return new URL(fallbackPath, getDocumentOrigin()).toString();
  }

  try {
    return new URL(value, getDocumentOrigin()).toString();
  } catch {
    return new URL(fallbackPath, getDocumentOrigin()).toString();
  }
}

function toAbsoluteImageUrl(value) {
  if (!value) {
    return toAbsoluteSiteUrl(DEFAULT_IMAGE_PATH, DEFAULT_IMAGE_PATH);
  }

  try {
    return new URL(value, BANNERGRESS_IMAGE_ORIGIN).toString();
  } catch {
    return toAbsoluteSiteUrl(DEFAULT_IMAGE_PATH, DEFAULT_IMAGE_PATH);
  }
}

function ensureMetaTag(attribute, name) {
  if (typeof document === "undefined") {
    return null;
  }

  let element = document.head.querySelector(`meta[${attribute}="${name}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }

  return element;
}

function setMetaContent(attribute, name, content) {
  const element = ensureMetaTag(attribute, name);

  if (!element) {
    return;
  }

  element.setAttribute("content", content);
}

function ensureCanonicalLink() {
  if (typeof document === "undefined") {
    return null;
  }

  let element = document.head.querySelector('link[rel="canonical"]');

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  return element;
}

function setCanonicalUrl(url) {
  const element = ensureCanonicalLink();

  if (!element) {
    return;
  }

  element.setAttribute("href", url);
}

export function buildBannerMetadata(banner) {
  if (!banner || typeof banner !== "object") {
    return null;
  }

  const title =
    typeof banner.title === "string" && banner.title.trim() !== ""
      ? banner.title.trim()
      : DEFAULT_TITLE;
  const missionCount = Number(banner.numberOfMissions);
  const lengthMeters = Number(banner.lengthMeters);
  const formattedDistance = Number.isFinite(lengthMeters)
    ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
    : null;
  const formattedMissions = Number.isFinite(missionCount)
    ? `${missionCount} ${missionCount === 1 ? "Mission" : "Missions"}`
    : null;
  const formattedAddress =
    typeof banner.formattedAddress === "string" &&
    banner.formattedAddress.trim() !== ""
      ? banner.formattedAddress.trim()
      : null;
  const description = [formattedMissions, formattedDistance, formattedAddress]
    .filter(Boolean)
    .join(", ");
  const image = toAbsoluteImageUrl(banner.picture);
  const path =
    typeof banner.id === "string" && banner.id.trim() !== ""
      ? `/banner/${encodeURIComponent(banner.id)}`
      : DEFAULT_PATH;

  return {
    title,
    description: description || DEFAULT_DESCRIPTION,
    image,
    url: toAbsoluteSiteUrl(path, path),
  };
}

export function applyPageMetadata({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  image = toAbsoluteSiteUrl(DEFAULT_IMAGE_PATH, DEFAULT_IMAGE_PATH),
  url = toAbsoluteSiteUrl(DEFAULT_PATH, DEFAULT_PATH),
  type = "website",
} = {}) {
  if (typeof document === "undefined") {
    return;
  }

  document.title = title;
  setCanonicalUrl(url);
  setMetaContent("name", "description", description);
  setMetaContent("property", "og:type", type);
  setMetaContent("property", "og:site_name", SITE_NAME);
  setMetaContent("property", "og:title", title);
  setMetaContent("property", "og:description", description);
  setMetaContent("property", "og:url", url);
  setMetaContent("property", "og:image", image);
  setMetaContent("name", "twitter:card", "summary_large_image");
  setMetaContent("name", "twitter:title", title);
  setMetaContent("name", "twitter:description", description);
  setMetaContent("name", "twitter:image", image);
}

export function resetPageMetadata() {
  applyPageMetadata();
}
