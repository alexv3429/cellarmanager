import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, selectEl, field } from "../dom.js";

const COLORS = ["red", "white", "rose", "sparkling", "orange", "fortified", "other"];

export async function renderDailyPicks(container) {
  container.appendChild(el("h1", { text: t("picks.title") }));

  const cellars = await api.get("/cellars").catch(() => []);
  const cellarSelect = selectEl([{ value: "", label: t("common.all_cellars") }, ...cellars.map((c) => ({ value: c.id, label: c.name }))]);
  const colorSelect = selectEl([{ value: "", label: t("common.none") }, ...COLORS.map((c) => ({ value: c, label: t(`color.${c}`) }))]);
  const dishInput = el("input", { type: "text", placeholder: "e.g. grilled steak" });
  const moodInput = el("input", { type: "text", placeholder: "e.g. celebration, casual dinner" });
  const appellationInput = el("input", { type: "text" });
  const vintageInput = el("input", { type: "number" });

  const searchBtn = el("button", { type: "submit", class: "primary", text: t("picks.search") });
  const form = el("form", { class: "entity-form picks-form" }, [
    field(t("picks.cellar"), cellarSelect),
    field(t("picks.color"), colorSelect),
    field(t("picks.dish"), dishInput),
    field(t("picks.mood"), moodInput),
    field(t("picks.appellation"), appellationInput),
    field(t("picks.vintage"), vintageInput),
    searchBtn,
  ]);
  container.appendChild(form);

  const results = el("div", { class: "picks-results" });
  container.appendChild(results);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clear(results);
    const payload = {
      cellar_id: cellarSelect.value || null,
      color: colorSelect.value || null,
      dish: dishInput.value.trim() || null,
      mood: moodInput.value.trim() || null,
      strict_text_match: Boolean(dishInput.value.trim() || moodInput.value.trim()), appellation: appellationInput.value.trim() || null,
      vintage: vintageInput.value ? Number(vintageInput.value) : null,
      limit: 20,
    };
    let recs;
    try {
      recs = await api.post("/recommendations", payload);
    } catch (err) {
      results.appendChild(el("p", { class: "form-error", text: t("common.error_generic") }));
      return;
    }
    if (!recs.length) {
      results.appendChild(el("p", { class: "empty-state", text: t("picks.empty_state") }));
      return;
    }
    results.appendChild(el("h2", { text: t("picks.results") }));
    for (const rec of recs) {
      const wine = rec.wine;
      results.appendChild(
        el("div", { class: "pick-card" }, [
          el("div", { class: "wine-title", text: `${wine.producer}${wine.cuvee ? " - " + wine.cuvee : ""}${wine.vintage ? " " + wine.vintage : ""}` }),
          el("div", { class: "wine-sub", text: [wine.appellation, wine.area].filter(Boolean).join(" - ") }),
          el("div", { class: "pick-qty", text: t("common.bottles_count", { count: rec.quantity }) }),
          el("div", { class: "pick-reasons", text: `${t("picks.why")}: ${rec.reasons.join("; ")}` }),
        ])
      );
    }
  });
}
