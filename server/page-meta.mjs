// Link previews (Telegram, WhatsApp, Discord, …) for every OpenBanners page.
// server/banner-meta.mts serves the SPA shell with these tags filled in.
// Every route in src/App.jsx needs an entry here; src/pageMeta.test.js fails
// when a page is added without one.

export const SITE_ORIGIN = "https://openbanners.org";
export const SITE_NAME = "OpenBanners";
export const DEFAULT_DESCRIPTION = "Find, plan and walk Ingress mission banners.";
// The site's own preview card (public/og-image.png, made from
// docs/og-image-source.html): every page without a picture of its own.
export const DEFAULT_IMAGE = {
  url: `${SITE_ORIGIN}/og-image.png`,
  width: 1200,
  height: 630,
  alt: "OpenBanners: find, plan and walk Ingress mission banners",
};

// kind: what the server looks up for the preview (none, banner, place, plan).
// title/description: text for pages that need no lookup, or the fallback while
// the lookup fails. Params are already URL-decoded.
export const PAGES = [
  { path: "/", title: SITE_NAME, description: "Find Ingress mission banners near you, browse by place, plan Mission Days and walk them with the OpenBanners Overlay." },
  { path: "/browse/", title: "Browse banners", description: "Ingress mission banners by country, region and city." },
  { path: "/browse/:placeId", kind: "place", title: "Browse banners", description: "Ingress mission banners in this place." },
  { path: "/banner/:bannerId", kind: "banner", title: "Banner", description: DEFAULT_DESCRIPTION },
  { path: "/together/:placeId/live/:roomId", title: "Banner Together", description: "Compare banner lists with friends, live and end-to-end encrypted." },
  { path: "/together/:placeId", kind: "place", prefix: "Banner Together", title: "Banner Together", description: "Compare banner lists with friends: which banners you can still do together." },
  { path: "/agent/:agentName", title: ({ agentName }) => `Banners by ${agentName}`, description: ({ agentName }) => `Ingress mission banners made by agent ${agentName}.` },
  { path: "/rerouter", title: "Reroute Banner", description: "Build a rerouted banner from imported missions." },
  { path: "/planner", title: "Mission Day planner", description: "Pick the missions you want to do, put them in your order and walk them as one route with friends." },
  { path: "/privacy", title: "Privacy", description: "What OpenBanners stores and logs, and how to delete it." },
  { path: "/translate", title: "Translation editor", description: "Help translate OpenBanners: suggest better texts in your language." },
  { path: "/planner/:planId", kind: "plan", title: "Mission Day plan", description: "A Mission Day plan on OpenBanners: missions in order, on a map." },
  { path: "/bannerguider/:bannerId/debug", kind: "banner", prefix: "BannerGuider", title: "BannerGuider", description: DEFAULT_DESCRIPTION },
  { path: "/bannerguider/:bannerId", kind: "banner", prefix: "BannerGuider", title: "BannerGuider", description: DEFAULT_DESCRIPTION },
  { path: "/bannerguiderwithoutlocation/:bannerId", kind: "banner", prefix: "BannerGuider", title: "BannerGuider", description: DEFAULT_DESCRIPTION },
  { path: "/search", title: "Search banners", description: "Search Ingress mission banners by title, city or region." },
  { path: "/search/:query", title: ({ query }) => `“${query}” – banner search`, description: ({ query }) => `Ingress mission banners matching “${query}”.` },
  { path: "/near", title: "Banners near me", description: "Ingress mission banners close to where you are." },
  { path: "/map", title: "Banner map", description: "Every Ingress mission banner on one map." },
  { path: "/lists", title: "Your lists", description: "Your Bannergress to-do, done and hidden banners." },
  { path: "/lists/together", title: "Banner Together", description: "Compare banner lists with friends: which banners you can still do together." },
  { path: "/lists/together/:placeId", kind: "place", prefix: "Banner Together", title: "Banner Together", description: "Compare banner lists with friends: which banners you can still do together." },
  { path: "/lists/together/:placeId/live/:roomId", title: "Banner Together", description: "Compare banner lists with friends, live and end-to-end encrypted." },
];

function compile(path) {
  const names = [];
  const source = path
    .replace(/\/$/, "")
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  // Case-insensitive like React Router's routes.
  return { regex: new RegExp(`^${source}/?$`, "i"), names };
}

const COMPILED = PAGES.map((page) => ({ page, ...compile(page.path) }));

// { page, params } for a request path, or null (unknown page: default preview).
export function matchPage(requestPath) {
  const path = String(requestPath).split(/[?#]/, 1)[0] || "/";
  for (const { page, regex, names } of COMPILED) {
    const match = regex.exec(path);
    if (!match) {
      continue;
    }
    const params = {};
    try {
      names.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });
    } catch {
      return null;
    }
    if (Object.values(params).some((value) => !value || value.length > 200)) {
      return null;
    }
    return { page, params, path };
  }
  return null;
}

// Whether any page has this path (unknown paths get "Page not found" with
// status 404). Unlike matchPage, odd parameters still count as known.
export function isKnownPath(requestPath) {
  const path = String(requestPath).split(/[?#]/, 1)[0] || "/";
  return COMPILED.some(({ regex }) => regex.test(path));
}

const text = (value, params) => (typeof value === "function" ? value(params) : value);

// The preview without any lookup: the page's own text and the site's card
// (banners and plans swap in their own picture after the lookup).
export function staticPreview({ page, params, path }) {
  return {
    title: text(page.title, params),
    description: text(page.description, params),
    url: `${SITE_ORIGIN}${path}`,
    image: DEFAULT_IMAGE.url,
    type: "website",
  };
}
