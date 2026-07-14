import * as api from "../api.js";
import { clear, el, field, selectEl } from "../dom.js";
import { t } from "../i18n.js";
import { apiErrorMessage } from "./enrichmentResearch.js";

const COLORS = [
  "red",
  "white",
  "rose",
  "sparkling",
  "orange",
  "fortified",
  "other",
];

const OCCASIONS = [
  "casual",
  "everyday",
  "important",
  "celebration",
  "discovery",
];

function diagnosticsView(diagnostics) {
  if (!diagnostics || diagnostics.examined == null) return null;
  const reasons = [
    "inactive",
    "cellar",
    "color",
    "vintage",
    "appellation",
    "drinking_window",
    "strict_dish",
  ]
    .map((reason) => ({
      reason,
      count: Number(diagnostics[`rejected_${reason}`] || 0),
    }))
    .filter((item) => item.count > 0);

  return el("details", { class: "recommendation-diagnostics" }, [
    el("summary", {
      text: t("picks.diagnostics_summary", {
        examined: diagnostics.examined,
        eligible: diagnostics.eligible || 0,
      }),
    }),
    reasons.length
      ? el(
          "ul",
          {},
          reasons.map((item) =>
            el("li", {
              text: t(`picks.rejected_${item.reason}`, { count: item.count }),
            })
          )
        )
      : el("p", { class: "hint", text: t("picks.no_rejection_detail") }),
  ]);
}

export async function renderDailyPicks(container) {
  container.appendChild(el("h1", { text: t("picks.title") }));
  container.appendChild(
    el("p", {
      class: "hint",
      text: t("picks.ranking_hint"),
    })
  );

  const cellars = await api.get("/cellars").catch(() => []);
  const cellarSelect = selectEl([
    { value: "", label: t("common.all_cellars") },
    ...cellars.map((cellar) => ({ value: cellar.id, label: cellar.name })),
  ]);
  const colorSelect = selectEl([
    { value: "", label: t("common.none") },
    ...COLORS.map((color) => ({ value: color, label: t(`color.${color}`) })),
  ]);
  const dishInput = el("input", {
    type: "text",
    placeholder: t("picks.dish_placeholder"),
  });
  const occasionSelect = selectEl([
    { value: "", label: t("picks.occasion_none") },
    ...OCCASIONS.map((occasion) => ({
      value: occasion,
      label: t(`picks.occasion_${occasion}`),
    })),
  ]);
  const strictDishInput = el("input", { type: "checkbox" });
  const strictDishRow = el("label", { class: "checkbox-row" }, [
    strictDishInput,
    el("span", { text: t("picks.strict_dish") }),
  ]);
  const appellationInput = el("input", { type: "text" });
  const vintageInput = el("input", { type: "number" });
  const searchBtn = el("button", {
    type: "submit",
    class: "primary",
    text: t("picks.search"),
  });

  const form = el("form", { class: "entity-form picks-form" }, [
    field(t("picks.cellar"), cellarSelect),
    field(t("picks.color"), colorSelect),
    field(t("picks.dish"), dishInput),
    field(t("picks.mood"), occasionSelect),
    strictDishRow,
    field(t("picks.appellation"), appellationInput),
    field(t("picks.vintage"), vintageInput),
    searchBtn,
  ]);
  container.appendChild(form);

  const results = el("div", { class: "picks-results" });
  container.appendChild(results);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clear(results);
    results.appendChild(el("p", { text: t("picks.searching") }));

    const payload = {
      cellar_id: cellarSelect.value || null,
      color: colorSelect.value || null,
      dish: dishInput.value.trim() || null,
      mood: occasionSelect.value || null,
      strict_text_match: strictDishInput.checked,
      appellation: appellationInput.value.trim() || null,
      vintage: vintageInput.value ? Number(vintageInput.value) : null,
      limit: 20,
    };

    let recommendations;
    let diagnostics = null;
    try {
      const response = await api.post("/recommendations?explain=true", payload);
      recommendations = response.recommendations || response;
      diagnostics = response.diagnostics || null;
    } catch (error) {
      clear(results);
      results.appendChild(
        el("p", { class: "form-error", text: apiErrorMessage(error) })
      );
      return;
    }

    clear(results);
    if (!recommendations.length) {
      results.appendChild(
        el("p", { class: "empty-state", text: t("picks.empty_state") })
      );
      results.appendChild(
        el("p", { class: "hint", text: t("picks.empty_hint") })
      );
      const details = diagnosticsView(diagnostics);
      if (details) results.appendChild(details);
      return;
    }

    results.appendChild(el("h2", { text: t("picks.results") }));
    for (const recommendation of recommendations) {
      const wine = recommendation.wine;
      const metadata = [wine.appellation, wine.area]
        .filter(Boolean)
        .join(" - ");
      const facts = [];
      if (wine.drink_after || wine.drink_before) {
        facts.push(
          t("picks.window", {
            after: wine.drink_after || "?",
            before: wine.drink_before || "?",
          })
        );
      }
      if (wine.market_value != null) {
        facts.push(t("picks.value", { value: wine.market_value }));
      }
      results.appendChild(
        el("div", { class: "pick-card" }, [
          el("div", {
            class: "wine-title",
            text: `${wine.producer}${wine.cuvee ? ` - ${wine.cuvee}` : ""}${wine.vintage ? ` ${wine.vintage}` : ""}`,
          }),
          el("div", { class: "wine-sub", text: metadata }),
          facts.length
            ? el("div", { class: "pick-facts", text: facts.join(" · ") })
            : null,
          el("div", {
            class: "pick-qty",
            text: t("common.bottles_count", {
              count: recommendation.quantity,
            }),
          }),
          el("div", {
            class: "pick-reasons",
            text: `${t("picks.why")}: ${recommendation.reasons.join("; ")}`,
          }),
        ].filter(Boolean))
      );
    }
  });
}
