import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, selectEl } from "../dom.js";
import { barChartSvg, donutChartSvg, legendHtml } from "../charts.js";
import { formatCurrencyTotals } from "./statsFormatting.js";

function breakdownBlock(titleKey, breakdown, labelFn = (k) => k) {
  const entries = Object.entries(breakdown.counts)
    .map(([label, value]) => ({ label: labelFn(label), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const block = el("div", { class: "stat-block" }, [el("h3", { text: t(titleKey) })]);
  const chart = el("div", { class: "chart-wrap" });
  chart.innerHTML = barChartSvg(entries);
  block.appendChild(chart);
  return block;
}

function statCard(value, label) {
  return el("div", { class: "stat-card" }, [
    el("div", { class: "stat-number", text: value }),
    el("div", { class: "stat-label", text: label }),
  ]);
}

function statsSection(stats) {
  const section = el("div", { class: "stats-section" });
  const valued = Number(stats.market_value_bottles || 0);
  const missing = Number(stats.market_value_missing_bottles || 0);
  const coverageTotal = valued + missing;
  const coverage = coverageTotal ? `${valued}/${coverageTotal}` : "0/0";
  section.append(
    el("div", { class: "card-grid" }, [
      statCard(String(stats.total_bottles), t("stats.total_bottles")),
      statCard(String(stats.distinct_wines), t("stats.distinct_wines")),
      statCard(Number(stats.total_value_bought || 0).toFixed(2), t("stats.value_bought")),
      statCard(
        formatCurrencyTotals(stats.market_value_by_currency, {
          fallbackValue: stats.total_value_market,
          fallbackCurrency: stats.market_value_currency,
          unknownLabel: t("stats.currency_unknown"),
          emptyLabel: t("common.none"),
        }),
        t("stats.value_market"),
      ),
      statCard(
        formatCurrencyTotals(stats.quick_sale_value_by_currency, {
          unknownLabel: t("stats.currency_unknown"),
          emptyLabel: t("common.none"),
        }),
        t("stats.value_quick_sale"),
      ),
      statCard(coverage, t("stats.market_coverage")),
    ]),
  );
  const drinkWindow = stats.drink_window;
  const dwEntries = [
    { label: t("stats.overdue"), value: drinkWindow.overdue },
    { label: t("stats.ready_now"), value: drinkWindow.ready_now },
    { label: t("stats.not_ready_yet"), value: drinkWindow.not_ready_yet },
    { label: t("stats.no_date_info"), value: drinkWindow.no_date_info },
  ];
  const dwCard = el("div", { class: "stat-block" }, [
    el("h3", { text: t("stats.drink_window") }),
  ]);
  const dwChart = el("div", { class: "chart-wrap chart-with-legend" });
  dwChart.innerHTML = donutChartSvg(dwEntries) + legendHtml(dwEntries);
  dwCard.appendChild(dwChart);
  section.appendChild(dwCard);
  section.appendChild(
    breakdownBlock("stats.by_color", stats.by_color, (c) => t(`color.${c}`) || c),
  );
  section.appendChild(breakdownBlock("stats.by_vintage", stats.by_vintage));
  section.appendChild(breakdownBlock("stats.by_area", stats.by_area));
  section.appendChild(breakdownBlock("stats.by_appellation", stats.by_appellation));
  return section;
}

export async function renderStats(container) {
  container.appendChild(el("h1", { text: t("stats.title") }));
  const cellars = await api.get("/cellars").catch(() => []);
  const cellarSelect = selectEl([
    { value: "", label: t("stats.overall") },
    ...cellars.map((c) => ({ value: c.id, label: c.name })),
  ]);
  container.appendChild(
    el("label", {}, [el("span", { text: t("common.all_cellars") }), cellarSelect]),
  );
  const host = el("div", {});
  container.appendChild(host);
  async function refresh() {
    host.innerHTML = "";
    if (cellarSelect.value) {
      const stats = await api.get(`/stats?cellar_id=${cellarSelect.value}`);
      host.appendChild(statsSection(stats));
    } else {
      const data = await api.get("/stats");
      host.appendChild(statsSection(data.overall));
    }
  }
  cellarSelect.addEventListener("change", refresh);
  await refresh();
}
