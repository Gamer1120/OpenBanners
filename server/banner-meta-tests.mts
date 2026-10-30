import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  bannerIdFromRequestUrl,
  BOT_WAIT_MS,
  BROWSER_WAIT_MS,
  buildDescription,
  createBannerMetaServer,
  escapeHtml,
  isPreviewBot,
} from "./banner-meta.mts";

const shellHtml = [
  "<!DOCTYPE html>",
  "<html><head>",
  "<title>OpenBanners</title>",
  "<meta name=\"description\" content=\"An open-source front-end for banners\" />",
  "<meta property=\"og:type\" content=\"website\" />",
  "<meta property=\"og:title\" content=\"OpenBanners\" />",
  "<meta property=\"og:description\" content=\"An open-source front-end for banners\" />",
  "<meta property=\"og:url\" content=\"https://openbanners.org/\" />",
  "<meta property=\"og:image\" content=\"https://openbanners.org/logo512.png\" />",
  "<meta name=\"twitter:title\" content=\"OpenBanners\" />",
  "<meta name=\"twitter:description\" content=\"An open-source front-end for banners\" />",
  "<meta name=\"twitter:image\" content=\"https://openbanners.org/logo512.png\" />",
  "<link rel=\"canonical\" href=\"https://openbanners.org/\" />",
  "</head><body><div id=\"root\"></div></body></html>",
].join("\n");

const exampleBanner = {
  id: "nice-banner-1234",
  title: "Rock & Roll <Tour> $& 'quoted'",
  numberOfMissions: 18,
  lengthMeters: 4567,
  formattedAddress: "Enschede, Netherlands",
  picture: "/bnrs/pictures/abc",
};

async function startServer(
  t: test.TestContext,
  fetchImpl: typeof fetch,
  now?: () => number,
  waits: { browserWaitMs?: number; botWaitMs?: number } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "banner-meta-"));
  const indexHtmlPath = join(directory, "index.html");
  await writeFile(indexHtmlPath, shellHtml);
  const bannerMeta = createBannerMetaServer({ indexHtmlPath, fetchImpl, now, ...waits });
  const address = await bannerMeta.listen(0);
  t.after(() => bannerMeta.close());
  return `http://127.0.0.1:${address.port}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("parses banner ids like the PHP renderer did", () => {
  assert.equal(bannerIdFromRequestUrl("/banner/abc-123"), "abc-123");
  assert.equal(bannerIdFromRequestUrl("/banner/abc%20def?x=1#y"), "abc def");
  assert.equal(bannerIdFromRequestUrl("/banner/"), null);
  assert.equal(bannerIdFromRequestUrl("/banner/a/b"), null);
  assert.equal(bannerIdFromRequestUrl("/other/abc"), null);
  assert.equal(bannerIdFromRequestUrl("/banner/%E0%A4%A"), null);
  assert.equal(bannerIdFromRequestUrl(`/banner/${"a".repeat(201)}`), null);
});

test("builds descriptions from missions, distance and address", () => {
  assert.equal(buildDescription(exampleBanner), "18 Missions, 4.6 km, Enschede, Netherlands");
  assert.equal(buildDescription({ numberOfMissions: 1, lengthMeters: 1000 }), "1 Mission, 1 km");
  assert.equal(buildDescription({}), "An open-source front-end for banners");
});

test("escapes HTML the same way as htmlspecialchars with ENT_QUOTES", () => {
  assert.equal(escapeHtml("<a href=\"x\">'&'</a>"), "&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;");
});

test("injects escaped banner metadata into the SPA shell", async (t) => {
  const requestedUrls: string[] = [];
  const baseUrl = await startServer(t, async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse(exampleBanner);
  });

  const response = await fetch(`${baseUrl}/banner/nice-banner-1234`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.deepEqual(requestedUrls, ["https://api.bannergress.com/bnrs/nice-banner-1234"]);
  assert.match(html, /<title>Rock &amp; Roll &lt;Tour&gt; \$&amp; &#039;quoted&#039; \| OpenBanners<\/title>/);
  assert.match(html, /<meta property="og:type" content="article" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/openbanners.org\/banner\/nice-banner-1234" \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/openbanners.org\/banner\/nice-banner-1234" \/>/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/api.bannergress.com\/bnrs\/pictures\/abc" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/api.bannergress.com\/bnrs\/pictures\/abc" \/>/);
  assert.equal(html.match(/og:image"/g)?.length, 1);
  assert.doesNotMatch(html, /logo512/);
  assert.match(html, /<meta name="description" content="18 Missions, 4.6 km, Enschede, Netherlands" \/>/);
  assert.match(html, /<div id="root"><\/div>/);
});

test("falls back to the card when the banner is unavailable, and the plain shell for unknown pages", async (t) => {
  const baseUrl = await startServer(t, async () => jsonResponse({ error: "busy" }, 503));

  const unavailableResponse = await fetch(`${baseUrl}/banner/missing`);
  assert.equal(unavailableResponse.status, 200);
  const missing = await unavailableResponse.text();
  assert.doesNotMatch(missing, /noindex/);
  assert.match(missing, /<meta property="og:type" content="website" \/>/);
  assert.match(missing, /<meta property="og:image" content="https:\/\/openbanners.org\/og-image.png" \/>/);
  assert.doesNotMatch(missing, /logo512/);
  assert.match(missing, /<meta name="twitter:card" content="summary_large_image" \/>/);

  // Unknown pages: the plain shell (the app shows "Page not found"), 404, noindex.
  for (const path of ["/not-a-page", "/no/such/page", "/banner/x/extra"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, path);
    const html = await response.text();
    assert.match(html, /<meta name="robots" content="noindex" \/>/, path);
    assert.equal(html.replace(/\n\s*<meta name="robots" content="noindex" \/>/, ""), shellHtml, path);
  }
  // Known pages in any letter case stay 200, like React Router's routes.
  assert.equal((await fetch(`${baseUrl}/Map`)).status, 200);
});

test("a banner Bannergress doesn't know gets 404 and noindex (remembered for a few minutes)", async (t) => {
  let currentTime = 0;
  let calls = 0;
  const baseUrl = await startServer(t, async () => {
    calls += 1;
    return new Response("", { status: 404 });
  }, () => currentTime);

  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${baseUrl}/banner/this-does-not-exist`);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /<meta name="robots" content="noindex" \/>/);
    assert.match(html, /<title>Banner not found \| OpenBanners<\/title>/);
    assert.match(html, /<meta property="og:image" content="https:\/\/openbanners.org\/og-image.png" \/>/);
  }
  assert.equal(calls, 1);
  currentTime = 6 * 60 * 1000;
  assert.equal((await fetch(`${baseUrl}/banner/this-does-not-exist`)).status, 404);
  assert.equal(calls, 2);
});

test("every page gets its own title and the site's 1200x630 card, never the old logo", async (t) => {
  const baseUrl = await startServer(t, async () => jsonResponse({ error: "nope" }, 404));
  for (const [path, title] of [
    ["/", "OpenBanners"],
    ["/planner", "Mission Day planner | OpenBanners"],
    ["/agent/Some%20Agent", "Banners by Some Agent | OpenBanners"],
    ["/search/caf%C3%A9", "“café” – banner search | OpenBanners"],
    ["/map", "Banner map | OpenBanners"],
  ]) {
    const html = await fetch(`${baseUrl}${path}`).then((response) => response.text());
    assert.match(html, new RegExp(`<title>${title}</title>`), path);
    assert.doesNotMatch(html, /logo512/, path);
    assert.equal(html.match(/property="og:image"/g)?.length, 1, path);
    assert.match(html, /<meta property="og:image" content="https:\/\/openbanners.org\/og-image.png" \/>/, path);
    assert.match(html, /<meta property="og:image:width" content="1200" \/>/, path);
    assert.match(html, /<meta property="og:image:height" content="630" \/>/, path);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/, path);
    assert.match(html, /<meta property="og:type" content="website" \/>/, path);
  }
});

test("places and plans are looked up for their preview", async (t) => {
  const requested: string[] = [];
  const baseUrl = await startServer(t, async (url) => {
    requested.push(String(url));
    if (String(url).endsWith("/places/amsterdam-ae67")) {
      return jsonResponse({ id: "amsterdam-ae67", longName: "Amsterdam", formattedAddress: "Amsterdam, Netherlands", numberOfBanners: 127 });
    }
    if (String(url).endsWith("/plans/PlanPlanPlanPlanPlan12")) {
      return jsonResponse({ id: "PlanPlanPlanPlanPlan12", title: "MD Paris", banners: ["nice-banner-1234"], items: [{ done: true }, { done: false }, {}], readOnly: true });
    }
    return jsonResponse(exampleBanner);
  });

  const place = await fetch(`${baseUrl}/browse/amsterdam-ae67`).then((response) => response.text());
  assert.match(place, /<title>Banners in Amsterdam \| OpenBanners<\/title>/);
  assert.match(place, /content="127 Ingress mission banners in Amsterdam, Netherlands."/);

  const together = await fetch(`${baseUrl}/together/amsterdam-ae67`).then((response) => response.text());
  assert.match(together, /<title>Banner Together: Amsterdam \| OpenBanners<\/title>/);

  const plan = await fetch(`${baseUrl}/planner/PlanPlanPlanPlanPlan12`).then((response) => response.text());
  assert.match(plan, /<title>MD Paris \| OpenBanners<\/title>/);
  assert.match(plan, /Mission Day plan: 3 missions planned, 1 done, from Rock &amp; Roll &lt;Tour&gt; \$&amp; &#039;quoted&#039;. View only./);
  // The banner's picture, without our card's size.
  assert.match(plan, /og:image" content="https:\/\/api.bannergress.com\/bnrs\/pictures\/abc"/);
  assert.doesNotMatch(plan, /og:image:width/);
  assert.ok(requested.includes("http://127.0.0.1:8789/_openbanners/passphrases/v1/plans/PlanPlanPlanPlanPlan12"));

  const guider = await fetch(`${baseUrl}/bannerguiderwithoutlocation/nice-banner-1234`).then((response) => response.text());
  assert.match(guider, /<title>BannerGuider: Rock/);
  assert.match(guider, /og:url" content="https:\/\/openbanners.org\/bannerguiderwithoutlocation\/nice-banner-1234"/);
});

test("serves fresh cache, then stale cache when Bannergress fails", async (t) => {
  let currentTime = 0;
  let calls = 0;
  const baseUrl = await startServer(t, async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(exampleBanner);
    }
    throw new Error("network down");
  }, () => currentTime);

  await fetch(`${baseUrl}/banner/nice-banner-1234`).then((response) => response.text());
  currentTime = 60 * 1000;
  const cached = await fetch(`${baseUrl}/banner/nice-banner-1234`).then((response) => response.text());
  assert.equal(calls, 1);
  assert.match(cached, /og:type" content="article"/);

  currentTime = 16 * 60 * 1000;
  const stale = await fetch(`${baseUrl}/banner/nice-banner-1234`).then((response) => response.text());
  assert.equal(calls, 2);
  assert.match(stale, /og:type" content="article"/);
});

test("answers HEAD without a body and rejects other methods", async (t) => {
  const baseUrl = await startServer(t, async () => jsonResponse(exampleBanner));

  const head = await fetch(`${baseUrl}/banner/nice-banner-1234`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const post = await fetch(`${baseUrl}/banner/nice-banner-1234`, { method: "POST" });
  assert.equal(post.status, 405);
});

const TELEGRAM_BOT_UA = "TelegramBot (like TwitterBot)";
const TELEGRAM_ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 Telegram-Android/11.4.2 (Google Pixel 7; Android 14; SDK 34; AVERAGE)";
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

test("link-preview bots are recognised, people's browsers (also in-app ones) are not", () => {
  assert.equal(BROWSER_WAIT_MS, 1_500);
  assert.equal(BOT_WAIT_MS, 5_000);
  for (const ua of [
    TELEGRAM_BOT_UA,
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "WhatsApp/2.23.20.0 A",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  ]) {
    assert.equal(isPreviewBot(ua), true, ua);
  }
  for (const ua of [
    TELEGRAM_ANDROID_UA,
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Line/14.1.0",
    undefined,
  ]) {
    assert.equal(isPreviewBot(ua), false, String(ua));
  }
});

test("slow Bannergress: browsers get the page after the short wait, bots wait for the banner, the lookup fills the cache", async (t) => {
  let calls = 0;
  const baseUrl = await startServer(t, async () => {
    calls += 1;
    await sleep(400);
    return jsonResponse(exampleBanner);
  }, undefined, { browserWaitMs: 100, botWaitMs: 2_000 });

  let started = Date.now();
  const quick = await fetch(`${baseUrl}/banner/nice-banner-1234`, { headers: { "User-Agent": TELEGRAM_ANDROID_UA } });
  const quickHtml = await quick.text();
  const quickMs = Date.now() - started;
  assert.equal(quick.status, 200);
  assert.ok(quickMs < 350, `browser waited ${quickMs} ms`);
  assert.match(quickHtml, /og:image" content="https:\/\/openbanners.org\/og-image.png"/);
  assert.match(quickHtml, /og:type" content="website"/);

  // A bot asking at the same time shares the lookup and gets the banner.
  started = Date.now();
  const botHtml = await fetch(`${baseUrl}/banner/nice-banner-1234`, { headers: { "User-Agent": TELEGRAM_BOT_UA } }).then((response) => response.text());
  assert.ok(Date.now() - started < 1_000);
  assert.match(botHtml, /og:image" content="https:\/\/api.bannergress.com\/bnrs\/pictures\/abc"/);
  assert.match(botHtml, /og:type" content="article"/);
  assert.equal(calls, 1);

  // The next visitor gets the banner's preview straight from the cache.
  const cachedHtml = await fetch(`${baseUrl}/banner/nice-banner-1234`).then((response) => response.text());
  assert.match(cachedHtml, /og:type" content="article"/);
  assert.equal(calls, 1);
});

test("a bot gets the generic preview when Bannergress takes longer than the bot wait", async (t) => {
  const baseUrl = await startServer(t, async (_url, init) => {
    await sleep(1_000);
    if (init?.signal?.aborted) {
      throw new Error("aborted");
    }
    return jsonResponse(exampleBanner);
  }, undefined, { browserWaitMs: 50, botWaitMs: 200 });

  const started = Date.now();
  const response = await fetch(`${baseUrl}/banner/nice-banner-1234`, { headers: { "User-Agent": TELEGRAM_BOT_UA } });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(Date.now() - started < 700);
  assert.match(html, /og:image" content="https:\/\/openbanners.org\/og-image.png"/);
});

test("stale while revalidate: an expired copy answers at once while Bannergress hangs", async (t) => {
  let currentTime = 0;
  let calls = 0;
  const baseUrl = await startServer(t, async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(exampleBanner);
    }
    await sleep(2_000);
    return jsonResponse({ ...exampleBanner, title: "Renamed" });
  }, () => currentTime, { browserWaitMs: 1_000, botWaitMs: 1_000 });

  await fetch(`${baseUrl}/banner/nice-banner-1234`).then((response) => response.text());
  currentTime = 16 * 60 * 1000;
  const started = Date.now();
  const stale = await fetch(`${baseUrl}/banner/nice-banner-1234`, { headers: { "User-Agent": TELEGRAM_BOT_UA } }).then((response) => response.text());
  assert.ok(Date.now() - started < 500);
  assert.match(stale, /og:type" content="article"/);
  assert.match(stale, /Rock &amp; Roll/);
  assert.equal(calls, 2);
});
