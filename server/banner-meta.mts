import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_IMAGE, isKnownPath, matchPage, SITE_ORIGIN as PAGE_ORIGIN, staticPreview } from "./page-meta.mjs";

export const SITE_ORIGIN = "https://openbanners.org";
const SITE_NAME = "OpenBanners";
const DEFAULT_TITLE = "OpenBanners";
const DEFAULT_DESCRIPTION = "An open-source front-end for banners";
// Mission Day plans live in the passphrase service next to this one.
const DEFAULT_PLANS_API = "http://127.0.0.1:8789/_openbanners/passphrases/v1";
const BANNERGRESS_API_ORIGIN = "https://api.bannergress.com";
const BANNERGRESS_IMAGE_ORIGIN = "https://api.bannergress.com";
const DEFAULT_INDEX_HTML_PATH = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const DEFAULT_PORT = 8788;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2_000;
const MAX_BANNER_ID_LENGTH = 200;
const FETCH_TIMEOUT_MS = 8_000;
// Bannergress said 404: remembered this long (a new banner may appear later).
const MISSING_TTL_MS = 5 * 60 * 1000;

type Banner = Record<string, unknown> & { id: string };

type BannerMetadata = {
  title: string;
  description: string;
  url: string;
  // "" = no image: pages without a picture of their own get a text-only preview.
  image: string;
  type?: "website" | "article";
  // Bannergress says the banner doesn't exist: status 404 and noindex.
  notFound?: boolean;
};

type CacheEntry = {
  banner: Banner;
  storedAt: number;
};

type JsonCacheEntry = {
  value: Record<string, unknown>;
  storedAt: number;
};

export type BannerMetaServerOptions = {
  indexHtmlPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  plansApi?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDocumentTitle(title: string): string {
  const normalizedTitle = normalizeText(title) || SITE_NAME;

  return normalizedTitle === SITE_NAME
    ? SITE_NAME
    : `${normalizedTitle} | ${SITE_NAME}`;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildDescription(banner: Record<string, unknown>): string {
  const missionCount = toFiniteNumber(banner.numberOfMissions);
  const lengthMeters = toFiniteNumber(banner.lengthMeters);
  const missions = missionCount === null ? null : Math.trunc(missionCount);
  const formattedMissions = missions === null
    ? ""
    : `${missions} ${missions === 1 ? "Mission" : "Missions"}`;
  const formattedDistance = lengthMeters === null
    ? ""
    : `${Math.round((lengthMeters / 1000) * 10) / 10} km`;
  const formattedAddress = normalizeText(banner.formattedAddress);

  const description = [formattedMissions, formattedDistance, formattedAddress]
    .filter((part) => part !== "")
    .join(", ");

  return description || DEFAULT_DESCRIPTION;
}

function toAbsoluteImageUrl(value: unknown): string {
  const image = normalizeText(value);

  if (image === "") {
    return "";
  }

  if (/^https?:\/\//i.test(image)) {
    return image;
  }

  return `${BANNERGRESS_IMAGE_ORIGIN}/${image.replace(/^\/+/, "")}`;
}

export function bannerIdFromRequestUrl(requestUrl: string): string | null {
  const path = requestUrl.split(/[?#]/, 1)[0] ?? "";
  const match = /^\/banner\/([^/]+)$/.exec(path);

  if (match === null) {
    return null;
  }

  let bannerId: string;
  try {
    bannerId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  return bannerId !== "" && bannerId.length <= MAX_BANNER_ID_LENGTH ? bannerId : null;
}

export function buildMetadata(banner: Banner, requestedBannerId: string): BannerMetadata {
  const canonicalBannerId = normalizeText(banner.id) || requestedBannerId;

  return {
    title: normalizeText(banner.title) || DEFAULT_TITLE,
    description: buildDescription(banner),
    url: `${SITE_ORIGIN}/banner/${encodeURIComponent(canonicalBannerId)}`,
    image: toAbsoluteImageUrl(banner.picture),
  };
}

export function injectMetadata(html: string, metadata: BannerMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const url = escapeHtml(metadata.url);
  const image = escapeHtml(metadata.image);
  // Image tags right after og:url, with the matching Twitter card size. The
  // site's own card (DEFAULT_IMAGE) also gets its size and alt text; banner
  // and plan pictures come in any size.
  const isDefaultImage = metadata.image === DEFAULT_IMAGE.url;
  const imageDetails = isDefaultImage
    ? `\n<meta property="og:image:width" content="${DEFAULT_IMAGE.width}" />\n<meta property="og:image:height" content="${DEFAULT_IMAGE.height}" />\n<meta property="og:image:alt" content="${escapeHtml(DEFAULT_IMAGE.alt)}" />\n<meta name="twitter:image:alt" content="${escapeHtml(DEFAULT_IMAGE.alt)}" />`
    : "";
  const afterUrl = (image
    ? `\n<meta property="og:image" content="${image}" />${imageDetails}\n<meta name="twitter:image" content="${image}" />`
    : "") + `\n<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`;
  const cleaned = html.replace(
    /[ \t]*<meta\s+(?:property="og:image(?::[a-z]+)?"|name="twitter:(?:image(?::alt)?|card)")\s+content="[^"]*"\s*\/>\n?/gi,
    "",
  );
  const replacements: Array<[RegExp, string]> = [
    [/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(formatDocumentTitle(metadata.title))}</title>`],
    [/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="description" content="${description}" />`],
    [/<meta\s+property="og:type"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:type" content="${metadata.type ?? "article"}" />`],
    [/<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:title" content="${title}" />`],
    [/<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:description" content="${description}" />`],
    [/<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:url" content="${url}" />${afterUrl}`],
    [/<meta\s+name="twitter:title"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="twitter:title" content="${title}" />`],
    [/<meta\s+name="twitter:description"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="twitter:description" content="${description}" />`],
    [/<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/>/i, `<link rel="canonical" href="${url}" />`],
  ];

  // A replacer function keeps "$" sequences in banner titles from being read as patterns.
  return replacements.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, () => replacement),
    cleaned,
  );
}

export function notFoundHtml(html: string): string {
  return html.replace(/<head>/i, () => `<head>\n    <meta name="robots" content="noindex" />`);
}

function sendHtml(response: ServerResponse, request: IncomingMessage, html: string, statusCode = 200): void {
  const body = Buffer.from(html, "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

export function createBannerMetaServer(options: BannerMetaServerOptions = {}) {
  const indexHtmlPath = options.indexHtmlPath
    ?? (normalizeText(process.env.OPENBANNERS_INDEX_HTML) || DEFAULT_INDEX_HTML_PATH);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const jsonCache = new Map<string, JsonCacheEntry>();
  const plansApi = (options.plansApi ?? (normalizeText(process.env.OPENBANNERS_PLANS_API) || DEFAULT_PLANS_API)).replace(/\/+$/, "");
  const inFlight = new Map<string, Promise<Banner | null>>();
  // Banner ids Bannergress answered 404 for, with the time.
  const missing = new Map<string, number>();

  function isKnownMissing(bannerId: string): boolean {
    const storedAt = missing.get(bannerId);
    return storedAt !== undefined && now() - storedAt <= MISSING_TTL_MS;
  }
  let indexHtml: string | null = null;

  async function loadIndexHtml(): Promise<string | null> {
    if (indexHtml === null) {
      try {
        indexHtml = (await readFile(indexHtmlPath, "utf8")) || null;
      } catch {
        return null;
      }
    }

    return indexHtml;
  }

  function loadCachedBanner(bannerId: string, allowStale: boolean): Banner | null {
    const entry = cache.get(bannerId);

    if (entry === undefined) {
      return null;
    }

    return allowStale || now() - entry.storedAt <= CACHE_TTL_MS ? entry.banner : null;
  }

  function storeCachedBanner(bannerId: string, banner: Banner): void {
    cache.delete(bannerId);
    cache.set(bannerId, { banner, storedAt: now() });

    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  async function requestBanner(bannerId: string): Promise<Banner | null> {
    try {
      const apiResponse = await fetchImpl(`${BANNERGRESS_API_ORIGIN}/bnrs/${encodeURIComponent(bannerId)}`, {
        headers: { Accept: "application/json", "User-Agent": "OpenBannersMeta/2.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (apiResponse.status === 404 || apiResponse.status === 410) {
        cache.delete(bannerId);
        missing.delete(bannerId);
        missing.set(bannerId, now());
        while (missing.size > MAX_CACHE_ENTRIES) {
          const oldestKey = missing.keys().next().value;
          if (oldestKey === undefined) {
            break;
          }
          missing.delete(oldestKey);
        }
        return null;
      }

      if (apiResponse.status !== 200) {
        return loadCachedBanner(bannerId, true);
      }

      missing.delete(bannerId);

      const banner: unknown = await apiResponse.json();

      if (!isPlainObject(banner) || normalizeText(banner.id) === "") {
        return loadCachedBanner(bannerId, true);
      }

      storeCachedBanner(bannerId, banner as Banner);
      return banner as Banner;
    } catch {
      return loadCachedBanner(bannerId, true);
    }
  }

  function fetchBanner(bannerId: string): Promise<Banner | null> {
    const freshBanner = loadCachedBanner(bannerId, false);

    if (freshBanner !== null) {
      return Promise.resolve(freshBanner);
    }

    if (isKnownMissing(bannerId)) {
      return Promise.resolve(null);
    }

    let pending = inFlight.get(bannerId);
    if (pending === undefined) {
      pending = requestBanner(bannerId).finally(() => inFlight.delete(bannerId));
      inFlight.set(bannerId, pending);
    }

    return pending;
  }

  // Places and plans: fetched like banners (fresh for 15 minutes, stale when the source fails).
  async function fetchJson(url: string, ttlMs = CACHE_TTL_MS): Promise<Record<string, unknown> | null> {
    const entry = jsonCache.get(url);
    if (entry !== undefined && now() - entry.storedAt <= ttlMs) {
      return entry.value;
    }
    try {
      const apiResponse = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "OpenBannersMeta/2.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const value: unknown = apiResponse.status === 200 ? await apiResponse.json() : null;
      if (!isPlainObject(value)) {
        return entry?.value ?? null;
      }
      jsonCache.delete(url);
      jsonCache.set(url, { value, storedAt: now() });
      while (jsonCache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = jsonCache.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        jsonCache.delete(oldestKey);
      }
      return value;
    } catch {
      return entry?.value ?? null;
    }
  }

  const withPrefix = (prefix: unknown, title: string) => (typeof prefix === "string" && prefix ? `${prefix}: ${title}` : title);

  // The preview for any page: its own text and our card, filled in from
  // Bannergress or the plan where there is something to look up.
  async function previewFor(requestUrl: string): Promise<BannerMetadata | null> {
    const match = matchPage(requestUrl);
    if (match === null) {
      return null;
    }
    const { page, params } = match;
    const fallback = staticPreview(match);
    const base: BannerMetadata = { ...fallback, type: "website" };

    if (page.kind === "banner") {
      const banner = await fetchBanner(params.bannerId);
      if (banner === null) {
        return isKnownMissing(params.bannerId)
          ? { ...base, title: "Banner not found", description: "This banner doesn't exist (any more) on Bannergress.", notFound: true }
          : base;
      }
      const found = buildMetadata(banner, params.bannerId);
      // A banner without a picture keeps the site's card.
      const metadata = found.image ? found : { ...found, image: base.image };
      return page.path === "/banner/:bannerId"
        ? metadata
        : { ...metadata, title: withPrefix(page.prefix, metadata.title), url: `${PAGE_ORIGIN}${match.path}` };
    }

    if (page.kind === "place") {
      const place = await fetchJson(`${BANNERGRESS_API_ORIGIN}/places/${encodeURIComponent(params.placeId)}`, 6 * 60 * 60 * 1000);
      const name = normalizeText(place?.longName) || normalizeText(place?.shortName);
      if (place === null || name === "") {
        return base;
      }
      const count = toFiniteNumber(place.numberOfBanners);
      const where = normalizeText(place.formattedAddress) || name;
      const description = page.prefix
        ? `${base.description} In ${where}.`
        : count === null
          ? `Ingress mission banners in ${where}.`
          : `${Math.trunc(count)} Ingress mission ${count === 1 ? "banner" : "banners"} in ${where}.`;
      return { ...base, title: page.prefix ? withPrefix(page.prefix, name) : `Banners in ${name}`, description };
    }

    if (page.kind === "plan") {
      const plan = await fetchJson(`${plansApi}/plans/${encodeURIComponent(params.planId)}`, 60 * 1000);
      if (plan === null) {
        return base;
      }
      const items = Array.isArray(plan.items) ? plan.items.filter(isPlainObject) : [];
      const bannerIds = Array.isArray(plan.banners) ? plan.banners.map(normalizeText).filter(Boolean) : [];
      const banners = (await Promise.all(bannerIds.slice(0, 3).map((id) => fetchBanner(id)))).filter((banner): banner is Banner => banner !== null);
      const done = items.filter((item) => item.done === true).length;
      const titles = banners.map((banner) => normalizeText(banner.title)).filter(Boolean);
      const parts = [
        `${items.length} ${items.length === 1 ? "mission" : "missions"} planned`,
        done ? `${done} done` : "",
        titles.length ? `from ${titles.join(", ")}${bannerIds.length > titles.length ? " and more" : ""}` : "",
      ].filter(Boolean);
      const picture = banners.find((banner) => normalizeText(banner.picture) !== "");
      return {
        ...base,
        title: normalizeText(plan.title) || base.title,
        description: `Mission Day plan: ${parts.join(", ")}.${plan.readOnly === true ? " View only." : ""}`,
        image: picture ? toAbsoluteImageUrl(picture.picture) : base.image,
      };
    }

    return base;
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const html = await loadIndexHtml();

    if (html === null) {
      sendHtml(response, request, "OpenBanners shell not found.", 500);
      return;
    }

    // A path no page knows: still the SPA shell (it shows "Page not found"
    // with the menu), but with status 404 and noindex.
    if (!isKnownPath(request.url ?? "/")) {
      sendHtml(response, request, notFoundHtml(html), 404);
      return;
    }

    const preview = await previewFor(request.url ?? "/");
    if (preview?.notFound) {
      // The app shows "This banner doesn't exist"; search engines drop it.
      sendHtml(response, request, notFoundHtml(injectMetadata(html, preview)), 404);
      return;
    }
    sendHtml(response, request, preview === null ? html : injectMetadata(html, preview));
  }

  const server: Server = createServer((request, response) => {
    handleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
  });

  return {
    server,
    async listen(port = DEFAULT_PORT, host = "127.0.0.1"): Promise<AddressInfo> {
      await new Promise<void>((resolveListen, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolveListen();
        });
      });
      return server.address() as AddressInfo;
    },
    async close(): Promise<void> {
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
      });
    },
  };
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const bannerMeta = createBannerMetaServer();
  await bannerMeta.listen(DEFAULT_PORT, "127.0.0.1");
  process.stdout.write(`Banner metadata listening on 127.0.0.1:${DEFAULT_PORT}\n`);

  const shutdown = async () => {
    await bannerMeta.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
