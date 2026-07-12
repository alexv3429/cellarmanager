import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, showToast } from "../dom.js";

function humanAction(action) {
  return t(`offline.action.${action.replace("/", "_")}`) || action;
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
          showToast(error.detail?.message || error.message || t("common.error_generic"), { isError: true });
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

export async function renderSyncProblems(container) {
  container.appendChild(el("h1", { text: t("offline.problems_title") }));
  container.appendChild(el("p", { class: "page-intro", text: t("offline.problems_intro") }));
  const host = el("div", { class: "sync-problems" });
  container.appendChild(host);

  async function refresh() {
    clear(host);
    const { conflicts, failed } = await api.listSyncProblems();
    if (!conflicts.length && !failed.length) {
      host.appendChild(el("p", { class: "empty-state", text: t("offline.no_problems") }));
      return;
    }
    if (conflicts.length) {
      host.appendChild(el("h2", { text: t("offline.conflicts") }));
      for (const problem of conflicts) host.appendChild(problemCard("conflict", problem, refresh));
    }
    if (failed.length) {
      host.appendChild(el("h2", { text: t("offline.failed_changes") }));
      for (const problem of failed) host.appendChild(problemCard("failed", problem, refresh));
    }
  }
  await refresh();
}
