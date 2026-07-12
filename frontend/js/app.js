import * as db from "./db.js";
import * as api from "./api.js";
import { initI18n, t, getLocale, setLocale, SUPPORTED_LOCALES } from "./i18n.js";
import { registerRoute, startRouter, navigate } from "./router.js";
import { el, clear, showToast } from "./dom.js";

import { renderLogin } from "./pages/login.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderCellars, renderCellarDetail } from "./pages/cellars.js";
import { renderBottles } from "./pages/bottles.js";
import { renderImport } from "./pages/importPage.js";
import { renderExport } from "./pages/exportPage.js";
import { renderStats } from "./pages/stats.js";
import { renderMovePlan } from "./pages/movePlan.js";
import { renderDailyPicks } from "./pages/dailyPicks.js";

const appRoot = document.getElementById("app");
const navRoot = document.getElementById("nav");
const statusBanner = document.getElementById("status-banner");

const NAV_ITEMS = [
  ["/dashboard", "nav.dashboard"],
  ["/cellars", "nav.cellars"],
  ["/bottles", "nav.bottles"],
  ["/picks", "nav.picks"],
  ["/moveplan", "nav.moveplan"],
  ["/stats", "nav.stats"],
  ["/import", "nav.import"],
  ["/export", "nav.export"],
];

// Captured by the 'beforeinstallprompt' event (Chrome/Edge/Android only -
// see the isInstallable()/isIos() helpers below for why Safari/iOS needs a
// different approach). Kept at module scope so renderNav() can check it
// after the event may have already fired before the nav was first drawn.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  renderNav();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  renderNav();
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function renderNav() {
  clear(navRoot);
  const brand = el("div", { class: "nav-brand", text: t("app.name") });
  const links = el(
    "div",
    { class: "nav-links" },
    NAV_ITEMS.map(([path, key]) =>
      el("a", { href: `#${path}`, class: "nav-link", text: t(key) })
    )
  );
  const controls = el("div", { class: "nav-controls" }, [
    el(
      "select",
      {
        class: "locale-select",
        "aria-label": "Language",
        onchange: async (e) => {
          await setLocale(e.target.value);
          renderNav();
          startRouter(appRoot);
        },
      },
      SUPPORTED_LOCALES.map((code) => {
        const opt = el("option", { value: code, text: code.toUpperCase() });
        if (code === getLocale()) opt.selected = true;
        return opt;
      })
    ),
    el("button", {
      class: "logout-btn",
      text: t("nav.logout"),
      onclick: async () => {
        await db.setMeta("token", null);
        navRoot.hidden = true;
        navigate("/login");
      },
    }),
  ]);
  if (!isStandalone() && deferredInstallPrompt) {
    controls.appendChild(
      el("button", {
        class: "install-btn",
        text: t("install.button"),
        onclick: async () => {
          deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null;
          renderNav();
        },
      })
    );
  } else if (!isStandalone() && isIos()) {
    controls.appendChild(
      el("button", {
        class: "install-btn",
        text: `\u{1F4F1} ${t("install.button")}`,
        onclick: () => showToast(t("install.ios_hint")),
      })
    );
  }
  navRoot.append(brand, links, controls);
}

function registerRoutes() {
  registerRoute("/login", renderLogin);
  registerRoute("/dashboard", renderDashboard);
  registerRoute("/cellars", renderCellars);
  registerRoute("/cellars/:id", renderCellarDetail);
  registerRoute("/bottles", renderBottles);
  registerRoute("/import", renderImport);
  registerRoute("/export", renderExport);
  registerRoute("/stats", renderStats);
  registerRoute("/moveplan", renderMovePlan);
  registerRoute("/picks", renderDailyPicks);
  registerRoute("/", renderDashboard);
}

function updateOnlineStatus() {
  if (!navigator.onLine) {
    statusBanner.textContent = t("offline.banner");
    statusBanner.hidden = false;
  } else {
    statusBanner.hidden = true;
  }
}

async function trySync() {
  if (!navigator.onLine) return;
  const before = await api.pendingOutboxCount();
  if (before === 0) return;
  statusBanner.hidden = false;
  statusBanner.textContent = t("offline.syncing");
  const { synced, stillPending } = await api.syncOutbox();
  if (stillPending === 0) {
    statusBanner.hidden = true;
    if (synced > 0) showToast(t("offline.synced"));
  } else {
    statusBanner.textContent = `${synced} synced, ${stillPending} pending`;
  }
}

async function main() {
  await initI18n();

  const token = await db.getMeta("token");
  if (!token && window.location.hash !== "#/login") {
    navigate("/login");
  }

  registerRoutes();
  navRoot.hidden = !token;
  if (token) renderNav();

  window.addEventListener("auth:expired", () => {
    navRoot.hidden = true;
    showToast(t("auth.session_expired"), { isError: true });
    navigate("/login");
  });

  window.addEventListener("online", () => {
    updateOnlineStatus();
    trySync();
  });
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  // After a successful login, login.js dispatches this so nav/router can start.
  window.addEventListener("auth:login", () => {
    navRoot.hidden = false;
    renderNav();
    navigate("/dashboard");
  });

  await startRouter(appRoot);
  trySync();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed (app still works, just without offline caching):", err);
    });
  }
}

main();
