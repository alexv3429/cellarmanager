import { attachLocationBottleClick } from "./cellarLocationBottles.js";
import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, showToast, field } from "../dom.js";
import {
  buildLocationGrid,
  buildLocationRule,
  defaultLocationScheme,
  generateLocations,
  layoutWithScheme,
  normalizeLocationScheme,
  parseCellarLayout,
  schemeFromCellar,
} from "../locationScheme.js";

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
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }),
    control,
    el("span", { class: "field-help", text: helpText }),
  ]);
}

function reconciliationToast(cellar) {
  if (!cellar?.reconciled_bottles) return t("common.save");
  return t("cellars.reconciled_after_save", {
    bottles: cellar.reconciled_bottles,
    holdings: cellar.reconciled_holdings,
  });
}

function schemeErrorMessage(error) {
  const key = `cellars.scheme_error_${error?.message || "generic"}`;
  const message = t(key);
  return message === key ? t("cellars.scheme_error_generic") : message;
}

function option(value, key) {
  return el("option", { value, text: t(key) });
}

function textArea(value = "", rows = 3) {
  const control = el("textarea", { rows });
  control.value = value;
  return control;
}

function locationNamingEditor(existing = null) {
  const savedScheme = schemeFromCellar(existing);
  const existingHasLegacyRule = !!existing?.location_rule && !savedScheme;
  const initialMode = savedScheme?.kind || (existingHasLegacyRule ? "advanced" : "grid");
  const initialScheme = savedScheme || defaultLocationScheme(initialMode === "advanced" ? "grid" : initialMode);

  const mode = el("select", { name: "location_mode", class: "location-kind-select" }, [
    option("loose", "cellars.naming_mode_loose"),
    option("grid", "cellars.naming_mode_grid"),
    option("grid_sub", "cellars.naming_mode_grid_sub"),
    option("sequential", "cellars.naming_mode_sequential"),
    option("depth", "cellars.naming_mode_depth"),
    option("none", "cellars.naming_mode_none"),
    option("advanced", "cellars.naming_mode_advanced"),
  ]);
  mode.value = initialMode;

  const prefix = el("input", {
    type: "text",
    maxlength: 20,
    value: initialScheme.prefix || "",
    placeholder: "M",
    autocomplete: "off",
  });
  const separator = el("input", {
    type: "text",
    maxlength: 3,
    value: initialScheme.separator ?? "",
    placeholder: t("cellars.separator_none"),
  });
  const storeInternal = el("input", { type: "checkbox" });
  storeInternal.checked = initialScheme.store_internal !== false;

  const gridDefaults = defaultLocationScheme("grid");
  const columnStart = el("input", {
    type: "text",
    maxlength: 1,
    value: initialScheme.column_start || gridDefaults.column_start,
    autocomplete: "off",
  });
  const columnEnd = el("input", {
    type: "text",
    maxlength: 1,
    value: initialScheme.column_end || gridDefaults.column_end,
    autocomplete: "off",
  });
  const rowStart = el("input", {
    type: "number",
    min: 0,
    max: 999,
    value: initialScheme.row_start ?? 1,
  });
  const rowEnd = el("input", {
    type: "number",
    min: 0,
    max: 999,
    value: initialScheme.row_end ?? 3,
  });
  const gridOrder = el("select", {}, [
    option("prefix_column_row", "cellars.order_prefix_column_row"),
    option("prefix_row_column", "cellars.order_prefix_row_column"),
    option("column_row", "cellars.order_column_row"),
    option("row_column", "cellars.order_row_column"),
  ]);
  gridOrder.value = ["prefix_column_row", "prefix_row_column", "column_row", "row_column"].includes(initialScheme.order)
    ? initialScheme.order
    : "prefix_column_row";
  const gridHorizontalDirection = el("select", {}, [
    option("ltr", "cellars.first_column_left"),
    option("rtl", "cellars.first_column_right"),
  ]);
  gridHorizontalDirection.value = initialScheme.horizontal_direction || "ltr";
  const gridVerticalDirection = el("select", {}, [
    option("ttb", "cellars.first_row_top"),
    option("btt", "cellars.first_row_bottom"),
  ]);
  gridVerticalDirection.value = initialScheme.vertical_direction || "ttb";

  const subStart = el("input", { type: "number", min: 0, max: 999, value: initialScheme.sub_start ?? 1 });
  const subEnd = el("input", { type: "number", min: 0, max: 999, value: initialScheme.sub_end ?? 2 });
  const subSeparator = el("input", { type: "text", maxlength: 3, value: initialScheme.sub_separator ?? "." });

  const sequentialDefaults = defaultLocationScheme("sequential");
  const sequentialRows = el("input", { type: "number", min: 1, max: 100, value: initialScheme.rows ?? sequentialDefaults.rows });
  const sequentialColumns = el("input", { type: "number", min: 1, max: 100, value: initialScheme.columns ?? sequentialDefaults.columns });
  const positionCount = el("input", { type: "number", min: 1, max: 1000, value: initialScheme.position_count ?? sequentialDefaults.position_count });
  const startLabel = el("input", { type: "text", maxlength: 3, value: initialScheme.start_label || "A" });
  const fillOrder = el("select", {}, [
    option("row_major", "cellars.fill_order_rows"),
    option("column_major", "cellars.fill_order_columns"),
  ]);
  fillOrder.value = initialScheme.fill_order || "row_major";
  const horizontalDirection = el("select", {}, [
    option("ltr", "cellars.direction_left_right"),
    option("rtl", "cellars.direction_right_left"),
  ]);
  horizontalDirection.value = initialScheme.horizontal_direction || "ltr";
  const verticalDirection = el("select", {}, [
    option("ttb", "cellars.direction_top_bottom"),
    option("btt", "cellars.direction_bottom_top"),
  ]);
  verticalDirection.value = initialScheme.vertical_direction || "ttb";

  const looseDefaults = defaultLocationScheme("loose");
  const containers = textArea((initialScheme.containers || []).join("\n"), 4);
  const allowFreeText = el("input", { type: "checkbox" });
  allowFreeText.checked = initialScheme.allow_free_text !== false;

  const depthDefaults = defaultLocationScheme("depth");
  const depthRowStart = el("input", {
    type: "number",
    min: 0,
    max: 999,
    value: initialScheme.kind === "depth" ? initialScheme.row_start : depthDefaults.row_start,
  });
  const depthRowEnd = el("input", {
    type: "number",
    min: 0,
    max: 999,
    value: initialScheme.kind === "depth" ? initialScheme.row_end : depthDefaults.row_end,
  });
  const depthDefinitions = textArea(
    (initialScheme.depths || depthDefaults.depths)
      .map((item) => `${item.code}=${item.label}`)
      .join("\n"),
    3
  );
  const depthOrder = el("select", {}, [
    option("prefix_row_depth", "cellars.order_prefix_row_depth"),
    option("prefix_depth_row", "cellars.order_prefix_depth_row"),
    option("row_depth", "cellars.order_row_depth"),
    option("depth_row", "cellars.order_depth_row"),
  ]);
  depthOrder.value = ["prefix_row_depth", "prefix_depth_row", "row_depth", "depth_row"].includes(initialScheme.order)
    ? initialScheme.order
    : "prefix_row_depth";
  const depthVerticalDirection = el("select", {}, [
    option("ttb", "cellars.first_row_top"),
    option("btt", "cellars.first_row_bottom"),
  ]);
  depthVerticalDirection.value = initialScheme.vertical_direction || "ttb";

  const advancedRule = el("input", {
    type: "text",
    value: existingHasLegacyRule ? existing.location_rule : "",
    autocomplete: "off",
    spellcheck: "false",
  });

  const modeHelp = el("p", { class: "location-mode-help" });

  const commonControls = el("div", { class: "location-wizard-controls" }, [
    el("div", { class: "location-wizard-row" }, [
      fieldWithHelp(t("cellars.cellar_code"), prefix, t("cellars.cellar_code_help")),
      fieldWithHelp(t("cellars.separator"), separator, t("cellars.separator_help")),
    ]),
    el("label", { class: "checkbox-field" }, [
      storeInternal,
      el("span", { text: t("cellars.store_internal_location") }),
    ]),
    el("p", { class: "field-help", text: t("cellars.store_internal_location_help") }),
  ]);

  const looseControls = el("div", { class: "location-structure-fields" }, [
    fieldWithHelp(t("cellars.named_containers"), containers, t("cellars.named_containers_help")),
    el("label", { class: "checkbox-field" }, [
      allowFreeText,
      el("span", { text: t("cellars.allow_free_text") }),
    ]),
    el("p", { class: "field-help", text: t("cellars.allow_free_text_help") }),
  ]);

  const gridControls = el("div", { class: "location-structure-fields" }, [
    el("div", { class: "location-wizard-row location-wizard-four" }, [
      field(t("cellars.first_column"), columnStart),
      field(t("cellars.last_column"), columnEnd),
      field(t("cellars.first_row"), rowStart),
      field(t("cellars.last_row"), rowEnd),
    ]),
    fieldWithHelp(t("cellars.code_order"), gridOrder, t("cellars.code_order_help")),
    el("div", { class: "location-wizard-row" }, [
      fieldWithHelp(t("cellars.first_column_position"), gridHorizontalDirection, t("cellars.grid_orientation_help")),
      fieldWithHelp(t("cellars.first_row_position"), gridVerticalDirection, t("cellars.grid_orientation_help")),
    ]),
  ]);

  const subControls = el("div", { class: "location-structure-fields" }, [
    el("div", { class: "location-wizard-row" }, [
      field(t("cellars.first_sub_position"), subStart),
      field(t("cellars.last_sub_position"), subEnd),
    ]),
    fieldWithHelp(t("cellars.sub_separator"), subSeparator, t("cellars.sub_separator_help")),
  ]);

  const sequentialControls = el("div", { class: "location-structure-fields" }, [
    el("div", { class: "location-wizard-row location-wizard-four" }, [
      field(t("cellars.rows"), sequentialRows),
      field(t("cellars.columns"), sequentialColumns),
      field(t("cellars.position_count"), positionCount),
      field(t("cellars.first_label"), startLabel),
    ]),
    el("div", { class: "location-wizard-row" }, [
      field(t("cellars.fill_order"), fillOrder),
      field(t("cellars.horizontal_direction"), horizontalDirection),
    ]),
    field(t("cellars.vertical_direction"), verticalDirection),
  ]);

  const depthControls = el("div", { class: "location-structure-fields" }, [
    el("div", { class: "location-wizard-row" }, [
      field(t("cellars.first_row"), depthRowStart),
      field(t("cellars.last_row"), depthRowEnd),
    ]),
    fieldWithHelp(t("cellars.depth_positions"), depthDefinitions, t("cellars.depth_positions_help")),
    fieldWithHelp(t("cellars.code_order"), depthOrder, t("cellars.code_order_help")),
    fieldWithHelp(t("cellars.first_row_position"), depthVerticalDirection, t("cellars.depth_orientation_help")),
  ]);

  const advancedControls = el("div", { class: "location-advanced-controls" }, [
    fieldWithHelp(t("cellars.advanced_pattern"), advancedRule, t("cellars.location_rule_help")),
  ]);
  const preview = el("div", { class: "location-scheme-preview", "aria-live": "polite" });
  const validation = el("p", { class: "form-error", hidden: true });

  function readScheme() {
    const common = {
      kind: mode.value,
      enabled: true,
      prefix: prefix.value,
      separator: separator.value,
      store_internal: storeInternal.checked,
    };
    if (mode.value === "loose") {
      return normalizeLocationScheme({ ...common, containers: containers.value, allow_free_text: allowFreeText.checked });
    }
    if (mode.value === "grid" || mode.value === "grid_sub") {
      return normalizeLocationScheme({
        ...common,
        column_start: columnStart.value,
        column_end: columnEnd.value,
        row_start: rowStart.value,
        row_end: rowEnd.value,
        order: gridOrder.value,
        horizontal_direction: gridHorizontalDirection.value,
        vertical_direction: gridVerticalDirection.value,
        ...(mode.value === "grid_sub"
          ? { sub_start: subStart.value, sub_end: subEnd.value, sub_separator: subSeparator.value }
          : {}),
      });
    }
    if (mode.value === "sequential") {
      return normalizeLocationScheme({
        ...common,
        rows: sequentialRows.value,
        columns: sequentialColumns.value,
        position_count: positionCount.value,
        start_label: startLabel.value,
        fill_order: fillOrder.value,
        horizontal_direction: horizontalDirection.value,
        vertical_direction: verticalDirection.value,
      });
    }
    return normalizeLocationScheme({
      ...common,
      row_start: depthRowStart.value,
      row_end: depthRowEnd.value,
      depths: depthDefinitions.value,
      order: depthOrder.value,
      vertical_direction: depthVerticalDirection.value,
    });
  }

  function previewItem(item) {
    if (!item) return el("div", { class: "location-code-cell location-code-cell-missing" });
    if (item.group && Array.isArray(item.children)) {
      return el("div", { class: "location-code-cell location-code-group" }, [
        el("strong", { text: item.internal }),
        el("div", { class: "location-subpositions" }, item.children.map((child) =>
          el("span", { class: "location-subposition", text: child.import })
        )),
      ]);
    }
    const label = item.unspecified ? t("cellars.unspecified_location") : item.import;
    const children = [el("strong", { text: label })];
    if (!item.unspecified && item.import !== item.internal && storeInternal.checked) {
      children.push(el("small", { text: t("cellars.location_inside", { location: item.internal }) }));
    }
    if (item.depth_label && item.depth_label !== item.depth) {
      children.push(el("small", { text: item.depth_label }));
    }
    return el("div", { class: "location-code-cell" }, children);
  }

  function drawPreview() {
    clear(preview);
    validation.hidden = true;
    const helpKey = `cellars.mode_help_${mode.value}`;
    const helpText = t(helpKey);
    modeHelp.textContent = helpText === helpKey ? "" : helpText;
    modeHelp.hidden = !modeHelp.textContent;
    const structured = ["loose", "grid", "grid_sub", "sequential", "depth"].includes(mode.value);
    commonControls.hidden = !structured;
    looseControls.hidden = mode.value !== "loose";
    gridControls.hidden = !["grid", "grid_sub"].includes(mode.value);
    subControls.hidden = mode.value !== "grid_sub";
    sequentialControls.hidden = mode.value !== "sequential";
    depthControls.hidden = mode.value !== "depth";
    advancedControls.hidden = mode.value !== "advanced";
    preview.hidden = !structured;
    if (!structured) return;

    try {
      const scheme = readScheme();
      const matrix = buildLocationGrid(scheme);
      const positions = generateLocations(scheme);
      const physicalColumns = Math.max(1, ...matrix.map((row) => row.length));
      preview.appendChild(el("p", {
        class: "location-preview-summary",
        text: t("cellars.location_preview_positions", {
          positions: positions.length,
          rows: matrix.length,
          columns: physicalColumns,
        }),
      }));
      const grid = el("div", { class: `location-code-grid structure-${scheme.kind}` });
      grid.style.gridTemplateColumns = `repeat(${physicalColumns}, minmax(82px, 1fr))`;
      const maxCells = 140;
      let rendered = 0;
      for (const row of matrix) {
        for (const item of row) {
          if (rendered >= maxCells) break;
          grid.appendChild(previewItem(item));
          rendered += 1;
        }
        if (rendered >= maxCells) break;
      }
      preview.appendChild(grid);
      if (matrix.reduce((sum, row) => sum + row.length, 0) > maxCells) {
        preview.appendChild(el("p", { class: "field-help", text: t("cellars.location_preview_truncated", { count: maxCells }) }));
      }
      if (scheme.kind === "loose" && !scheme.prefix) {
        preview.appendChild(el("p", { class: "form-warning", text: t("cellars.loose_prefix_warning") }));
      }
    } catch (error) {
      validation.textContent = schemeErrorMessage(error);
      validation.hidden = false;
    }
  }

  function applyDefaults(kind) {
    if (!["loose", "grid", "grid_sub", "sequential", "depth"].includes(kind)) return;
    const defaults = defaultLocationScheme(kind);
    prefix.value = defaults.prefix || "";
    separator.value = defaults.separator ?? "";
    storeInternal.checked = defaults.store_internal !== false;
    if (kind === "loose") {
      containers.value = "";
      allowFreeText.checked = true;
    } else if (["grid", "grid_sub"].includes(kind)) {
      columnStart.value = defaults.column_start;
      columnEnd.value = defaults.column_end;
      rowStart.value = defaults.row_start;
      rowEnd.value = defaults.row_end;
      gridOrder.value = defaults.order;
      gridHorizontalDirection.value = defaults.horizontal_direction || "ltr";
      gridVerticalDirection.value = defaults.vertical_direction || "ttb";
      if (kind === "grid_sub") {
        subStart.value = defaults.sub_start;
        subEnd.value = defaults.sub_end;
        subSeparator.value = defaults.sub_separator;
      }
    } else if (kind === "sequential") {
      sequentialRows.value = defaults.rows;
      sequentialColumns.value = defaults.columns;
      positionCount.value = defaults.position_count;
      startLabel.value = defaults.start_label;
      fillOrder.value = defaults.fill_order;
      horizontalDirection.value = defaults.horizontal_direction;
      verticalDirection.value = defaults.vertical_direction;
    } else {
      depthRowStart.value = defaults.row_start;
      depthRowEnd.value = defaults.row_end;
      depthDefinitions.value = defaults.depths.map((item) => `${item.code}=${item.label}`).join("\n");
      depthOrder.value = defaults.order;
      depthVerticalDirection.value = defaults.vertical_direction || "ttb";
    }
  }

  // Keep values entered for each structure when users switch between choices.
  // Hidden sections retain their state, while only the selected structure is displayed.
  mode.addEventListener("change", drawPreview);
  const controls = [
    prefix, separator, storeInternal, columnStart, columnEnd, rowStart, rowEnd,
    gridOrder, gridHorizontalDirection, gridVerticalDirection, subStart, subEnd, subSeparator,
    sequentialRows, sequentialColumns, positionCount, startLabel, fillOrder,
    horizontalDirection, verticalDirection, containers, allowFreeText, depthRowStart,
    depthRowEnd, depthDefinitions, depthOrder, depthVerticalDirection,
  ];
  for (const control of controls) {
    control.addEventListener("input", drawPreview);
    control.addEventListener("change", drawPreview);
  }

  const element = el("section", { class: "location-naming-card" }, [
    el("h3", { text: t("cellars.location_naming") }),
    el("p", { class: "field-help", text: t("cellars.location_structure_help") }),
    field(t("cellars.location_structure"), mode),
    modeHelp,
    commonControls,
    looseControls,
    gridControls,
    subControls,
    sequentialControls,
    depthControls,
    advancedControls,
    preview,
    validation,
  ]);
  drawPreview();

  return {
    element,
    value() {
      if (mode.value === "none") {
        return { location_rule: null, layout: layoutWithScheme(existing?.layout || null, null) };
      }
      if (mode.value === "advanced") {
        return {
          location_rule: advancedRule.value.trim() || null,
          layout: layoutWithScheme(existing?.layout || null, null),
        };
      }
      const scheme = readScheme();
      return {
        location_rule: buildLocationRule(scheme),
        layout: layoutWithScheme(existing?.layout || null, scheme),
      };
    },
  };
}

function cellarForm(onSubmit, existing = null) {
  const name = el("input", {
    type: "text",
    name: "name",
    required: true,
    value: existing?.name || "",
  });
  const purposeLevel = el("input", {
    type: "number",
    name: "purpose_level",
    min: 0,
    max: 10,
    value: existing?.purpose_level ?? 5,
  });
  const isOverflow = el("input", { type: "checkbox", name: "is_overflow" });
  isOverflow.checked = !!existing?.is_overflow;
  const maxCapacity = el("input", {
    type: "number",
    name: "max_capacity",
    min: 0,
    value: existing?.max_capacity ?? 0,
  });
  const threshold = el("input", {
    type: "number",
    name: "threshold",
    min: 0,
    value: existing?.threshold ?? 0,
  });
  const naming = locationNamingEditor(existing);

  isOverflow.addEventListener("change", () => {
    purposeLevel.disabled = isOverflow.checked;
  });
  purposeLevel.disabled = isOverflow.checked;

  const errorBox = el("p", { class: "form-error", hidden: true });
  const submit = el("button", {
    type: "submit",
    class: "primary",
    text: t("common.save"),
  });
  const form = el("form", { class: "entity-form cellar-form-wide" }, [
    field(t("cellars.name"), name),
    field(t("cellars.purpose_level"), purposeLevel),
    el("label", { class: "checkbox-field" }, [
      isOverflow,
      el("span", { text: t("cellars.is_overflow") }),
    ]),
    field(t("cellars.max_capacity"), maxCapacity),
    field(t("cellars.threshold"), threshold),
    naming.element,
    errorBox,
    submit,
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    try {
      const namingValue = naming.value();
      await onSubmit({
        name: name.value.trim(),
        purpose_level: isOverflow.checked ? null : Number(purposeLevel.value),
        is_overflow: isOverflow.checked,
        max_capacity: Number(maxCapacity.value),
        threshold: Number(threshold.value),
        ...namingValue,
      });
    } catch (error) {
      errorBox.textContent =
        error instanceof Error && !error.detail
          ? schemeErrorMessage(error)
          : error.detail?.message || error.detail || t("common.error_generic");
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

function schemeSummary(cellar) {
  const scheme = schemeFromCellar(cellar);
  if (!scheme) return null;
  if (scheme.kind === "loose") {
    return t("cellars.scheme_summary_loose", { prefix: scheme.prefix || "-" });
  }
  if (scheme.kind === "grid") {
    return t("cellars.scheme_summary_grid", {
      prefix: scheme.prefix || "-",
      columns: `${scheme.column_start}-${scheme.column_end}`,
      rows: `${scheme.row_start}-${scheme.row_end}`,
    });
  }
  if (scheme.kind === "grid_sub") {
    return t("cellars.scheme_summary_grid_sub", {
      columns: `${scheme.column_start}-${scheme.column_end}`,
      rows: `${scheme.row_start}-${scheme.row_end}`,
      subs: `${scheme.sub_start}-${scheme.sub_end}`,
    });
  }
  if (scheme.kind === "sequential") {
    return t("cellars.scheme_summary_sequential", {
      positions: scheme.position_count,
      rows: scheme.rows,
      columns: scheme.columns,
    });
  }
  return t("cellars.scheme_summary_depth", {
    rows: `${scheme.row_start}-${scheme.row_end}`,
    depths: scheme.depths.map((item) => item.code).join("/"),
  });
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
    formHost
  );

  async function refreshUnassigned() {
    clear(unassignedHost);
    const summary = await api.get("/cellars/unassigned-summary").catch(() => null);
    if (!summary || !summary.bottles) return;

    const actionState = el("p", {
      class: "hint",
      text: t("cellars.unassigned_help"),
    });
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
        actionState.textContent =
          error.detail?.message || error.detail || t("common.error_generic");
        actionState.className = "form-error";
      } finally {
        reconcileButton.disabled = false;
      }
    });
    unassignedHost.appendChild(
      el("section", { class: "unassigned-holdings-callout" }, [
        el("h2", { text: t("cellars.unassigned_title") }),
        el("p", {
          text: t("cellars.unassigned_summary", {
            bottles: summary.bottles,
            holdings: summary.holdings,
          }),
        }),
        actionState,
        reconcileButton,
      ])
    );
  }

  async function refresh() {
    clear(list);
    const cellars = await api.get("/cellars");
    if (!cellars.length) {
      list.appendChild(
        el("p", { class: "empty-state", text: t("cellars.empty_state") })
      );
      return;
    }
    for (const cellar of cellars) {
      const overThreshold =
        cellar.threshold > 0 && cellar.current_fill > cellar.threshold;
      const naming = schemeSummary(cellar);
      list.appendChild(
        el("div", { class: "cellar-row" }, [
          el("div", { class: "cellar-row-name", text: cellar.name }),
          el("div", { class: "cellar-row-meta", text: purposeLabel(cellar) }),
          naming
            ? el("div", { class: "cellar-row-location-scheme", text: naming })
            : null,
          el("div", {
            class: "cellar-row-fill",
            text: t("cellars.fill", {
              fill: cellar.current_fill,
              capacity: cellar.max_capacity || "-",
            }),
          }),
          overThreshold
            ? el("span", {
                class: "badge badge-warn",
                text: t("cellars.over_threshold"),
              })
            : null,
          el("a", {
            href: `#/cellars/${cellar.id}`,
            class: "button small",
            text: t("cellars.view"),
          }),
        ])
      );
    }
  }

  function mountCreateForm() {
    clear(formHost);
    formHost.appendChild(
      cellarForm(async (payload) => {
        const created = await api.post("/cellars", payload);
        showToast(reconciliationToast(created));
        mountCreateForm();
        await Promise.all([refresh(), refreshUnassigned()]);
      })
    );
  }

  mountCreateForm();
  await Promise.all([refresh(), refreshUnassigned()]);
}

function occupancyFor(holdings) {
  const occupancy = new Map();
  for (const holding of holdings) {
    const key = holding.location
      ? holding.location.trim().toLocaleUpperCase()
      : "__UNSPECIFIED__";
    occupancy.set(key, (occupancy.get(key) || 0) + holding.quantity);
  }
  return occupancy;
}

function locationQuantity(item, occupancy) {
  if (item.unspecified) return occupancy.get("__UNSPECIFIED__") || 0;
  const internal = item.internal?.toLocaleUpperCase();
  const imported = item.import?.toLocaleUpperCase();
  const internalQuantity = internal ? occupancy.get(internal) || 0 : 0;
  const importQuantity = imported ? occupancy.get(imported) || 0 : 0;
  return internal && imported && internal === imported
    ? internalQuantity
    : internalQuantity + importQuantity;
}

function renderedLocationSlot(cellar, item, occupancy, holdings) {
  if (!item) return el("div", { class: "cellar-location-slot location-code-cell-missing" });

  if (item.group && Array.isArray(item.children)) {
    const quantity = item.children.reduce(
      (total, child) => total + locationQuantity(child, occupancy),
      0,
    );
    return el(
      "div",
      {
        class: `cellar-location-slot location-slot-group ${
          quantity ? "occupied" : "empty"
        }`,
      },
      [
        el("strong", { class: "cellar-slot-code", text: item.internal }),
        el(
          "div",
          { class: "cellar-subpositions" },
          item.children.map((child) => {
            const childQuantity = locationQuantity(child, occupancy);
            const node = el(
              "div",
              {
                class: `cellar-subslot ${
                  childQuantity ? "occupied" : "empty"
                }`,
              },
              [
                el("span", { text: child.label }),
                el("small", { text: childQuantity ? String(childQuantity) : "-" }),
              ],
            );
            return attachLocationBottleClick(node, {
              cellar,
              item: child,
              holdings,
              quantity: childQuantity,
            });
          }),
        ),
      ],
    );
  }

  const quantity = locationQuantity(item, occupancy);
  const code = item.unspecified
    ? t("cellars.unspecified_location")
    : item.internal;
  const children = [
    el("strong", {
      class: "cellar-slot-code",
      text: code || t("cellars.unspecified_location"),
    }),
  ];
  if (!item.unspecified && item.import !== item.internal) {
    children.push(
      el("small", {
        class: "cellar-slot-import-code",
        text: t("cellars.import_code", { code: item.import }),
      }),
    );
  }
  if (item.depth_label && item.depth_label !== item.depth) {
    children.push(
      el("small", {
        class: "cellar-slot-depth-label",
        text: item.depth_label,
      }),
    );
  }
  children.push(
    el("span", {
      class: "cellar-slot-quantity",
      text: quantity
        ? t("common.bottles_count", { count: quantity })
        : t("cellars.slot_empty"),
    }),
  );

  const node = el(
    "div",
    {
      class: `cellar-location-slot ${quantity ? "occupied" : "empty"}`,
      title: `${item.import || code} · ${quantity}`,
    },
    children,
  );
  return attachLocationBottleClick(node, {
    cellar,
    item,
    holdings,
    quantity,
  });
}

function renderNamedGrid(cellar, holdings) {
  const scheme = schemeFromCellar(cellar);
  if (!scheme) return null;
  const matrix = buildLocationGrid(scheme);
  const occupancy = occupancyFor(holdings);
  const physicalColumns = Math.max(1, ...matrix.map((row) => row.length));
  const grid = el("div", {
    class: `cellar-location-grid structure-${scheme.kind}`,
  });
  grid.style.gridTemplateColumns = `repeat(${physicalColumns}, minmax(92px, 1fr))`;
  for (const row of matrix) {
    for (const item of row) {
      grid.appendChild(renderedLocationSlot(cellar, item, occupancy, holdings));
    }
  }
  const locations = generateLocations(scheme);
  const first = locations.find((item) => item.import)?.import || "-";
  const last =
    [...locations].reverse().find((item) => item.import)?.import || "-";
  return el("section", { class: "named-grid-panel" }, [
    el("p", {
      class: "field-help",
      text: t("cellars.structure_explanation", {
        type: t(`cellars.naming_mode_${scheme.kind}`),
        positions: locations.length,
        first,
        last,
      }),
    }),
    grid,
  ]);
}


function legacySlotCode(rack, rackIndex, slotIndex) {
  const prefix = (rack.prefix || `R${rackIndex + 1}-`).trim();
  return `${prefix}${slotIndex + 1}`;
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function renderLegacyRackSvg(cellar, rack, rackIndex, occupancy, holdings) {
  const cell = 56;
  const top = 34;
  const width = Math.max(1, rack.cols) * cell + 20;
  const height = Math.max(1, rack.rows) * cell + top + 14;
  const svg = svgNode("svg", {
    class: "rack-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${t("cellars.rack")} ${rackIndex + 1}`,
  });
  const title = svgNode("text", { x: 10, y: 22, class: "rack-svg-title" });
  title.textContent = `${t("cellars.rack")} ${rackIndex + 1} · ${
    rack.prefix || `R${rackIndex + 1}-`
  }`;
  svg.appendChild(title);

  for (let row = 0; row < rack.rows; row += 1) {
    for (let col = 0; col < rack.cols; col += 1) {
      const index = row * rack.cols + col;
      const code = legacySlotCode(rack, rackIndex, index);
      const quantity = occupancy.get(code.toLocaleUpperCase()) || 0;
      const cx = 10 + col * cell + cell / 2;
      const cy = top + row * cell + cell / 2;
      const group = svgNode("g", {
        class: `rack-svg-slot ${quantity ? "occupied" : "empty"}`,
      });
      const shape =
        rack.shape === "diamond"
          ? svgNode("rect", {
              x: cx - 18,
              y: cy - 18,
              width: 36,
              height: 36,
              rx: 4,
              transform: `rotate(45 ${cx} ${cy})`,
            })
          : svgNode("circle", { cx, cy, r: 21 });
      const label = svgNode("text", {
        x: cx,
        y: cy + 4,
        "text-anchor": "middle",
      });
      label.textContent = code;
      group.append(shape, label);
      if (quantity) {
        const count = svgNode("text", {
          x: cx + 18,
          y: cy - 16,
          class: "rack-svg-count",
          "text-anchor": "middle",
        });
        count.textContent = String(quantity);
        group.appendChild(count);
      }
      attachLocationBottleClick(group, {
        cellar,
        item: { internal: code, import: code },
        holdings,
        quantity,
      });
      svg.appendChild(group);
    }
  }
  return svg;
}

function renderLegacyLayoutEditor(cellar, holdings, onLayoutChange) {
  const layout = parseCellarLayout(cellar.layout);
  if (!Array.isArray(layout.racks)) layout.racks = [];
  const occupancy = occupancyFor(holdings);
  const preview = el("div", { class: "rack-preview rack-preview-svg" });
  const rows = el("input", { type: "number", min: 1, max: 30, value: 4 });
  const cols = el("input", { type: "number", min: 1, max: 30, value: 6 });
  const prefix = el("input", {
    type: "text",
    value: "R1-",
    maxlength: 20,
  });
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
      preview.appendChild(
        el("p", { class: "empty-state", text: t("cellars.no_named_grid") })
      );
      return;
    }
    layout.racks.forEach((rack, index) => {
      preview.appendChild(
        el("section", { class: "rack-card" }, [
          renderLegacyRackSvg(cellar, rack, index, occupancy, holdings),
          el("button", {
            type: "button",
            class: "button small danger",
            text: t("cellars.remove_rack"),
            onclick: async () => {
              layout.racks.splice(index, 1);
              draw();
              await persist();
            },
          }),
        ])
      );
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

  draw();
  return el("div", { class: "layout-editor" }, [
    el("p", { class: "field-help", text: t("cellars.legacy_layout_help") }),
    el("div", { class: "rack-controls" }, [
      field(t("cellars.rows"), rows),
      field(t("cellars.columns"), cols),
      field(t("cellars.location_prefix"), prefix),
      field(t("cellars.shape"), shape),
      addButton,
    ]),
    preview,
  ]);
}

export async function renderCellarDetail(container, { id }) {
  let cellar;
  try {
    cellar = await api.get(`/cellars/${id}`);
  } catch {
    container.appendChild(
      el("p", { class: "form-error", text: t("common.error_generic") })
    );
    return;
  }

  async function mount() {
    clear(container);
    const holdings = await api
      .get(`/holdings?cellar_id=${id}&state=in_cellar`)
      .catch(() => []);

    container.append(
      el("a", {
        href: "#/cellars",
        class: "back-link",
        text: `< ${t("common.back")}`,
      }),
      el("h1", { text: cellar.name }),
      el("p", {
        class: "cellar-meta",
        text: `${t("cellars.purpose_level")}: ${purposeLabel(cellar)} · ${t(
          "cellars.fill",
          {
            fill: cellar.current_fill,
            capacity: cellar.max_capacity || "-",
          }
        )}`,
      })
    );

    const settings = el("details", { class: "cellar-settings" }, [
      el("summary", { text: t("cellars.edit_settings") }),
      cellarForm(async (payload) => {
        cellar = await api.put(
          `/cellars/${id}?expected_version=${cellar.version}`,
          payload
        );
        showToast(reconciliationToast(cellar));
        await mount();
      }, cellar),
    ]);
    container.appendChild(settings);

    container.appendChild(el("h2", { text: t("cellars.layout") }));
    const namedGrid = renderNamedGrid(cellar, holdings);
    if (namedGrid) {
      container.appendChild(namedGrid);
    } else {
      container.appendChild(
        renderLegacyLayoutEditor(cellar, holdings, async (layoutJson) => {
          cellar = await api.put(
            `/cellars/${id}?expected_version=${cellar.version}`,
            cellarPayload(cellar, { layout: layoutJson })
          );
          showToast(t("common.save"));
        })
      );
    }

    container.appendChild(el("h2", { text: t("bottles.title") }));
    const holdingsList = el("div", { class: "holding-list" });
    container.appendChild(holdingsList);
    if (!holdings.length) {
      holdingsList.appendChild(
        el("p", { class: "empty-state", text: t("bottles.empty_state") })
      );
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
          el("div", {
            class: "holding-wine",
            text: `${wine.producer}${wine.cuvee ? ` - ${wine.cuvee}` : ""}${
              wine.vintage ? ` ${wine.vintage}` : ""
            }`,
          }),
          el("div", {
            class: "holding-location",
            text: holding.location || "-",
          }),
          el("div", {
            class: "holding-qty",
            text: t("common.bottles_count", { count: holding.quantity }),
          }),
          holding.pending_sync
            ? el("span", {
                class: "badge badge-warn",
                text: t("offline.pending") || "Pending sync",
              })
            : null,
        ])
      );
    }
  }

  await mount();
}
