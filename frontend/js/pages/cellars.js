import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, showToast, field } from "../dom.js";

function purposeLabel(cellar) {
  if (cellar.is_overflow) return t("cellar.overflow") || "Overflow";
  if (cellar.purpose_level === null || cellar.purpose_level === undefined) return "-";
  return `${cellar.purpose_level}/10`;
}

function cellarForm(onSubmit, existing = null) {
  const name = el("input", { type: "text", name: "name", required: true, value: existing?.name || "" });
  const purposeLevel = el("input", { type: "number", name: "purpose_level", min: 0, max: 10, value: existing?.purpose_level ?? 5 });
  const isOverflow = el("input", { type: "checkbox", name: "is_overflow" });
  isOverflow.checked = !!existing?.is_overflow;
  const maxCapacity = el("input", { type: "number", name: "max_capacity", min: 0, value: existing?.max_capacity ?? 0 });
  const threshold = el("input", { type: "number", name: "threshold", min: 0, value: existing?.threshold ?? 0 });
  const locationRule = el("input", { type: "text", name: "location_rule", value: existing?.location_rule || "" });

  isOverflow.addEventListener("change", () => {
    purposeLevel.disabled = isOverflow.checked;
  });
  purposeLevel.disabled = isOverflow.checked;

  const errorBox = el("p", { class: "form-error", hidden: true });
  const form = el("form", { class: "entity-form" }, [
    field(t("cellars.name"), name),
    field(t("cellars.purpose_level"), purposeLevel),
    el("label", { class: "checkbox-field" }, [isOverflow, el("span", { text: t("cellars.is_overflow") })]),
    field(t("cellars.max_capacity"), maxCapacity),
    field(t("cellars.threshold"), threshold),
    field(t("cellars.location_rule"), locationRule),
    errorBox,
    el("button", { type: "submit", class: "primary", text: t("common.save") }),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const payload = {
      name: name.value.trim(),
      purpose_level: isOverflow.checked ? null : Number(purposeLevel.value),
      is_overflow: isOverflow.checked,
      max_capacity: Number(maxCapacity.value),
      threshold: Number(threshold.value),
      location_rule: locationRule.value.trim() || null,
    };
    try {
      await onSubmit(payload);
    } catch (err) {
      errorBox.textContent = err.detail || t("common.error_generic");
      errorBox.hidden = false;
    }
  });
  return form;
}

export async function renderCellars(container) {
  container.appendChild(el("h1", { text: t("cellars.title") }));
  const list = el("div", { class: "cellar-list" });
  const formHost = el("div", { class: "form-host" });
  container.append(list, el("h2", { text: t("cellars.add") }), formHost);

  async function refresh() {
    clear(list);
    const cellars = await api.get("/cellars");
    if (!cellars.length) {
      list.appendChild(el("p", { class: "empty-state", text: t("cellars.empty_state") }));
      return;
    }
    for (const cellar of cellars) {
      const overThreshold = cellar.threshold > 0 && cellar.current_fill > cellar.threshold;
      list.appendChild(
        el("div", { class: "cellar-row" }, [
          el("div", { class: "cellar-row-name", text: cellar.name }),
          el("div", { class: "cellar-row-meta", text: purposeLabel(cellar) }),
          el("div", { class: "cellar-row-fill", text: t("cellars.fill", { fill: cellar.current_fill, capacity: cellar.max_capacity || "-" }) }),
          overThreshold ? el("span", { class: "badge badge-warn", text: t("cellars.over_threshold") }) : null,
          el("a", { href: `#/cellars/${cellar.id}`, class: "button small", text: t("cellars.view") }),
        ])
      );
    }
  }

  function mountCreateForm() {
    clear(formHost);
    formHost.appendChild(
      cellarForm(async (payload) => {
        await api.post("/cellars", payload);
        showToast(t("common.save"));
        mountCreateForm();
        await refresh();
      })
    );
  }

  mountCreateForm();
  await refresh();
}

const SHAPE_LABELS = { grid: "cellars.shape_grid", diamond: "cellars.shape_diamond" };

function renderLayoutEditor(cellar, onLayoutChange) {
  let layout = { racks: [] };
  try {
    layout = cellar.layout ? JSON.parse(cellar.layout) : { racks: [] };
  } catch {
    layout = { racks: [] };
  }

  const preview = el("div", { class: "rack-preview" });
  const rows = el("input", { type: "number", min: 1, value: 4, style: "width:4em" });
  const cols = el("input", { type: "number", min: 1, value: 6, style: "width:4em" });
  const shape = el("select", {}, [
    el("option", { value: "grid", text: t("cellars.shape_grid") }),
    el("option", { value: "diamond", text: t("cellars.shape_diamond") }),
  ]);

  function draw() {
    clear(preview);
    for (const rack of layout.racks) {
      const rackEl = el("div", {
        class: `rack rack-${rack.shape}`,
        style: `grid-template-columns: repeat(${rack.cols}, 1fr); grid-template-rows: repeat(${rack.rows}, 1fr);`,
      });
      for (let i = 0; i < rack.rows * rack.cols; i++) {
        rackEl.appendChild(el("div", { class: "rack-slot" }));
      }
      preview.appendChild(rackEl);
    }
  }

  const addButton = el("button", {
    type: "button",
    text: t("cellars.add_rack"),
    onclick: async () => {
      layout.racks.push({ rows: Number(rows.value), cols: Number(cols.value), shape: shape.value });
      draw();
      await onLayoutChange(JSON.stringify(layout));
    },
  });

  const controls = el("div", { class: "rack-controls" }, [
    field(t("cellars.rows"), rows),
    field(t("cellars.columns"), cols),
    field(t("cellars.shape"), shape),
    addButton,
  ]);

  draw();
  return el("div", { class: "layout-editor" }, [controls, preview]);
}

export async function renderCellarDetail(container, { id }) {
  let cellar;
  try {
    cellar = await api.get(`/cellars/${id}`);
  } catch (err) {
    container.appendChild(el("p", { class: "form-error", text: t("common.error_generic") }));
    return;
  }

  container.append(
    el("a", { href: "#/cellars", class: "back-link", text: `< ${t("common.back")}` }),
    el("h1", { text: cellar.name }),
    el("p", { class: "cellar-meta", text: `${t("cellars.purpose_level")}: ${purposeLabel(cellar)} - ${t("cellars.fill", { fill: cellar.current_fill, capacity: cellar.max_capacity || "-" })}` })
  );

  container.appendChild(el("h2", { text: t("cellars.layout") }));
  container.appendChild(
    renderLayoutEditor(cellar, async (layoutJson) => {
      await api.put(`/cellars/${id}?expected_version=${cellar.version || 1}`, { ...cellar, layout: layoutJson });
    })
  );

  container.appendChild(el("h2", { text: t("bottles.title") }));
  const holdingsList = el("div", { class: "holding-list" });
  container.appendChild(holdingsList);
  const holdings = await api.get(`/holdings?cellar_id=${id}&state=in_cellar`);
  if (!holdings.length) {
    holdingsList.appendChild(el("p", { class: "empty-state", text: t("bottles.empty_state") }));
  }
  for (const holding of holdings) {
    let wine;
    try {
      wine = await api.get(`/wines/${holding.wine_id}`);
    } catch {
      continue;
    }
    holdingsList.appendChild(
      el("div", { class: "holding-row" }, [
        el("div", { class: "holding-wine", text: `${wine.producer}${wine.cuvee ? " - " + wine.cuvee : ""}${wine.vintage ? " " + wine.vintage : ""}` }),
        el("div", { class: "holding-location", text: holding.location || "-" }),
        el("div", { class: "holding-qty", text: t("common.bottles_count", { count: holding.quantity }) }),
      ])
    );
  }
}
