import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, showToast, field } from "../dom.js";

function purposeLabel(cellar) {
  if (cellar.is_overflow) return t("cellar.overflow") || "Overflow";
  if (cellar.purpose_level === null || cellar.purpose_level === undefined) return "-";
  return `${cellar.purpose_level}/10`;
}

function cellarPayload(cellar, overrides = {}) {
  return {
    name: cellar.name,
    purpose_level: cellar.is_overflow ? null : cellar.purpose_level,
    is_overflow: !!cellar.is_overflow,
    max_capacity: cellar.max_capacity || 0,
    threshold: cellar.threshold || 0,
    location_rule: cellar.location_rule || null,
    layout: cellar.layout || null,
    ...overrides,
  };
}

function fieldWithHelp(labelText, control, helpText) {
  const help = el("span", { class: "field-help", text: helpText });
  const helpId = control.getAttribute("aria-describedby");
  if (helpId) help.id = helpId;
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }),
    control,
    help,
  ]);
}

function reconciliationToast(cellar) {
  if (!cellar?.reconciled_bottles) return t("common.save");
  return t("cellars.reconciled_after_save", {
    bottles: cellar.reconciled_bottles,
    holdings: cellar.reconciled_holdings,
  });
}

function cellarForm(onSubmit, existing = null) {
  const name = el("input", { type: "text", name: "name", required: true, value: existing?.name || "" });
  const purposeLevel = el("input", { type: "number", name: "purpose_level", min: 0, max: 10, value: existing?.purpose_level ?? 5 });
  const isOverflow = el("input", { type: "checkbox", name: "is_overflow" });
  isOverflow.checked = !!existing?.is_overflow;
  const maxCapacity = el("input", { type: "number", name: "max_capacity", min: 0, value: existing?.max_capacity ?? 0 });
  const threshold = el("input", { type: "number", name: "threshold", min: 0, value: existing?.threshold ?? 0 });
  const locationRule = el("input", {
    type: "text",
    name: "location_rule",
    value: existing?.location_rule || "",
    placeholder: t("cellars.location_rule_placeholder"),
    autocomplete: "off",
    "aria-describedby": "location-rule-help",
  });
  isOverflow.addEventListener("change", () => { purposeLevel.disabled = isOverflow.checked; });
  purposeLevel.disabled = isOverflow.checked;

  const errorBox = el("p", { class: "form-error", hidden: true });
  const form = el("form", { class: "entity-form" }, [
    field(t("cellars.name"), name),
    field(t("cellars.purpose_level"), purposeLevel),
    el("label", { class: "checkbox-field" }, [isOverflow, el("span", { text: t("cellars.is_overflow") })]),
    field(t("cellars.max_capacity"), maxCapacity),
    field(t("cellars.threshold"), threshold),
    fieldWithHelp(
      t("cellars.location_rule"),
      locationRule,
      t("cellars.location_rule_help"),
    ),
    errorBox,
    el("button", { type: "submit", class: "primary", text: t("common.save") }),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const payload = {
      name: name.value.trim(),
      purpose_level: isOverflow.checked ? null : Number(purposeLevel.value),
      is_overflow: isOverflow.checked,
      max_capacity: Number(maxCapacity.value),
      threshold: Number(threshold.value),
      location_rule: locationRule.value.trim() || null,
      layout: existing?.layout || null,
    };
    try {
      await onSubmit(payload);
    } catch (error) {
      errorBox.textContent = error.detail?.message || error.detail || t("common.error_generic");
      errorBox.hidden = false;
    }
  });
  return form;
}

export async function renderCellars(container) {
  container.appendChild(el("h1", { text: t("cellars.title") }));
  const unassignedHost = el("div", { class: "unassigned-holdings-host" });
  const list = el("div", { class: "cellar-list" });
  const formHost = el("div", { class: "form-host" });
  container.append(
    unassignedHost,
    list,
    el("h2", { text: t("cellars.add") }),
    formHost,
  );

  async function refreshUnassigned() {
    clear(unassignedHost);
    const summary = await api.get("/cellars/unassigned-summary").catch(() => null);
    if (!summary || !summary.bottles) return;

    const resultText = el("p", {
      text: t("cellars.unassigned_summary", {
        bottles: summary.bottles,
        holdings: summary.holdings,
      }),
    });
    const actionState = el("p", { class: "hint", text: t("cellars.unassigned_help") });
    const reconcileButton = el("button", {
      type: "button",
      class: "primary",
      text: t("cellars.reconcile"),
    });
    reconcileButton.addEventListener("click", async () => {
      reconcileButton.disabled = true;
      try {
        const result = await api.post("/cellars/reconcile-unassigned");
        showToast(
          result.assigned_bottles
            ? t("cellars.reconciled", { bottles: result.assigned_bottles })
            : t("cellars.no_reconciliation_match")
        );
        await Promise.all([refreshUnassigned(), refresh()]);
      } catch (error) {
        actionState.textContent = error.detail?.message || error.detail || t("common.error_generic");
        actionState.className = "form-error";
      } finally {
        reconcileButton.disabled = false;
      }
    });
    unassignedHost.appendChild(
      el("section", { class: "unassigned-holdings-callout" }, [
        el("h2", { text: t("cellars.unassigned_title") }),
        resultText,
        actionState,
        reconcileButton,
      ])
    );
  }

  async function refresh() {
    clear(list);
    const cellars = await api.get("/cellars");
    if (!cellars.length) {
      list.appendChild(el("p", { class: "empty-state", text: t("cellars.empty_state") }));
      return;
    }
    for (const cellar of cellars) {
      const overThreshold = cellar.threshold > 0 && cellar.current_fill > cellar.threshold;
      list.appendChild(el("div", { class: "cellar-row" }, [
        el("div", { class: "cellar-row-name", text: cellar.name }),
        el("div", { class: "cellar-row-meta", text: purposeLabel(cellar) }),
        el("div", { class: "cellar-row-fill", text: t("cellars.fill", { fill: cellar.current_fill, capacity: cellar.max_capacity || "-" }) }),
        overThreshold ? el("span", { class: "badge badge-warn", text: t("cellars.over_threshold") }) : null,
        el("a", { href: `#/cellars/${cellar.id}`, class: "button small", text: t("cellars.view") }),
      ]));
    }
  }

  function mountCreateForm() {
    clear(formHost);
    formHost.appendChild(cellarForm(async (payload) => {
      const created = await api.post("/cellars", payload);
      showToast(reconciliationToast(created));
      mountCreateForm();
      await Promise.all([refresh(), refreshUnassigned()]);
    }));
  }
  mountCreateForm();
  await Promise.all([refresh(), refreshUnassigned()]);
}

function parseLayout(cellar) {
  try {
    const value = cellar.layout ? JSON.parse(cellar.layout) : { racks: [] };
    if (!Array.isArray(value.racks)) return { racks: [] };
    return value;
  } catch {
    return { racks: [] };
  }
}

function slotCode(rack, rackIndex, slotIndex) {
  const prefix = (rack.prefix || `R${rackIndex + 1}-`).trim();
  return `${prefix}${slotIndex + 1}`;
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function renderRackSvg(rack, rackIndex, occupancy) {
  const cell = 56;
  const top = 34;
  const width = Math.max(1, rack.cols) * cell + 20;
  const height = Math.max(1, rack.rows) * cell + top + 14;
  const svg = svgNode("svg", {
    class: "rack-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${t("cellars.rack") || "Rack"} ${rackIndex + 1}`,
  });
  const title = svgNode("text", { x: 10, y: 22, class: "rack-svg-title" });
  title.textContent = `${t("cellars.rack") || "Rack"} ${rackIndex + 1} · ${rack.prefix || `R${rackIndex + 1}-`}`;
  svg.appendChild(title);

  for (let row = 0; row < rack.rows; row += 1) {
    for (let col = 0; col < rack.cols; col += 1) {
      const index = row * rack.cols + col;
      const code = slotCode(rack, rackIndex, index);
      const quantity = occupancy.get(code) || 0;
      const cx = 10 + col * cell + cell / 2;
      const cy = top + row * cell + cell / 2;
      const group = svgNode("g", { class: `rack-svg-slot ${quantity ? "occupied" : "empty"}` });
      const shape = rack.shape === "diamond"
        ? svgNode("rect", { x: cx - 18, y: cy - 18, width: 36, height: 36, rx: 4, transform: `rotate(45 ${cx} ${cy})` })
        : svgNode("circle", { cx, cy, r: 21 });
      const label = svgNode("text", { x: cx, y: cy + 4, "text-anchor": "middle" });
      label.textContent = code;
      const tooltip = svgNode("title");
      tooltip.textContent = quantity
        ? `${code}: ${quantity} ${t("common.bottles_count", { count: quantity })}`
        : `${code}: ${t("cellars.slot_empty") || "empty"}`;
      group.append(shape, label, tooltip);
      if (quantity) {
        const count = svgNode("text", { x: cx + 18, y: cy - 16, class: "rack-svg-count", "text-anchor": "middle" });
        count.textContent = String(quantity);
        group.appendChild(count);
      }
      svg.appendChild(group);
    }
  }
  return svg;
}

function renderLayoutEditor(cellar, holdings, onLayoutChange) {
  const layout = parseLayout(cellar);
  const occupancy = new Map();
  for (const holding of holdings) {
    if (holding.location) occupancy.set(holding.location, (occupancy.get(holding.location) || 0) + holding.quantity);
  }

  const preview = el("div", { class: "rack-preview rack-preview-svg" });
  const rows = el("input", { type: "number", min: 1, max: 30, value: 4, style: "width:5em" });
  const cols = el("input", { type: "number", min: 1, max: 30, value: 6, style: "width:5em" });
  const prefix = el("input", { type: "text", value: cellar.location_rule || "R1-", maxlength: 20, style: "width:7em" });
  const shape = el("select", {}, [
    el("option", { value: "grid", text: t("cellars.shape_grid") }),
    el("option", { value: "diamond", text: t("cellars.shape_diamond") }),
  ]);

  async function persist() {
    await onLayoutChange(JSON.stringify(layout));
  }

  function draw() {
    clear(preview);
    if (!layout.racks.length) {
      preview.appendChild(el("p", { class: "empty-state", text: t("cellars.layout_empty") || "Add a rack to draw the cellar." }));
      return;
    }
    layout.racks.forEach((rack, index) => {
      const card = el("section", { class: "rack-card" }, [
        renderRackSvg(rack, index, occupancy),
        el("button", {
          type: "button",
          class: "button small danger",
          text: t("cellars.remove_rack") || "Remove rack",
          onclick: async () => {
            layout.racks.splice(index, 1);
            draw();
            await persist();
          },
        }),
      ]);
      preview.appendChild(card);
    });
  }

  const addButton = el("button", {
    type: "button",
    text: t("cellars.add_rack"),
    onclick: async () => {
      const rackRows = Number(rows.value);
      const rackCols = Number(cols.value);
      if (!Number.isInteger(rackRows) || !Number.isInteger(rackCols) || rackRows < 1 || rackCols < 1) return;
      layout.racks.push({
        rows: rackRows,
        cols: rackCols,
        shape: shape.value,
        prefix: prefix.value.trim() || `R${layout.racks.length + 1}-`,
      });
      draw();
      await persist();
    },
  });

  const controls = el("div", { class: "rack-controls" }, [
    field(t("cellars.rows"), rows),
    field(t("cellars.columns"), cols),
    field(t("cellars.location_prefix") || "Location prefix", prefix),
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
  } catch {
    container.appendChild(el("p", { class: "form-error", text: t("common.error_generic") }));
    return;
  }

  const holdings = await api.get(`/holdings?cellar_id=${id}&state=in_cellar`).catch(() => []);
  container.append(
    el("a", { href: "#/cellars", class: "back-link", text: `< ${t("common.back")}` }),
    el("h1", { text: cellar.name }),
    el("p", { class: "cellar-meta", text: `${t("cellars.purpose_level")}: ${purposeLabel(cellar)} - ${t("cellars.fill", { fill: cellar.current_fill, capacity: cellar.max_capacity || "-" })}` }),
  );

  container.appendChild(el("h2", { text: t("cellars.layout") }));
  const layoutHost = el("div");
  container.appendChild(layoutHost);
  const mountEditor = () => {
    clear(layoutHost);
    layoutHost.appendChild(renderLayoutEditor(cellar, holdings, async (layoutJson) => {
      cellar = await api.put(
        `/cellars/${id}?expected_version=${cellar.version}`,
        cellarPayload(cellar, { layout: layoutJson }),
      );
      showToast(t("common.save"));
    }));
  };
  mountEditor();

  container.appendChild(el("h2", { text: t("bottles.title") }));
  const holdingsList = el("div", { class: "holding-list" });
  container.appendChild(holdingsList);
  if (!holdings.length) holdingsList.appendChild(el("p", { class: "empty-state", text: t("bottles.empty_state") }));
  for (const holding of holdings) {
    let wine;
    try { wine = await api.get(`/wines/${holding.wine_id}`); } catch { continue; }
    holdingsList.appendChild(el("div", { class: "holding-row" }, [
      el("div", { class: "holding-wine", text: `${wine.producer}${wine.cuvee ? " - " + wine.cuvee : ""}${wine.vintage ? " " + wine.vintage : ""}` }),
      el("div", { class: "holding-location", text: holding.location || "-" }),
      el("div", { class: "holding-qty", text: t("common.bottles_count", { count: holding.quantity }) }),
      holding.pending_sync ? el("span", { class: "badge badge-warn", text: t("offline.pending") || "Pending sync" }) : null,
    ]));
  }
}
