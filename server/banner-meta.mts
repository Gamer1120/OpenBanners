import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_ORIGIN = "https://openbanners.org";
const SITE_NAME = "OpenBanners";
const DEFAULT_TITLE = "OpenBanners";
const DEFAULT_DESCRIPTION = "An open-source front-end for banners";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logo512.png`;
const BANNERGRESS_API_ORIGIN = "https://api.bannergress.com";
const BANNERGRESS_IMAGE_ORIGIN = "https://api.bannergress.com";
const DEFAULT_INDEX_HTML_PATH = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const DEFAULT_PORT = 8788;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2_000;
const MAX_BANNER_ID_LENGTH = 200;
const FETCH_TIMEOUT_MS = 8_000;

type Banner = Record<string, unknown> & { id: string };

type BannerMetadata = {
  title: string;
  description: string;
  url: string;
  image: string;
};

type CacheEntry = {
  banner: Banner;
  storedAt: number;
};

export type BannerMetaServerOptions = {
  indexHtmlPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
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
    return DEFAULT_IMAGE;
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
  const replacements: Array<[RegExp, string]> = [
    [/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(formatDocumentTitle(metadata.title))}</title>`],
    [/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="description" content="${description}" />`],
    [/<meta\s+property="og:type"\s+content="[\s\S]*?"\s*\/>/i, "<meta property=\"og:type\" content=\"article\" />"],
    [/<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:title" content="${title}" />`],
    [/<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:description" content="${description}" />`],
    [/<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:url" content="${url}" />`],
    [/<meta\s+property="og:image"\s+content="[\s\S]*?"\s*\/>/i, `<meta property="og:image" content="${image}" />`],
    [/<meta\s+name="twitter:title"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="twitter:title" content="${title}" />`],
    [/<meta\s+name="twitter:description"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="twitter:description" content="${description}" />`],
    [/<meta\s+name="twitter:image"\s+content="[\s\S]*?"\s*\/>/i, `<meta name="twitter:image" content="${image}" />`],
    [/<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/>/i, `<link rel="canonical" href="${url}" />`],
  ];

  // A replacer function keeps "$" sequences in banner titles from being read as patterns.
  return replacements.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, () => replacement),
    html,
  );
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
  const inFlight = new Map<string, Promise<Banner | null>>();
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

      if (apiResponse.status !== 200) {
        return loadCachedBanner(bannerId, true);
      }

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

    let pending = inFlight.get(bannerId);
    if (pending === undefined) {
      pending = requestBanner(bannerId).finally(() => inFlight.delete(bannerId));
      inFlight.set(bannerId, pending);
    }

    return pending;
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

    const bannerId = bannerIdFromRequestUrl(request.url ?? "");
    const banner = bannerId === null ? null : await fetchBanner(bannerId);

    if (bannerId === null || banner === null) {
      sendHtml(response, request, html);
      return;
    }

    sendHtml(response, request, injectMetadata(html, buildMetadata(banner, bannerId)));
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
