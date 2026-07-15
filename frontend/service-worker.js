/**
 * Cache only the known static application shell. API requests are deliberately
 * left to the application/network layer so cellar data is never served from an
 * accidental service-worker cache entry.
 */
const CACHE_NAME = "winecellar-shell-v15";

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
  "js/locationScheme.js",
  "js/pages/login.js",
  "js/pages/dashboard.js",
  "js/pages/cellars.js",
  "js/pages/bottles.js",
  "js/pages/addInventory.js",
  "js/pages/addInventoryJson.js",
  "js/pages/enrichmentResearch.js", "js/pages/manualChatGPTResearch.js", "js/pages/bottleDetails.js", "js/pages/cellarLocationBottles.js", "js/pages/candidateEditor.js",
  "js/pages/importPage.js",
  "js/pages/exportPage.js",
  "js/pages/stats.js",
  "js/pages/movePlan.js",
  "js/pages/dailyPicks.js",
  "js/pages/syncProblems.js",
  "i18n/en.json",
  "i18n/fr.json",
  "icons/icon.svg",
];

const APP_SHELL_PATHS = new Set(
  APP_SHELL.map((path) => new URL(path, self.registration.scope).pathname)
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(url) {
  return APP_SHELL_PATHS.has(url.pathname);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Navigation requests can fall back to the cached application entry point.
    if (request.mode === "navigate") {
      const rootUrl = new URL("./", self.registration.scope).toString();
      const root = await caches.match(rootUrl);
      if (root) return root;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !isAppShellRequest(url)
  ) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});


// CellarManager system status messages v1
async function rebuildAppShellCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = APP_SHELL.map(
    (path) => new Request(new URL(path, self.registration.scope), { cache: "reload" }),
  );
  await cache.addAll(requests);

  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (key) => key.startsWith("winecellar-shell-") && key !== CACHE_NAME,
      )
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const reply = (payload) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
  };

  if (message.type === "GET_STATUS") {
    reply({
      ok: true,
      cacheName: CACHE_NAME,
      appShellCount: APP_SHELL.length,
    });
    return;
  }

  if (message.type === "SKIP_WAITING") {
    event.waitUntil(
      self
        .skipWaiting()
        .then(() => reply({ ok: true, cacheName: CACHE_NAME }))
        .catch((error) => reply({ ok: false, error: String(error) })),
    );
    return;
  }

  if (message.type === "REFRESH_APP_SHELL") {
    event.waitUntil(
      rebuildAppShellCache()
        .then(() => reply({ ok: true, cacheName: CACHE_NAME }))
        .catch((error) => reply({ ok: false, error: String(error) })),
    );
  }
});
