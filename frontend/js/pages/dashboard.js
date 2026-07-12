import * as api from "../api.js";
import { t } from "../i18n.js";
import { el } from "../dom.js";
import { donutChartSvg, legendHtml } from "../charts.js";

function renderEmptyCollection(colorCard) {
  colorCard.appendChild(
    el("div", { class: "dashboard-empty-chart" }, [
      el("div", { class: "dashboard-empty-icon", text: "🍷" }),
      el("p", { text: t("dashboard.no_bottles_hint") }),
    ])
  );
}

function renderCellarOverview(container, cellars) {
  container.appendChild(el("h2", { text: t("dashboard.cellars_overview") }));

  if (cellars.length === 0) {
    container.appendChild(
      el("div", { class: "dashboard-onboarding" }, [
        el("p", { class: "empty-state", text: t("dashboard.no_cellars") }),
        el("a", {
          href: "#/cellars",
          class: "button",
          text: t("dashboard.add_cellar"),
        }),
      ])
    );
    return;
  }

  const cellarList = el("div", { class: "cellar-gauges" });
  for (const cellar of cellars) {
    const pct =
      cellar.max_capacity > 0
        ? Math.min(
            100,
            Math.round((cellar.current_fill / cellar.max_capacity) * 100)
          )
        : 0;
    const overThreshold =
      cellar.threshold > 0 && cellar.current_fill > cellar.threshold;
    const gauge = el(
      "a",
      { href: `#/cellars/${cellar.id}`, class: "cellar-gauge" },
      [
        el("div", { class: "cellar-gauge-name", text: cellar.name }),
        el("div", { class: "gauge-track" }, [
          el("div", {
            class: `gauge-fill ${overThreshold ? "gauge-fill-warn" : ""}`,
            style: `width:${pct}%`,
          }),
        ]),
        el("div", {
          class: "cellar-gauge-fill-text",
          text: t("cellars.fill", {
            fill: cellar.current_fill,
            capacity: cellar.max_capacity || "-",
          }),
        }),
      ]
    );
    cellarList.appendChild(gauge);
  }
  container.appendChild(cellarList);
}

export async function renderDashboard(container) {
  container.appendChild(el("h1", { text: t("dashboard.title") }));
  const grid = el("div", { class: "card-grid" });
  container.appendChild(grid);

  let stats, cellars;
  try {
    [stats, cellars] = await Promise.all([
      api.get("/stats"),
      api.get("/cellars"),
    ]);
  } catch (err) {
    grid.appendChild(
      el("p", { class: "form-error", text: t("common.error_generic") })
    );
    return;
  }

  const overall = stats.overall;
  grid.appendChild(
    el("div", { class: "stat-card" }, [
      el("div", { class: "stat-number", text: String(overall.total_bottles) }),
      el("div", {
        class: "stat-label",
        text: t("dashboard.total_bottles"),
      }),
    ])
  );
  grid.appendChild(
    el("div", { class: "stat-card" }, [
      el("div", { class: "stat-number", text: String(overall.distinct_wines) }),
      el("div", {
        class: "stat-label",
        text: t("dashboard.distinct_wines"),
      }),
    ])
  );

  const colorCard = el("div", { class: "stat-card chart-card" });
  const colorEntries = Object.entries(overall.by_color.counts)
    .filter(([, value]) => Number(value) > 0)
    .map(([label, value]) => ({
      label: t(`color.${label}`),
      value,
    }));

  if (overall.total_bottles === 0 || colorEntries.length === 0) {
    renderEmptyCollection(colorCard);
  } else {
    colorCard.innerHTML = donutChartSvg(colorEntries) + legendHtml(colorEntries);
  }
  grid.appendChild(colorCard);

  renderCellarOverview(container, cellars);

  const [conflicts, failed] = await Promise.all([
    api.conflictCount(),
    api.failedOfflineCount(),
  ]);
  if (conflicts || failed) {
    container.appendChild(
      el("div", { class: "dashboard-onboarding sync-warning" }, [
        el("p", {
          text: t("offline.problems", { conflicts, failed }),
        }),
        el("a", {
          href: "#/sync",
          class: "button",
          text: t("offline.review_problems"),
        }),
      ])
    );
  }

  container.appendChild(el("h2", { text: t("dashboard.quick_links") }));
  container.appendChild(
    el("div", { class: "quick-links" }, [
      el("a", { href: "#/picks", class: "button", text: t("picks.title") }),
      el("a", { href: "#/import", class: "button", text: t("import.title") }),
      el("a", {
        href: "#/moveplan",
        class: "button",
        text: t("moveplan.title"),
      }),
      el("a", {
        href: "#/sync",
        class: "button",
        text: t("offline.problems_title"),
      }),
    ])
  );
}
