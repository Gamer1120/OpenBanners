import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SITE_ORIGIN = "https://openbanners.org";
const DEFAULT_DESCRIPTION = "An open-source front-end for banners";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logo512.png`;
const BANNERGRESS_IMAGE_ORIGIN = "https://api.bannergress.com";
const OUTPUT_DIR = path.resolve("dist", "banner");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildDescription(banner) {
  const missionCount = Number(banner.numberOfMissions);
  const lengthMeters = Number(banner.lengthMeters);
  const formattedDistance = Number.isFinite(lengthMeters)
    ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
    : "";
  const formattedMissions = Number.isFinite(missionCount)
    ? `${missionCount} ${missionCount === 1 ? "Mission" : "Missions"}`
    : "";
  const formattedAddress = normalizeText(banner.formattedAddress);

  return (
    [formattedMissions, formattedDistance, formattedAddress]
      .filter(Boolean)
      .join(", ") || DEFAULT_DESCRIPTION
  );
}

function toImageUrl(value) {
  if (!value) {
    return DEFAULT_IMAGE;
  }

  try {
    return new URL(value, BANNERGRESS_IMAGE_ORIGIN).toString();
  } catch {
    return DEFAULT_IMAGE;
  }
}

function injectMetadata(template, metadata) {
  const replacements = new Map([
    [/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`],
    [
      /<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
    ],
    [
      /<meta\s+property="og:type"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta property="og:type" content="article" />`,
    ],
    [
      /<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
    ],
    [
      /<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
    ],
    [
      /<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta property="og:url" content="${escapeHtml(metadata.url)}" />`,
    ],
    [
      /<meta\s+property="og:image"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta property="og:image" content="${escapeHtml(metadata.image)}" />`,
    ],
    [
      /<meta\s+name="twitter:title"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta name="twitter:title" content="${escapeHtml(metadata.title)}" />`,
    ],
    [
      /<meta\s+name="twitter:description"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`,
    ],
    [
      /<meta\s+name="twitter:image"\s+content="[\s\S]*?"\s*\/>/i,
      `<meta name="twitter:image" content="${escapeHtml(metadata.image)}" />`,
    ],
    [
      /<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/>/i,
      `<link rel="canonical" href="${escapeHtml(metadata.url)}" />`,
    ],
  ]);

  let html = template;

  for (const [pattern, replacement] of replacements.entries()) {
    html = html.replace(pattern, replacement);
  }

  return html;
}

async function prerenderBannerPage(bannerId) {
  const response = await fetch(
    `https://api.bannergress.com/bnrs/${encodeURIComponent(bannerId)}`
  );

  if (!response.ok) {
    throw new Error(`Bannergress request failed for ${bannerId}: ${response.status}`);
  }

  const banner = await response.json();

  if (!banner || typeof banner !== "object" || !normalizeText(banner.id)) {
    throw new Error(`Unexpected Bannergress payload for ${bannerId}`);
  }

  const title = normalizeText(banner.title) || "OpenBanners";
  const description = buildDescription(banner);
  const url = `${SITE_ORIGIN}/banner/${encodeURIComponent(banner.id)}`;
  const image = toImageUrl(banner.picture);
  const template = await readFile(path.resolve("dist", "index.html"), "utf8");
  const html = injectMetadata(template, { title, description, url, image });
  const outputPath = path.join(OUTPUT_DIR, banner.id, "index.html");

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  return { bannerId: banner.id, outputPath, title, description, image, url };
}

async function main() {
  const bannerIds = process.argv.slice(2).filter(Boolean);

  if (bannerIds.length === 0) {
    console.error("Usage: node scripts/prerender-banner-pages.mjs <banner-id> [more-banner-ids...]");
    process.exitCode = 1;
    return;
  }

  const results = [];

  for (const bannerId of bannerIds) {
    results.push(await prerenderBannerPage(bannerId));
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
