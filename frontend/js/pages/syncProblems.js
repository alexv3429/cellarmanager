import * as api from "../api.js";
import * as db from "../db.js";
import { t } from "../i18n.js";
import { el, clear, showToast } from "../dom.js";

const WORKER_MESSAGE_TIMEOUT_MS = 5000;

function humanAction(action) {
  return t(`offline.action.${action.replace("/", "_")}`) || action;
}

function formatTimestamp(value) {
  if (!value) return t("system.never");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function yesNo(value) {
  return value ? t("system.yes") : t("system.no");
}

function statusCard(label, value, hint = null) {
  const children = [
    el("span", { class: "system-status-label", text: label }),
    el("strong", { class: "system-status-value", text: String(value) }),
  ];
  if (hint) children.push(el("small", { class: "hint", text: hint }));
  return el("article", { class: "system-status-card" }, children);
}

function problemCard(kind, problem, refresh) {
  const detail = problem.conflictDetail || problem.failureDetail || {};
  const nestedDetail = detail?.detail;
  const message =
    detail?.message ||
    nestedDetail?.message ||
    (typeof nestedDetail === "string" ? nestedDetail : null) ||
    detail?.code ||
    (typeof detail === "string" ? detail : "");

  const card = el("article", { class: "sync-problem-card" }, [
    el("h3", { text: humanAction(problem.action) }),
    el("p", { text: message || t("offline.problem_unknown") }),
    el("dl", { class: "sync-problem-detail" }, [
      el("dt", { text: t("offline.queued_at") }),
      el("dd", { text: new Date(problem.createdAt).toLocaleString() }),
      el("dt", { text: t("offline.operation") }),
      el("dd", { text: problem.clientOpId }),
    ]),
    el("details", {}, [
      el("summary", { text: t("offline.show_payload") }),
      el("pre", { text: JSON.stringify(problem.payload, null, 2) }),
    ]),
  ]);

  const actions = el("div", { class: "sync-problem-actions" }, [
    el("button", {
      type: "button",
      class: "primary",
      text: t("offline.retry"),
      onclick: async () => {
        try {
          await api.retrySyncProblem(kind, problem.clientOpId);
          showToast(t("offline.retry_queued"));
          await refresh();
        } catch (error) {
          showToast(error.detail?.message || error.message || t("common.error_generic"), {
            isError: true,
          });
        }
      },
    }),
    el("button", {
      type: "button",
      class: "button danger",
      text: t("offline.discard"),
      onclick: async () => {
        if (!window.confirm(t("offline.discard_confirm"))) return;
        await api.discardSyncProblem(kind, problem.clientOpId);
        await refresh();
      },
    }),
  ]);
  card.appendChild(actions);
  return card;
}

async function fetchApiVersion() {
  try {
    const response = await fetch("/openapi.json", { cache: "no-store" });
    if (!response.ok) return t("system.unknown");
    const document = await response.json();
    return document?.info?.version || t("system.unknown");
  } catch {
    return t("system.unavailable");
  }
}

function postWorkerMessage(worker, type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error(t("system.worker_unavailable")));
      return;
    }

    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error(t("system.worker_timeout")));
    }, WORKER_MESSAGE_TIMEOUT_MS);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      const response = event.data || {};
      if (response.ok === false) {
        reject(new Error(response.error || t("common.error_generic")));
      } else {
        resolve(response);
      }
    };

    worker.postMessage({ type, ...payload }, [channel.port2]);
  });
}

async function serviceWorkerStatus() {
  if (!("serviceWorker" in navigator)) {
    return {
      supported: false,
      registered: false,
      controlled: false,
      state: t("system.not_supported"),
      cacheName: t("system.unavailable"),
      appShellCount: 0,
      updateWaiting: false,
    };
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    return {
      supported: true,
      registered: false,
      controlled: false,
      state: t("system.not_registered"),
      cacheName: t("system.unavailable"),
      appShellCount: 0,
      updateWaiting: false,
    };
  }

  const worker = navigator.serviceWorker.controller || registration.active;
  let details = {};
  try {
    details = await postWorkerMessage(worker, "GET_STATUS");
  } catch {
    details = {};
  }

  return {
    supported: true,
    registered: true,
    controlled: Boolean(navigator.serviceWorker.controller),
    state:
      registration.waiting?.state ||
      registration.installing?.state ||
      registration.active?.state ||
      t("system.unknown"),
    cacheName: details.cacheName || t("system.unknown"),
    appShellCount: details.appShellCount || 0,
    updateWaiting: Boolean(registration.waiting),
    registration,
  };
}

async function collectStatus() {
  const [apiVersion, pending, conflicts, failed, lastSync, lastAttempt, lastRefresh, worker] =
    await Promise.all([
      fetchApiVersion(),
      api.pendingOutboxCount(),
      api.conflictCount(),
      api.failedOfflineCount(),
      db.getMeta("last_sync_at"),
      db.getMeta("last_sync_attempt_at"),
      db.getMeta("last_refresh_at"),
      serviceWorkerStatus(),
    ]);

  return {
    apiVersion,
    pending,
    conflicts,
    failed,
    lastSync,
    lastAttempt,
    lastRefresh,
    worker,
    online: navigator.onLine,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true,
  };
}

function renderStatusCards(host, status) {
  clear(host);
  host.append(
    statusCard(t("system.api_version"), status.apiVersion),
    statusCard(t("system.frontend_cache"), status.worker.cacheName),
    statusCard(t("system.worker_state"), status.worker.state),
    statusCard(t("system.worker_controlled"), yesNo(status.worker.controlled)),
    statusCard(t("system.online"), yesNo(status.online)),
    statusCard(t("system.installed_app"), yesNo(status.standalone)),
    statusCard(t("system.pending_changes"), status.pending),
    statusCard(t("system.conflicts"), status.conflicts),
    statusCard(t("system.failed_changes"), status.failed),
    statusCard(t("system.last_successful_sync"), formatTimestamp(status.lastSync)),
    statusCard(t("system.last_sync_attempt"), formatTimestamp(status.lastAttempt)),
    statusCard(t("system.last_force_refresh"), formatTimestamp(status.lastRefresh)),
  );

  if (status.worker.updateWaiting) {
    host.appendChild(
      el("p", { class: "system-update-ready", text: t("system.update_waiting") }),
    );
  }
}

async function refreshServerData() {
  await Promise.all([api.get("/wines"), api.get("/cellars"), api.get("/holdings")]);
}

async function syncNow() {
  if (!navigator.onLine) throw new Error(t("system.sync_requires_online"));

  const attemptedAt = new Date().toISOString();
  await db.setMeta("last_sync_attempt_at", attemptedAt);
  const result = await api.syncOutbox();
  await refreshServerData();

  if (!result.conflicts && !result.failed && result.stillPending === 0) {
    await db.setMeta("last_sync_at", new Date().toISOString());
  }
  window.dispatchEvent(new CustomEvent("sync:completed", { detail: result }));
  return result;
}

function waitForControllerChange(timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

async function checkForUpdate() {
  if (!("serviceWorker" in navigator)) {
    throw new Error(t("system.worker_unavailable"));
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) throw new Error(t("system.worker_unavailable"));
  await registration.update();
  return Boolean(registration.waiting || registration.installing);
}

async function forceRefresh() {
  if (!navigator.onLine) throw new Error(t("system.refresh_requires_online"));

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update();
      if (registration.waiting) {
        const changed = waitForControllerChange();
        await postWorkerMessage(registration.waiting, "SKIP_WAITING");
        await changed;
      }

      const worker = navigator.serviceWorker.controller || registration.active;
      if (worker) await postWorkerMessage(worker, "REFRESH_APP_SHELL");
    }
  } else if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("winecellar-shell-")).map((key) => caches.delete(key)),
    );
  }

  await db.setMeta("last_refresh_at", new Date().toISOString());
  window.location.reload();
}

export async function renderSyncProblems(container) {
  container.appendChild(el("h1", { text: t("system.title") }));
  container.appendChild(el("p", { class: "page-intro", text: t("system.intro") }));

  const statusHost = el("div", { class: "system-status-grid" }, [
    el("p", { class: "loading", text: t("common.loading") }),
  ]);
  container.appendChild(statusHost);

  const refreshStatus = async () => {
    try {
      renderStatusCards(statusHost, await collectStatus());
    } catch (error) {
      clear(statusHost);
      statusHost.appendChild(
        el("p", {
          class: "form-error",
          text: error.message || t("common.error_generic"),
        }),
      );
    }
  };

  const actions = el("div", { class: "system-status-actions" });
  const updateButton = el("button", {
    type: "button",
    text: t("system.check_update"),
  });
  const syncButton = el("button", {
    type: "button",
    class: "primary",
    text: t("system.sync_now"),
  });
  const refreshButton = el("button", {
    type: "button",
    class: "button danger",
    text: t("system.force_refresh"),
  });
  actions.append(updateButton, syncButton, refreshButton);
  container.appendChild(actions);

  updateButton.addEventListener("click", async () => {
    updateButton.disabled = true;
    try {
      const found = await checkForUpdate();
      showToast(t(found ? "system.update_found" : "system.no_update"));
      await refreshStatus();
    } catch (error) {
      showToast(error.message || t("common.error_generic"), { isError: true });
    } finally {
      updateButton.disabled = false;
    }
  });

  syncButton.addEventListener("click", async () => {
    syncButton.disabled = true;
    try {
      const result = await syncNow();
      if (result.conflicts || result.failed || result.stillPending) {
        showToast(
          t("system.sync_with_problems", {
            pending: result.stillPending,
            conflicts: result.conflicts,
            failed: result.failed,
          }),
          { isError: true },
        );
      } else {
        showToast(t("system.sync_complete", { count: result.synced }));
      }
      await Promise.all([refreshStatus(), refreshProblems()]);
    } catch (error) {
      showToast(error.message || t("common.error_generic"), { isError: true });
    } finally {
      syncButton.disabled = false;
    }
  });

  refreshButton.addEventListener("click", async () => {
    if (!window.confirm(t("system.force_refresh_confirm"))) return;
    refreshButton.disabled = true;
    try {
      await forceRefresh();
    } catch (error) {
      refreshButton.disabled = false;
      showToast(error.message || t("common.error_generic"), { isError: true });
    }
  });

  container.appendChild(el("h2", { text: t("offline.problems_title") }));
  container.appendChild(el("p", { class: "page-intro", text: t("offline.problems_intro") }));
  const problemsHost = el("div", { class: "sync-problems" });
  container.appendChild(problemsHost);

  async function refreshProblems() {
    clear(problemsHost);
    const { conflicts, failed } = await api.listSyncProblems();
    if (!conflicts.length && !failed.length) {
      problemsHost.appendChild(el("p", { class: "empty-state", text: t("offline.no_problems") }));
      return;
    }
    if (conflicts.length) {
      problemsHost.appendChild(el("h3", { text: t("offline.conflicts") }));
      for (const problem of conflicts) {
        problemsHost.appendChild(problemCard("conflict", problem, refreshProblems));
      }
    }
    if (failed.length) {
      problemsHost.appendChild(el("h3", { text: t("offline.failed_changes") }));
      for (const problem of failed) {
        problemsHost.appendChild(problemCard("failed", problem, refreshProblems));
      }
    }
  }

  await Promise.all([refreshStatus(), refreshProblems()]);
}
