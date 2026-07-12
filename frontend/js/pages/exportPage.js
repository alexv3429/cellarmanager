import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, selectEl } from "../dom.js";

const ALL_COLUMNS = [
  "producer", "cuvee", "appellation", "vintage", "color", "area", "format",
  "price_bought", "quantity", "drink_after", "drink_before", "cellar", "location",
  "state", "advice_experience", "advice_pairing", "market_value",
];

export async function renderExport(container) {
  container.appendChild(el("h1", { text: t("export.title") }));

  let order = [...ALL_COLUMNS];
  const included = new Set(ALL_COLUMNS);

  const listBox = el("ul", { class: "reorder-list" });

  function draw() {
    clear(listBox);
    order.forEach((col, i) => {
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = included.has(col);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) included.add(col);
        else included.delete(col);
      });
      const upBtn = el("button", {
        type: "button", class: "icon-btn", text: "^", "aria-label": "up",
        onclick: () => {
          if (i === 0) return;
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
          draw();
        },
      });
      const downBtn = el("button", {
        type: "button", class: "icon-btn", text: "v", "aria-label": "down",
        onclick: () => {
          if (i === order.length - 1) return;
          [order[i + 1], order[i]] = [order[i], order[i + 1]];
          draw();
        },
      });
      listBox.appendChild(
        el("li", {}, [checkbox, el("span", { text: t(`bottles.${col}`) || col }), upBtn, downBtn])
      );
    });
  }
  draw();

  const cellars = await api.get("/cellars").catch(() => []);
  const cellarSelect = selectEl([{ value: "", label: t("common.all_cellars") }, ...cellars.map((c) => ({ value: c.id, label: c.name }))]);
  const languageSelect = selectEl([
    { value: "en", label: "English" },
    { value: "fr", label: "Français" },
  ]);

  const errorBox = el("p", { class: "form-error", hidden: true });
  const downloadBtn = el("button", { type: "button", class: "primary", text: t("export.download") });
  downloadBtn.addEventListener("click", async () => {
    errorBox.hidden = true;
    const columns = order.filter((c) => included.has(c));
    if (!columns.length) return;
    try {
      const csvText = await api.post("/export", { columns, language: languageSelect.value, cellar_id: cellarSelect.value || null });
      const blob = new Blob([csvText], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `cellar_export_${languageSelect.value}.csv` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      errorBox.textContent = err.detail || t("common.error_generic");
      errorBox.hidden = false;
    }
  });

  container.append(
    el("label", {}, [el("span", { text: t("export.cellar_filter") }), cellarSelect]),
    el("label", {}, [el("span", { text: t("export.language") }), languageSelect]),
    el("h2", { text: t("export.columns") }),
    listBox,
    errorBox,
    downloadBtn
  );
}
