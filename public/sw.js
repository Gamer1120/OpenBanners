// OpenBanners service worker. It exists so browsers offer "Install app"
// (Chrome wants a service worker with a fetch handler); it caches nothing.
// Same-origin page loads go to the network as usual and only get a small
// offline page when the network fails. Everything else - assets, the
// Bannergress API and login, /_openbanners/ services, the sign-in callback,
// other sites - is left alone (no respondWith), so the browser handles it
// exactly as without a service worker. See AGENTS.md before changing this.

const BYPASS_PATHS = ["/bannergress-auth-callback.html", "/_openbanners/", "/api/"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const OFFLINE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="theme-color" content="#16161c"><title>OpenBanners</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16161c;' +
  'color:#e6e1e9;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}' +
  'button{margin-top:16px;font:inherit;padding:8px 20px;border-radius:20px;border:0;background:#38bdf8;color:#0f172a}</style>' +
  '</head><body><main><h1>You are offline</h1><p>OpenBanners needs an internet connection.</p>' +
  '<button onclick="location.reload()">Try again</button></main></body></html>';

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || request.mode !== "navigate") {
    return;
  }

  const url = new URL(request.url);

  if (
    url.origin !== self.location.origin ||
    BYPASS_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(path))
  ) {
    return;
  }

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        })
    )
  );
});
