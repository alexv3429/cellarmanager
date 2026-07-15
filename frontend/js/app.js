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
import { renderSyncProblems } from "./pages/syncProblems.js";

const appRoot = document.getElementById("app");
const navRoot = document.getElementById("nav");
const statusBanner = document.getElementById("status-banner");
const footerAppName = document.getElementById("footer-app-name");
const NAV_ITEMS = [
  ["/dashboard", "nav.dashboard"],
  ["/cellars", "nav.cellars"],
  ["/bottles", "nav.bottles"],
  ["/picks", "nav.picks"],
  ["/moveplan", "nav.moveplan"],
  ["/stats", "nav.stats"],
  ["/import", "nav.import"],
  ["/export", "nav.export"],
  ["/sync", "nav.sync"],
];

let deferredInstallPrompt = null;

function updateStaticTranslations() {
  document.title = t("app.name");
  if (footerAppName) footerAppName.textContent = t("app.name");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
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
  updateStaticTranslations();
  clear(navRoot);
  const brand = el("div", { class: "nav-brand", text: t("app.name") });
  const links = el("div", { class: "nav-links" }, NAV_ITEMS.map(([path, key]) =>
    el("a", { href: `#${path}`, class: "nav-link", text: t(key) }),
  ));
  const controls = el("div", { class: "nav-controls" }, [
    el("select", {
      class: "locale-select",
      "aria-label": "Language",
      onchange: async (event) => {
        await setLocale(event.target.value);
        renderNav();
        startRouter(appRoot);
      },
    }, SUPPORTED_LOCALES.map((code) => {
      const option = el("option", { value: code, text: code.toUpperCase() });
      if (code === getLocale()) option.selected = true;
      return option;
    })),
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
    controls.appendChild(el("button", {
      class: "install-btn",
      text: t("install.button"),
      onclick: async () => {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        renderNav();
      },
    }));
  } else if (!isStandalone() && isIos()) {
    controls.appendChild(el("button", {
      class: "install-btn",
      text: `📱 ${t("install.button")}`,
      onclick: () => showToast(t("install.ios_hint")),
    }));
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
  registerRoute("/sync", renderSyncProblems);
  registerRoute("/", renderDashboard);
}

async function showStoredSyncProblems() {
  const [conflicts, failed] = await Promise.all([
    api.conflictCount(),
    api.failedOfflineCount(),
  ]);
  if (conflicts || failed) {
    statusBanner.hidden = false;
    statusBanner.textContent = t("offline.problems", { conflicts, failed });
    statusBanner.classList.add("status-error");
    return true;
  }
  statusBanner.classList.remove("status-error");
  return false;
}

async function updateOnlineStatus() {
  if (!navigator.onLine) {
    statusBanner.textContent = t("offline.banner");
    statusBanner.hidden = false;
    statusBanner.classList.remove("status-error");
  } else if (!(await showStoredSyncProblems())) {
    statusBanner.hidden = true;
  }
}

async function trySync() {
  if (!navigator.onLine) return;

  const attemptedAt = new Date().toISOString();
  await db.setMeta("last_sync_attempt_at", attemptedAt).catch(() => {});
  const before = await api.pendingOutboxCount();

  if (before === 0) {
    await db.setMeta("last_sync_at", attemptedAt).catch(() => {});
    await showStoredSyncProblems();
    window.dispatchEvent(
      new CustomEvent("sync:completed", {
        detail: { synced: 0, stillPending: 0, conflicts: 0, failed: 0 },
      }),
    );
    return;
  }

  statusBanner.hidden = false;
  statusBanner.classList.remove("status-error");
  statusBanner.textContent = t("offline.syncing");
  const result = await api.syncOutbox();
  const { synced, stillPending, conflicts, failed } = result;

  if (!conflicts && !failed && stillPending === 0) {
    await db.setMeta("last_sync_at", new Date().toISOString()).catch(() => {});
  }
  window.dispatchEvent(new CustomEvent("sync:completed", { detail: result }));

  if (conflicts || failed) {
    statusBanner.classList.add("status-error");
    statusBanner.textContent = t("offline.sync_result_problems", {
      synced,
      pending: stillPending,
      conflicts,
      failed,
    });
  } else if (stillPending === 0) {
    statusBanner.hidden = true;
    if (synced > 0) showToast(t("offline.synced"));
  } else {
    statusBanner.textContent = t("offline.sync_result", {
      synced,
      pending: stillPending,
    });
  }
}

async function main() {
  await initI18n();
  updateStaticTranslations();
  const token = await db.getMeta("token");
  if (!token && window.location.hash !== "#/login") navigate("/login");
  registerRoutes();
  navRoot.hidden = !token;
  if (token) renderNav();

  window.addEventListener("auth:expired", () => {
    navRoot.hidden = true;
    showToast(t("auth.session_expired"), { isError: true });
    navigate("/login");
  });
  window.addEventListener("online", () => { updateOnlineStatus(); trySync(); });
  window.addEventListener("offline", updateOnlineStatus);
  window.addEventListener("offline:cache-used", () => {
    if (!navigator.onLine) updateOnlineStatus();
  });
  window.addEventListener("auth:login", () => {
    navRoot.hidden = false;
    renderNav();
    navigate("/dashboard");
  });

  await updateOnlineStatus();
  await startRouter(appRoot);
  trySync();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").then((registration) => {
      registration.update().catch(() => {});
    }).catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  }
}

main();
