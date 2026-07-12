import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, selectEl } from "../dom.js";

export const IMPORT_FIELDS = [
  "producer",
  "cuvee",
  "appellation",
  "vintage",
  "color",
  "area",
  "format",
  "price_bought",
  "quantity",
  "drink_after",
  "drink_before",
  "cellar",
  "location",
  "state",
  "advice_experience",
  "advice_pairing",
  "market_value",
];

export const REQUIRED_IMPORT_FIELDS = new Set([
  "producer",
  "cuvee",
  "appellation",
  "vintage",
  "color",
  "area",
  "format",
]);

const PROFILE_STORAGE_KEY = "cellarmanager.csvMappingProfiles.v1";

export function buildMappingPayload(selections) {
  const mapping = {};
  for (const field of IMPORT_FIELDS) {
    const selection = selections[field] || {};
    const columns = [selection.primary, selection.fallback]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    if (columns.length) mapping[field] = { columns };
  }
  return mapping;
}

export function validateMappingSelection(mapping) {
  const missing = [...REQUIRED_IMPORT_FIELDS].filter(
    (field) => !mapping[field] || !mapping[field].columns?.length
  );
  const owners = new Map();
  const duplicates = [];
  for (const [field, spec] of Object.entries(mapping)) {
    for (const column of spec.columns || []) {
      const owner = owners.get(column);
      if (owner && owner !== field) duplicates.push({ column, fields: [owner, field] });
      else owners.set(column, field);
    }
  }
  return { ok: missing.length === 0 && duplicates.length === 0, missing, duplicates };
}

export function mappingProfileKey(headers) {
  return (headers || [])
    .map((header) => `${header.position}:${String(header.label || "").trim().toLowerCase()}`)
    .join("|");
}

function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveProfile(headers, mapping) {
  try {
    const profiles = loadProfiles();
    profiles[mappingProfileKey(headers)] = mapping;
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Private browsing/storage restrictions must never block an import.
  }
}

function loadProfile(headers) {
  try {
    return loadProfiles()[mappingProfileKey(headers)] || null;
  } catch {
    return null;
  }
}

function errorText(error) {
  if (typeof error?.detail === "string") return error.detail;
  if (error?.detail?.message) return error.detail.message;
  return t("common.error_generic");
}

function mappingLabel(field) {
  return t(`import.field.${field}`);
}

function cellarQuery(cellarId) {
  return cellarId ? `?default_cellar_id=${encodeURIComponent(cellarId)}` : "";
}

function createFileForm(file, mapping = null) {
  const formData = new FormData();
  formData.append("file", file);
  if (mapping) formData.append("mapping", JSON.stringify(mapping));
  return formData;
}

function statusLabel(status) {
  return t(`import.status.${status}`);
}

function renderImportReport(reportBox, report, onReset) {
  clear(reportBox);
  reportBox.appendChild(el("h2", { text: t("import.report_title") }));
  reportBox.appendChild(el("p", { text: t("import.imported", { count: report.imported }) }));
  reportBox.appendChild(el("p", { text: t("import.merged", { count: report.merged_into_existing_wine }) }));
  reportBox.appendChild(el("p", { text: t("import.skipped", { count: report.skipped }) }));
  if (report.unassigned_bottles > 0) {
    reportBox.appendChild(
      el("div", { class: "import-unassigned-callout" }, [
        el("strong", {
          text: t("import.unassigned_report", {
            bottles: report.unassigned_bottles,
            rows: report.unassigned_rows,
          }),
        }),
        el("p", { text: t("import.unassigned_next_step") }),
        el("a", { href: "#/cellars", class: "button secondary", text: t("import.go_to_cellars") }),
      ])
    );
  }
  if (report.warnings?.length) {
    reportBox.appendChild(el("h3", { text: t("import.warnings") }));
    reportBox.appendChild(
      el(
        "ul",
        { class: "import-warning-list" },
        report.warnings.map((warning) =>
          el("li", { text: `${t("import.row")} ${warning.row}: ${warning.message}` })
        )
      )
    );
  } else {
    reportBox.appendChild(el("p", { class: "success-note", text: t("import.no_warnings") }));
  }
  reportBox.appendChild(
    el("button", {
      type: "button",
      class: "primary",
      text: t("import.import_another"),
      onclick: onReset,
    })
  );
}

export async function renderImport(container) {
  container.appendChild(el("h1", { text: t("import.title") }));
  container.appendChild(el("p", { class: "hint", text: t("import.help") }));

  const cellars = await api.get("/cellars").catch(() => []);
  const cellarSelect = selectEl([
    { value: "", label: t("common.none") },
    ...cellars.map((cellar) => ({ value: cellar.id, label: cellar.name })),
  ]);

  let analysis = null;
  let controls = new Map();
  let lastPreview = null;

  const pageError = el("p", { class: "form-error", hidden: true });
  const reportBox = el("div", { class: "import-report" });

  const fileInput = el("input", {
    type: "file",
    accept: ".csv,text/csv",
    class: "visually-hidden",
  });
  const fileButton = el("button", {
    type: "button",
    class: "secondary",
    text: t("import.choose_file_button"),
  });
  const resetButton = el("button", {
    type: "button",
    class: "button secondary",
    text: t("import.reset"),
  });
  const fileName = el("span", { class: "file-picker-name", text: t("import.no_file") });
  const analyzeState = el("span", { class: "import-analysis-state" });
  fileButton.addEventListener("click", () => fileInput.click());

  const filePicker = el("div", { class: "file-picker" }, [
    fileButton,
    fileName,
    analyzeState,
    fileInput,
  ]);

  const chooseStep = el("section", { class: "wizard-step" }, [
    el("div", { class: "wizard-step-heading" }, [
      el("span", { class: "wizard-step-number", text: "1" }),
      el("h2", { text: t("import.step_file") }),
    ]),
    el("label", { class: "field" }, [
      el("span", { class: "field-label", text: t("import.choose_file") }),
      filePicker,
    ]),
    el("label", { class: "field" }, [
      el("span", { class: "field-label", text: t("import.default_cellar") }),
      cellarSelect,
    ]),
    !cellars.length
      ? el("div", { class: "import-no-cellar-callout" }, [
          el("strong", { text: t("import.no_cellars_title") }),
          el("p", { text: t("import.no_cellars_help") }),
          el("a", { href: "#/cellars", class: "button secondary", text: t("import.create_cellar") }),
        ])
      : null,
    el("div", { class: "form-actions" }, [resetButton]),
  ]);

  const mappingSummary = el("p", { class: "hint" });
  const mappingNotices = el("div", { class: "import-notices" });
  const mappingTableWrap = el("div", { class: "table-scroll" });
  const rememberMapping = el("input", { type: "checkbox", checked: true });
  rememberMapping.checked = true;
  const previewButton = el("button", {
    type: "button",
    class: "primary",
    text: t("import.preview"),
  });
  const mappingError = el("p", { class: "form-error", hidden: true });

  const mappingStep = el("section", { class: "wizard-step", hidden: true }, [
    el("div", { class: "wizard-step-heading" }, [
      el("span", { class: "wizard-step-number", text: "2" }),
      el("h2", { text: t("import.step_mapping") }),
    ]),
    el("p", { class: "hint", text: t("import.mapping_intro") }),
    mappingSummary,
    mappingNotices,
    mappingTableWrap,
    el("label", { class: "checkbox-row" }, [
      rememberMapping,
      el("span", { text: t("import.remember_mapping") }),
    ]),
    mappingError,
    previewButton,
  ]);

  const previewSummary = el("div", { class: "import-preview-summary" });
  const previewTableWrap = el("div", { class: "table-scroll" });
  const previewWarnings = el("div", { class: "import-preview-warnings" });
  const importButton = el("button", {
    type: "button",
    class: "primary",
    text: t("import.upload"),
    disabled: true,
  });
  importButton.disabled = true;
  const previewError = el("p", { class: "form-error", hidden: true });

  const previewStep = el("section", { class: "wizard-step", hidden: true }, [
    el("div", { class: "wizard-step-heading" }, [
      el("span", { class: "wizard-step-number", text: "3" }),
      el("h2", { text: t("import.step_preview") }),
    ]),
    previewSummary,
    previewTableWrap,
    previewWarnings,
    previewError,
    importButton,
  ]);

  const wizard = el("div", { class: "import-wizard" }, [
    chooseStep,
    mappingStep,
    previewStep,
    pageError,
  ]);
  container.append(wizard, reportBox);

  function resetPreview() {
    lastPreview = null;
    previewStep.hidden = true;
    importButton.disabled = true;
    importButton.textContent = t("import.upload");
    clear(previewSummary);
    clear(previewTableWrap);
    clear(previewWarnings);
    previewError.hidden = true;
    clear(reportBox);
  }

  function resetWizard({ focus = false } = {}) {
    analysis = null;
    controls = new Map();
    lastPreview = null;
    fileInput.value = "";
    fileName.textContent = t("import.no_file");
    analyzeState.textContent = "";
    mappingStep.hidden = true;
    previewStep.hidden = true;
    clear(mappingTableWrap);
    clear(mappingNotices);
    clear(mappingSummary);
    clear(previewSummary);
    clear(previewTableWrap);
    clear(previewWarnings);
    clear(reportBox);
    pageError.hidden = true;
    mappingError.hidden = true;
    previewError.hidden = true;
    previewButton.disabled = false;
    previewButton.textContent = t("import.preview");
    importButton.disabled = true;
    importButton.textContent = t("import.upload");
    if (focus) {
      chooseStep.scrollIntoView({ behavior: "smooth", block: "start" });
      fileButton.focus();
    }
  }

  resetButton.addEventListener("click", () => resetWizard({ focus: true }));

  function currentSelections() {
    const values = {};
    for (const [field, control] of controls.entries()) {
      values[field] = {
        primary: control.primary.value,
        fallback: control.fallback.value,
      };
    }
    return values;
  }

  function updateSample(field) {
    const control = controls.get(field);
    if (!control || !analysis) return;
    const sourceId = control.primary.value || control.fallback.value;
    const header = analysis.headers.find((item) => item.id === sourceId);
    control.sample.textContent = header?.samples?.filter(Boolean).join(" · ") || "—";
  }

  function renderMapping() {
    controls = new Map();
    clear(mappingTableWrap);
    clear(mappingNotices);
    mappingError.hidden = true;
    resetPreview();

    const saved = loadProfile(analysis.headers);
    const suggestions = saved || analysis.suggested_mapping || {};
    const options = [
      { value: "", label: t("import.not_imported") },
      ...analysis.headers.map((header) => ({
        value: header.id,
        label: `${header.position}. ${header.label}`,
      })),
    ];

    const table = el("table", { class: "data-table column-mapping-table" });
    table.appendChild(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("import.target_field") }),
          el("th", { text: t("import.csv_column") }),
          el("th", { text: t("import.fallback_column") }),
          el("th", { text: t("import.sample") }),
        ]),
      ])
    );
    const tbody = el("tbody");

    for (const field of IMPORT_FIELDS) {
      const suggestion = suggestions[field]?.columns || [];
      const primary = selectEl(options, { value: suggestion[0] || "" });
      const fallback = selectEl(options, { value: suggestion[1] || "" });
      primary.value = suggestion[0] || "";
      fallback.value = suggestion[1] || "";
      const sample = el("span", { class: "mapping-sample", text: "—" });
      const required = REQUIRED_IMPORT_FIELDS.has(field);
      const target = el("div", { class: "mapping-target" }, [
        el("strong", { text: mappingLabel(field) }),
        el("span", {
          class: `mapping-badge ${required ? "mapping-required" : "mapping-optional"}`,
          text: required ? t("import.required") : t("import.optional"),
        }),
      ]);
      controls.set(field, { primary, fallback, sample });
      const onChange = () => {
        mappingError.hidden = true;
        resetPreview();
        updateSample(field);
      };
      primary.addEventListener("change", onChange);
      fallback.addEventListener("change", onChange);
      tbody.appendChild(
        el("tr", {}, [
          el("td", {}, [target]),
          el("td", {}, [primary]),
          el("td", {}, [fallback]),
          el("td", {}, [sample]),
        ])
      );
      updateSample(field);
    }
    table.appendChild(tbody);
    mappingTableWrap.appendChild(table);

    mappingSummary.textContent = t("import.detected", {
      rows: analysis.total_rows,
      columns: analysis.headers.length,
      delimiter: analysis.delimiter === "\t" ? t("import.tab") : analysis.delimiter,
      encoding: analysis.encoding,
    });

    if (saved) {
      mappingNotices.appendChild(
        el("p", { class: "success-note", text: t("import.saved_mapping_loaded") })
      );
    }
    if (analysis.notices?.length) {
      mappingNotices.appendChild(
        el(
          "ul",
          { class: "import-warning-list" },
          analysis.notices.map((notice) => el("li", { text: notice }))
        )
      );
    }
    mappingStep.hidden = false;
  }

  async function analyzeSelectedFile() {
    const file = fileInput.files?.[0];
    analysis = null;
    mappingStep.hidden = true;
    resetPreview();
    pageError.hidden = true;
    if (!file) {
      fileName.textContent = t("import.no_file");
      return;
    }
    fileName.textContent = file.name;
    analyzeState.textContent = t("import.analyzing");
    fileButton.disabled = true;
    try {
      analysis = await api.postForm("/import/analyze", createFileForm(file));
      analyzeState.textContent = t("import.analysis_ready");
      renderMapping();
    } catch (error) {
      analyzeState.textContent = "";
      pageError.textContent = errorText(error);
      pageError.hidden = false;
    } finally {
      fileButton.disabled = false;
    }
  }

  fileInput.addEventListener("change", analyzeSelectedFile);
  cellarSelect.addEventListener("change", resetPreview);

  previewButton.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file || !analysis) return;
    mappingError.hidden = true;
    previewError.hidden = true;
    const mapping = buildMappingPayload(currentSelections());
    const validation = validateMappingSelection(mapping);
    if (!validation.ok) {
      const parts = [];
      if (validation.missing.length) {
        parts.push(
          t("import.mapping_missing_required", {
            fields: validation.missing.map(mappingLabel).join(", "),
          })
        );
      }
      if (validation.duplicates.length) parts.push(t("import.mapping_duplicate"));
      mappingError.textContent = parts.join(" ");
      mappingError.hidden = false;
      return;
    }

    previewButton.disabled = true;
    previewButton.textContent = t("import.previewing");
    try {
      lastPreview = await api.postForm(
        `/import/preview${cellarQuery(cellarSelect.value)}`,
        createFileForm(file, mapping)
      );
      renderPreview(lastPreview);
      previewStep.hidden = false;
      importButton.disabled = !lastPreview.can_import;
      previewStep.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      mappingError.textContent = errorText(error);
      mappingError.hidden = false;
    } finally {
      previewButton.disabled = false;
      previewButton.textContent = t("import.preview");
    }
  });

  function renderPreview(preview) {
    clear(previewSummary);
    clear(previewTableWrap);
    clear(previewWarnings);
    previewError.hidden = true;

    previewSummary.appendChild(
      el("div", { class: "preview-count-grid" }, [
        el("div", { class: "preview-count" }, [
          el("strong", { text: String(preview.valid_rows) }),
          el("span", { text: t("import.valid_rows") }),
        ]),
        el("div", { class: "preview-count" }, [
          el("strong", { text: String(preview.skipped_rows) }),
          el("span", { text: t("import.skipped_rows") }),
        ]),
        el("div", { class: "preview-count preview-count-error" }, [
          el("strong", { text: String(preview.error_rows) }),
          el("span", { text: t("import.error_rows") }),
        ]),
        preview.unassigned_bottles > 0
          ? el("div", { class: "preview-count preview-count-warn" }, [
              el("strong", { text: String(preview.unassigned_bottles) }),
              el("span", { text: t("import.unassigned_preview") }),
            ])
          : null,
      ])
    );

    const columns = [
      "producer",
      "cuvee",
      "vintage",
      "appellation",
      "area",
      "color",
      "quantity",
      "format",
      "cellar",
      "location",
    ];
    const table = el("table", { class: "data-table import-preview-table" });
    table.appendChild(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("import.row") }),
          el("th", { text: t("import.preview_status") }),
          ...columns.map((field) => el("th", { text: mappingLabel(field) })),
        ]),
      ])
    );
    const tbody = el("tbody");
    for (const row of preview.preview_rows || []) {
      tbody.appendChild(
        el("tr", { class: `preview-row preview-row-${row.status}` }, [
          el("td", { text: String(row.row) }),
          el("td", {}, [
            el("span", { class: `status-pill status-${row.status}`, text: statusLabel(row.status) }),
          ]),
          ...columns.map((field) =>
            el("td", { text: row.values?.[field] ?? "" })
          ),
        ])
      );
    }
    table.appendChild(tbody);
    previewTableWrap.appendChild(table);

    if (preview.warnings?.length) {
      previewWarnings.appendChild(el("h3", { text: t("import.warnings") }));
      previewWarnings.appendChild(
        el(
          "ul",
          { class: "import-warning-list" },
          preview.warnings.slice(0, 50).map((warning) =>
            el("li", {
              class: warning.severity === "error" ? "warning-error" : "",
              text: `${t("import.row")} ${warning.row}: ${warning.message}`,
            })
          )
        )
      );
      if (preview.warnings.length > 50) {
        previewWarnings.appendChild(
          el("p", { class: "hint", text: t("import.more_warnings", { count: preview.warnings.length - 50 }) })
        );
      }
    }
  }

  importButton.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file || !analysis || !lastPreview) return;
    const mapping = buildMappingPayload(currentSelections());
    importButton.disabled = true;
    importButton.textContent = t("import.importing");
    previewError.hidden = true;
    let completed = false;
    try {
      const report = await api.postForm(
        `/import${cellarQuery(cellarSelect.value)}`,
        createFileForm(file, mapping)
      );
      if (rememberMapping.checked) saveProfile(analysis.headers, mapping);
      completed = true;
      renderImportReport(reportBox, report, () => resetWizard({ focus: true }));
      reportBox.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      previewError.textContent = errorText(error);
      previewError.hidden = false;
    } finally {
      importButton.disabled = completed;
      importButton.textContent = completed ? t("import.completed") : t("import.upload");
    }
  });
}
