import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  bannerIdFromRequestUrl,
  buildDescription,
  createBannerMetaServer,
  escapeHtml,
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

async function startServer(t: test.TestContext, fetchImpl: typeof fetch, now?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), "banner-meta-"));
  const indexHtmlPath = join(directory, "index.html");
  await writeFile(indexHtmlPath, shellHtml);
  const bannerMeta = createBannerMetaServer({ indexHtmlPath, fetchImpl, now });
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
  const baseUrl = await startServer(t, async () => jsonResponse({ error: "nope" }, 404));

  const missing = await fetch(`${baseUrl}/banner/missing`).then((response) => response.text());
  assert.match(missing, /<meta property="og:type" content="website" \/>/);
  assert.doesNotMatch(missing, /og:image|twitter:image|logo512/);
  assert.match(missing, /<meta name="twitter:card" content="summary" \/>/);

  const response = await fetch(`${baseUrl}/not-a-page`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), shellHtml);
});

test("every page gets its own title, and no logo as its image", async (t) => {
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
    assert.doesNotMatch(html, /og:image|twitter:image/, path);
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
