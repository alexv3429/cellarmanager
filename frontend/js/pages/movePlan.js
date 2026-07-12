import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, showToast } from "../dom.js";

export async function renderMovePlan(container) {
  container.appendChild(el("h1", { text: t("moveplan.title") }));
  container.appendChild(el("p", { class: "hint", text: t("moveplan.intro") }));
  const host = el("div", {});
  container.appendChild(host);

  async function refresh() {
    clear(host);
    const plan = await api.get("/moveplan");

    if (plan.cellars_over_threshold.length) {
      host.appendChild(
        el("div", { class: "notice notice-warn" }, [
          el("strong", { text: t("moveplan.over_threshold") + ": " }),
          el("span", { text: plan.cellars_over_threshold.join(", ") }),
        ])
      );
    }

    if (!plan.steps.length) {
      host.appendChild(el("p", { class: "empty-state", text: t("moveplan.no_moves") }));
    }

    for (const step of plan.steps) {
      const row = el("div", { class: "moveplan-row" }, [
        el("div", { class: "moveplan-wine", text: `${step.wine_label} x${step.quantity}` }),
        el("div", { class: "moveplan-route", text: `${t("moveplan.from")}: ${step.from_cellar_name}  ->  ${t("moveplan.to")}: ${step.to_cellar_name}` }),
        el("div", { class: "moveplan-reason", text: step.reason }),
        el("button", {
          class: "small primary",
          text: t("moveplan.apply"),
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await api.mutateOrQueue("holdings/move", "/holdings/move", {
                holding_id: step.holding_id,
                quantity: step.quantity,
                to_cellar_id: step.to_cellar_id,
                to_location: null,
              });
              showToast(t("moveplan.applied"));
              await refresh();
            } catch (err) {
              e.target.disabled = false;
              showToast(err.detail || t("common.error_generic"), { isError: true });
            }
          },
        }),
      ]);
      host.appendChild(row);
    }

    if (plan.unplaceable.length) {
      host.appendChild(el("h3", { text: t("moveplan.unplaceable") }));
      host.appendChild(el("ul", {}, plan.unplaceable.map((note) => el("li", { text: note }))));
    }
  }

  await refresh();
}
