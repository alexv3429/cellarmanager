import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, showToast, field, selectEl, formatDate } from "../dom.js";

const COLORS = ["red", "white", "rose", "sparkling", "orange", "fortified", "other"];
const REMOVE_REASONS = ["gifted", "broken", "sold", "lost", "drunk"];

async function loadCellars() {
  return api.get("/cellars");
}

function actionDialog(title, bodyNodes, onConfirm) {
  const overlay = el("div", { class: "modal-overlay" });
  const errorBox = el("p", { class: "form-error", hidden: true });
  const cancelBtn = el("button", { type: "button", text: t("common.cancel"), onclick: () => overlay.remove() });
  const confirmBtn = el("button", { type: "button", class: "primary", text: t("common.confirm") });
  confirmBtn.addEventListener("click", async () => {
    errorBox.hidden = true;
    try {
      await onConfirm();
      overlay.remove();
    } catch (err) {
      errorBox.textContent = err.detail || t("common.error_generic");
      errorBox.hidden = false;
    }
  });
  const modal = el("div", { class: "modal" }, [el("h3", { text: title }), ...bodyNodes, errorBox, el("div", { class: "modal-actions" }, [cancelBtn, confirmBtn])]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

async function openAddDialog(wine, cellars, onDone) {
  const cellarSelect = selectEl([{ value: "", label: t("common.none") }, ...cellars.map((c) => ({ value: c.id, label: c.name }))]);
  const locationInput = el("input", { type: "text" });
  const qtyInput = el("input", { type: "number", min: 1, value: 1 });
  const wineLabel = wine.producer ? `: ${wine.producer}${wine.cuvee ? " - " + wine.cuvee : ""}` : "";
  actionDialog(
    t("bottles.add_bottle") + wineLabel,
    [field(t("bottles.cellar"), cellarSelect), field(t("bottles.location"), locationInput), field(t("bottles.quantity"), qtyInput)],
    async () => {
      const { queued } = await api.mutateOrQueue("holdings/add", "/holdings/add", {
        wine_id: wine.id,
        cellar_id: cellarSelect.value || null,
        location: locationInput.value.trim() || null,
        quantity: Number(qtyInput.value),
      });
      showToast(queued ? t("offline.queued") : t("common.save"));
      onDone();
    }
  );
}

async function openMoveDialog(holding, cellars, onDone) {
  const cellarSelect = selectEl(cellars.map((c) => ({ value: c.id, label: c.name })), { value: holding.cellar_id });
  const locationInput = el("input", { type: "text", value: holding.location || "" });
  const qtyInput = el("input", { type: "number", min: 1, max: holding.quantity, value: holding.quantity });
  actionDialog(
    t("bottles.move_bottle"),
    [field(t("bottles.cellar"), cellarSelect), field(t("bottles.location"), locationInput), field(t("bottles.quantity"), qtyInput)],
    async () => {
      const { queued } = await api.mutateOrQueue("holdings/move", "/holdings/move", {
        holding_id: holding.id,
        quantity: Number(qtyInput.value),
        to_cellar_id: cellarSelect.value,
        to_location: locationInput.value.trim() || null,
      });
      showToast(queued ? t("offline.queued") : t("common.save"));
      onDone();
    }
  );
}

async function openRemoveDialog(holding, onDone) {
  const reasonSelect = selectEl(REMOVE_REASONS.map((r) => ({ value: r, label: t(`remove.${r}`) })));
  const qtyInput = el("input", { type: "number", min: 1, max: holding.quantity, value: 1 });
  actionDialog(t("bottles.remove_bottle"), [field(t("remove.reason"), reasonSelect), field(t("bottles.quantity"), qtyInput)], async () => {
    const { queued } = await api.mutateOrQueue("holdings/remove", "/holdings/remove", {
      holding_id: holding.id,
      quantity: Number(qtyInput.value),
      reason: reasonSelect.value,
    });
    showToast(queued ? t("offline.queued") : t("common.save"));
    onDone();
  });
}

async function openLocationsDialog(wine) {
  const locations = await api.get(`/wines/${wine.id}/locations`);
  const list = locations.length
    ? el(
        "ul",
        {},
        locations.map((loc) => el("li", { text: `${loc.cellar_name || "?"} - ${loc.location || "-"}: ${loc.quantity}` }))
      )
    : el("p", { text: t("bottles.empty_state") });
  actionDialog(t("bottles.locations"), [list], async () => {});
}

/** Fetches from every registered source and shows the combined best
 * estimate, with a transparent per-source breakdown (requirement 5.f/5.g:
 * "fetch several and compute the best window", not pick-one-site). */
function openEnrichDialog(kind, wine) {
  const overlay = el("div", { class: "modal-overlay" });
  const body = el("div", { class: "enrich-body" }, [el("p", { text: t("enrich.fetching") })]);
  const closeBtn = el("button", { type: "button", class: "primary", text: t("common.close"), onclick: () => overlay.remove() });
  const modal = el("div", { class: "modal" }, [
    el("h3", { text: kind === "drinking-window" ? t("bottles.enrich_dates") : t("bottles.enrich_market") }),
    body,
    el("div", { class: "modal-actions" }, [closeBtn]),
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const path = kind === "drinking-window" ? `/wines/${wine.id}/enrich/drinking-window` : `/wines/${wine.id}/enrich/market-info`;

  (async () => {
    let resp;
    try {
      resp = await api.post(path, {});
    } catch (err) {
      clear(body);
      body.appendChild(el("p", { class: "form-error", text: err.detail || t("common.error_generic") }));
      return;
    }
    clear(body);
    if (resp.applied === false) {
      body.appendChild(el("p", { class: "empty-state", text: resp.note || t("enrich.no_data") }));
      return;
    }
    const agg = resp.aggregated;
    const pct = Math.round((agg.confidence || 0) * 100);
    if (kind === "drinking-window") {
      body.appendChild(el("p", { text: t("enrich.window_result", { after: agg.drink_after || "-", before: agg.drink_before || "-" }) }));
    } else {
      body.appendChild(el("p", { text: t("enrich.value_result", { value: agg.market_value != null ? agg.market_value : "-" }) }));
    }
    body.appendChild(el("p", { class: "hint", text: t("enrich.sources", { count: agg.source_count, sources: agg.sources.join(", ") }) }));
    body.appendChild(el("p", { class: "hint", text: t("enrich.confidence", { pct }) }));
    const applied = resp.decisions ? resp.decisions.some((d) => d.applied) : !!(resp.decision && resp.decision.applied);
    body.appendChild(el("p", { class: applied ? "success-note" : "hint", text: applied ? t("enrich.applied", { count: agg.source_count }) : t("enrich.not_applied") }));
  })();
}

/** Photo -> OCR label reading + fuzzy catalog match, combined with
 * photo-hash matching against any reference photos saved before
 * (requirement 7: real label OCR, not just past-photo matching). */
function openScanDialog(cellars, onRecognized) {
  const overlay = el("div", { class: "modal-overlay" });
  const fileInput = el("input", { type: "file", accept: "image/*", capture: "environment" });
  const body = el("div", { class: "scan-body" }, [field(t("scan.choose_photo"), fileInput)]);
  const closeBtn = el("button", { type: "button", text: t("common.close"), onclick: () => overlay.remove() });
  const modal = el("div", { class: "modal scan-modal" }, [el("h3", { text: t("scan.title") }), body, el("div", { class: "modal-actions" }, [closeBtn])]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  fileInput.addEventListener("change", async () => {
    if (!fileInput.files.length) return;
    clear(body);
    body.appendChild(el("p", { text: t("scan.analyzing") }));

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    let result;
    try {
      result = await api.postForm("/photos/recognize", formData);
    } catch (err) {
      clear(body);
      body.appendChild(el("p", { class: "form-error", text: err.detail || t("common.error_generic") }));
      return;
    }

    clear(body);
    if (!result.ocr_available) body.appendChild(el("p", { class: "hint", text: t("scan.ocr_unavailable") }));
    if (!result.photo_match_available) body.appendChild(el("p", { class: "hint", text: t("scan.photo_match_unavailable") }));
    if (result.ocr_text && result.ocr_text.trim()) {
      body.appendChild(el("h3", { text: t("scan.ocr_text") }));
      body.appendChild(el("p", { class: "ocr-text", text: result.ocr_text.trim() }));
    }

    body.appendChild(el("h3", { text: t("scan.matches") }));
    if (!result.matches.length) {
      body.appendChild(el("p", { class: "empty-state", text: t("scan.no_matches") }));
      return;
    }
    for (const m of result.matches) {
      const viaKey =
        m.matched_via.length > 1 ? "scan.matched_via_both" : m.matched_via[0] === "ocr" ? "scan.matched_via_ocr" : "scan.matched_via_photo";
      body.appendChild(
        el("div", { class: "scan-match" }, [
          el("div", { class: "wine-title", text: `${m.producer}${m.cuvee ? " - " + m.cuvee : ""}${m.vintage ? " " + m.vintage : ""}` }),
          el("div", { class: "wine-sub", text: `${Math.round(m.confidence * 100)}% - ${t(viaKey)}` }),
          el("div", { class: "scan-match-actions" }, [
            el("button", {
              class: "small primary",
              text: t("common.add"),
              onclick: () => {
                overlay.remove();
                openAddDialog({ id: m.wine_id, producer: m.producer, cuvee: m.cuvee }, cellars, onRecognized);
              },
            }),
            el("button", {
              class: "small",
              text: t("scan.register_photo"),
              onclick: async () => {
                const fd = new FormData();
                fd.append("file", fileInput.files[0]);
                await api.postForm(`/wines/${m.wine_id}/photos`, fd);
                showToast(t("scan.registered"));
              },
            }),
          ]),
        ])
      );
    }
  });
}

function wineRow(wine, holdingsForWine, cellars, cellarsById, onChanged) {
  const totalQty = holdingsForWine.reduce((sum, h) => sum + h.quantity, 0);
  const row = el("div", { class: "wine-row" });
  row.appendChild(
    el("div", { class: "wine-row-main" }, [
      el("div", { class: "wine-title", text: `${wine.producer}${wine.cuvee ? " - " + wine.cuvee : ""}` }),
      el("div", { class: "wine-sub", text: [wine.appellation, wine.vintage || "NV", wine.area].filter(Boolean).join(" - ") }),
    ])
  );
  row.appendChild(el("div", { class: `swatch-tag swatch-${wine.color}`, text: t(`color.${wine.color}`) || wine.color }));
  row.appendChild(el("div", { class: "wine-qty", text: t("common.bottles_count", { count: totalQty }) }));

  const actions = el("div", { class: "wine-actions" });
  actions.appendChild(el("button", { class: "small", text: t("common.add"), onclick: () => openAddDialog(wine, cellars, onChanged) }));
  if (holdingsForWine[0]) {
    actions.appendChild(el("button", { class: "small", text: t("common.move"), onclick: () => openMoveDialog(holdingsForWine[0], cellars, onChanged) }));
    actions.appendChild(el("button", { class: "small danger", text: t("common.remove"), onclick: () => openRemoveDialog(holdingsForWine[0], onChanged) }));
  }
  actions.appendChild(el("button", { class: "small", text: t("bottles.locations"), onclick: () => openLocationsDialog(wine) }));
  actions.appendChild(el("button", { class: "small", text: t("bottles.enrich_dates"), onclick: () => openEnrichDialog("drinking-window", wine) }));
  actions.appendChild(el("button", { class: "small", text: t("bottles.enrich_market"), onclick: () => openEnrichDialog("market-info", wine) }));
  row.appendChild(actions);
  return row;
}

export async function renderBottles(container) {
  container.appendChild(el("h1", { text: t("bottles.title") }));

  const cellars = await loadCellars();

  container.appendChild(
    el("button", { class: "primary scan-cta", text: `\u{1F4F7} ${t("bottles.scan_photo")}`, onclick: () => openScanDialog(cellars, refreshBottlesList) })
  );

  const searchInput = el("input", { type: "search", placeholder: t("bottles.filter") });
  const colorSelect = selectEl([{ value: "", label: t("common.all_cellars") }, ...COLORS.map((c) => ({ value: c, label: t(`color.${c}`) }))]);
  const filters = el("div", { class: "filter-bar" }, [searchInput, colorSelect]);
  container.appendChild(filters);

  const results = el("div", { class: "wine-list" });
  container.appendChild(results);

  const cellarsById = Object.fromEntries(cellars.map((c) => [c.id, c]));

  async function refreshBottlesList() {
    clear(results);
    const wines = await api.get(`/wines${searchInput.value ? "?search=" + encodeURIComponent(searchInput.value) : ""}`);
    const holdings = await api.get("/holdings?state=in_cellar");
    const holdingsByWine = {};
    for (const h of holdings) {
      if (h.quantity <= 0) continue;
      (holdingsByWine[h.wine_id] = holdingsByWine[h.wine_id] || []).push(h);
    }
    const filtered = wines.filter((w) => !colorSelect.value || w.color === colorSelect.value);
    if (!filtered.length) {
      results.appendChild(el("p", { class: "empty-state", text: t("bottles.empty_state") }));
      return;
    }
    for (const wine of filtered) {
      results.appendChild(wineRow(wine, holdingsByWine[wine.id] || [], cellars, cellarsById, refreshBottlesList));
    }
  }

  searchInput.addEventListener("input", () => refreshBottlesList());
  colorSelect.addEventListener("change", () => refreshBottlesList());
  await refreshBottlesList();
}
