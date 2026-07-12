/**
 * Caches the static app shell (HTML/CSS/JS/i18n/icons) so the app still
 * loads with no connection. API calls are NOT cached here - api.js handles
 * offline reads via its own IndexedDB cache and queues writes in the
 * outbox; letting API requests fail through to the network (or fail
 * outright when offline, which api.js catches) keeps this service worker
 * simple and avoids ever serving stale/incorrect cellar data silently.
 */
const CACHE_NAME = "winecellar-shell-v1";
const APP_SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "js/app.js",
  "js/api.js",
  "js/db.js",
  "js/dom.js",
  "js/i18n.js",
  "js/router.js",
  "js/charts.js",
  "js/offlineQueue.js",
  "js/pages/login.js",
  "js/pages/dashboard.js",
  "js/pages/cellars.js",
  "js/pages/bottles.js",
  "js/pages/importPage.js",
  "js/pages/exportPage.js",
  "js/pages/stats.js",
  "js/pages/movePlan.js",
  "js/pages/dailyPicks.js",
  "i18n/en.json",
  "i18n/fr.json",
  "icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  // Anything not matching a known static asset path is treated as an API
  // call and left to the network / api.js's own offline handling.
  return !APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "")));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return; // let it hit the network normally

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
