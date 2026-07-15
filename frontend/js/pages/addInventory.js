import * as api from "../api.js";
import { clear, el, field, selectEl, showToast } from "../dom.js";
import { parseChatGPTJson } from "./addInventoryJson.js";

const SOURCE_LABELS = {
  user: ["User-entered", "Saisi par l’utilisateur"],
  ai: ["AI suggested", "Suggéré par l’IA"],
  matched: ["Matched existing", "Correspondance existante"],
  conflict: ["Conflicting", "En conflit"],
  unknown: ["Unknown", "Inconnu"],
};

const COPY = {
  title: ["Add inventory", "Ajouter au stock"],
  choose: ["How would you like to start?", "Comment souhaitez-vous commencer ?"],
  manual: ["Manual form", "Formulaire manuel"],
  manualHelp: ["No picture or AI required. Available offline.", "Aucune photo ni IA requise. Disponible hors ligne."],
  photo: ["Photo with AI assistance", "Photo avec assistance IA"],
  photoHelp: ["Attach label photos, optionally analyse them, then review every field.", "Ajoutez des photos d’étiquette, analysez-les si souhaité, puis vérifiez chaque champ."],
  existing: ["Add more of an existing wine", "Ajouter un vin existant"],
  existingHelp: ["Search the catalog and record a new acquisition without duplicating the wine.", "Recherchez le catalogue et enregistrez une nouvelle acquisition sans dupliquer le vin."],
  chatgpt: ["Manual ChatGPT assistance", "Assistance ChatGPT manuelle"],
  chatgptHelp: ["Copy the research prompt, upload photos to ChatGPT, then paste the returned JSON.", "Copiez le prompt de recherche, envoyez les photos à ChatGPT, puis collez le JSON retourné."],
  back: ["Back", "Retour"],
  next: ["Next", "Suivant"],
  save: ["Save inventory", "Enregistrer le stock"],
  cancel: ["Cancel", "Annuler"],
  edit: ["Edit", "Modifier"],
  accept: ["Accept", "Accepter"],
  clear: ["Clear", "Effacer"],
  useAi: ["Use AI value", "Utiliser la valeur IA"],
  identity: ["Bottle identity", "Identité de la bouteille"],
  stock: ["Quantity and storage", "Quantité et stockage"],
  optional: ["Optional details", "Détails facultatifs"],
  review: ["Review", "Vérification"],
};

const STANDARD_TYPES = [
  ["red", "Red", "Rouge"],
  ["white", "White", "Blanc"],
  ["rose", "Rosé", "Rosé"],
  ["sparkling", "Sparkling", "Effervescent"],
  ["orange", "Orange", "Orange"],
  ["fortified", "Fortified", "Fortifié"],
  ["other", "Other", "Autre"],
];

const STANDARD_FORMATS = new Map([
  ["18.7cl", 187],
  ["20cl", 200],
  ["37.5cl", 375],
  ["50cl", 500],
  ["70cl", 700],
  ["75cl", 750],
  ["1l", 1000],
  ["1.5l", 1500],
  ["3l", 3000],
  ["4.5l", 4500],
  ["6l", 6000],
]);

const ENRICHMENT_FIELDS = {
  drinking_window_start: { local: "drinkAfter", label: ["Drinking window start", "Début de fenêtre de dégustation"], kind: "year" },
  drinking_window_end: { local: "drinkBefore", label: ["Drinking window end", "Fin de fenêtre de dégustation"], kind: "year" },
  serving_advice: { local: "servingAdvice", label: ["Serving advice", "Conseils de service"], kind: "text" },
  pairings: { local: "pairings", label: ["Pairings", "Accords mets-vins"], kind: "list" },
  review_summary: { local: "reviewSummary", label: ["Review summary", "Résumé des avis"], kind: "text" },
};

function isFr() {
  return (document.documentElement.lang || "en").toLowerCase().startsWith("fr");
}
function L(key) {
  const pair = COPY[key];
  return pair ? pair[isFr() ? 1 : 0] : key;
}
function text(en, fr) {
  return isFr() ? fr : en;
}
function labelPair(pair) {
  return pair[isFr() ? 1 : 0];
}
function newClientOpId() {
  if (globalThis.crypto?.randomUUID) return `op-${globalThis.crypto.randomUUID()}`;
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
function normalise(value) {
  return String(value || "").trim().toLocaleLowerCase();
}
function unique(values) {
  const seen = new Map();
  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean) continue;
    const key = normalise(clean);
    if (!seen.has(key)) seen.set(key, clean);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && value !== false
    && (!Array.isArray(value) || value.length > 0);
}

function injectStyles() {
  if (document.getElementById("add-inventory-styles")) return;
  const style = document.createElement("style");
  style.id = "add-inventory-styles";
  style.textContent = `
    .inventory-modal{width:min(980px,96vw);max-height:94dvh;display:flex;flex-direction:column;overflow:hidden;padding:0}
    .inventory-modal-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex:0 0 auto;padding:1rem 1.25rem .7rem;background:var(--parchment-card,var(--surface,#fff));border-bottom:1px solid var(--border,#ddd);z-index:4}
    .inventory-modal-header h2{margin:0;min-width:0}.inventory-modal-close{width:2.5rem;min-width:2.5rem;height:2.5rem;padding:0;font-size:1.35rem;line-height:1}
    .inventory-modal-body{min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:.75rem 1.25rem 1.25rem}
    .inventory-paths{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.8rem}
    .inventory-path{padding:1rem;text-align:left;border:1px solid var(--border,#ccc);border-radius:.7rem;background:var(--surface,#fff)}
    .inventory-path strong{display:block;margin-bottom:.35rem}.inventory-path small{opacity:.75}
    .inventory-steps{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;gap:.4rem;margin:-.1rem 0 .8rem;padding:.45rem 0;background:var(--parchment-card,var(--surface,#fff));border-bottom:1px solid transparent}
    .inventory-step{white-space:nowrap;font-size:.82rem}.inventory-step.active{font-weight:700;border-color:currentColor}
    .inventory-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.inventory-grid .wide{grid-column:1/-1}
    .inventory-core{padding:.1rem 0 .45rem}.inventory-required-note{font-size:.82rem;opacity:.72;margin:.1rem 0 .75rem}
    .inventory-more{margin:.85rem 0;border:1px solid var(--border,#d5d0c5);border-radius:.6rem;background:color-mix(in srgb,var(--surface,#fff) 94%,transparent)}
    .inventory-more>summary{cursor:pointer;font-weight:650;padding:.75rem .9rem}.inventory-more[open]>summary{border-bottom:1px solid var(--border,#d5d0c5)}
    .inventory-more-content{padding:.85rem}.inventory-source-row{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
    .inventory-source{font-size:.72rem;padding:.12rem .42rem;border-radius:999px;background:#e8e8e8}.inventory-source.ai{background:#e8e4ff}.inventory-source.matched{background:#dcf5e5}.inventory-source.conflict{background:#ffe1df}.inventory-source.unknown{background:#eee}
    .inventory-inline-actions{display:inline-flex;gap:.25rem;flex-wrap:wrap}.inventory-inline-actions button{font-size:.72rem;padding:.18rem .42rem}
    .inventory-search-results,.inventory-duplicates{display:grid;gap:.45rem;margin-top:.6rem}.inventory-result{display:flex;justify-content:space-between;gap:.8rem;align-items:center;padding:.65rem;border:1px solid var(--border,#ccc);border-radius:.5rem}
    .inventory-hint{font-size:.86rem;opacity:.78}.inventory-summary{display:grid;gap:.7rem}.inventory-summary section{padding:.75rem;border:1px solid var(--border,#ccc);border-radius:.55rem}
    .inventory-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.inventory-file-current{font-size:.78rem;opacity:.78;margin:.2rem 0 0}
    .inventory-error{color:var(--danger,#b00020);white-space:pre-wrap}.inventory-chatgpt textarea{min-height:220px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .inventory-prompt{max-height:260px;overflow:auto;white-space:pre-wrap;background:var(--surface-muted,#f3f3f3);padding:.7rem;border-radius:.4rem;font-size:.78rem}
    .inventory-chatgpt-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin:.7rem 0}.inventory-enrichment-list{margin:.35rem 0 0;padding-left:1.2rem}
    @media(max-width:680px){.inventory-modal{width:calc(100vw - 1rem);max-height:96dvh}.inventory-modal-header{padding:.85rem 1rem .65rem}.inventory-modal-body{padding:.65rem 1rem 1rem;scrollbar-gutter:auto}.inventory-grid,.inventory-media-grid{grid-template-columns:1fr}.inventory-grid .wide{grid-column:auto}.inventory-steps{gap:.3rem}.inventory-step{font-size:.76rem;padding:.38rem .55rem}}
  `;
  document.head.appendChild(style);
}

function input(type = "text", value = "") {
  return el("input", { type, value });
}
function textarea(value = "") {
  const node = el("textarea");
  node.value = value;
  return node;
}
function sourceBadge(source) {
  const labels = SOURCE_LABELS[source] || SOURCE_LABELS.unknown;
  return el("span", { class: `inventory-source ${source}`, text: labels[isFr() ? 1 : 0] });
}

function trackedField(state, name, label, control, { wide = false, required = false } = {}) {
  const markUser = () => {
    state.sources[name] = "user";
    delete state.aiSuggestions[name];
  };
  control.addEventListener("input", markUser);
  control.addEventListener("change", markUser);

  const source = state.sources[name] || "unknown";
  const actions = el("span", { class: "inventory-inline-actions" });
  if (source === "ai" || source === "conflict") {
    actions.appendChild(el("button", { type: "button", text: L("edit"), onclick: () => {
      control.focus();
      control.select?.();
    } }));
  }
  if (source === "ai") {
    actions.appendChild(el("button", { type: "button", text: L("accept"), onclick: () => {
      state.sources[name] = "user";
      delete state.aiSuggestions[name];
      state.render();
    } }));
  }
  if (source === "conflict" && Object.hasOwn(state.aiSuggestions, name)) {
    actions.appendChild(el("button", { type: "button", text: L("useAi"), onclick: () => {
      state.values[name] = state.aiSuggestions[name];
      state.sources[name] = "ai";
      delete state.aiSuggestions[name];
      state.render();
    } }));
  }
  if (source === "ai" || source === "conflict" || hasValue(state.values[name])) {
    actions.appendChild(el("button", { type: "button", text: L("clear"), onclick: () => {
      if (control.type === "checkbox") control.checked = false;
      else control.value = "";
      state.values[name] = control.type === "checkbox" ? false : "";
      state.sources[name] = "unknown";
      delete state.aiSuggestions[name];
      state.render();
    } }));
  }

  const labelNodes = [el("span", { text: `${label}${required ? " *" : ""}` })];
  if (source !== "unknown") labelNodes.push(sourceBadge(source));
  if (actions.childNodes.length) labelNodes.push(actions);
  if (source === "conflict" && Object.hasOwn(state.aiSuggestions, name)) {
    const suggestion = typeof state.aiSuggestions[name] === "object"
      ? JSON.stringify(state.aiSuggestions[name])
      : String(state.aiSuggestions[name]);
    labelNodes.push(el("small", { class: "inventory-conflict-value", text: `${text("AI", "IA")}: ${suggestion}` }));
  }
  const labelRow = el("div", { class: "inventory-source-row" }, labelNodes);
  const wrapper = field("", control);
  wrapper.classList.toggle("wide", wide);
  wrapper.prepend(labelRow);
  for (const extra of control._inventoryExtras || []) wrapper.appendChild(extra);
  return wrapper;
}

function bind(state, name, control, parser = (value) => value) {
  if (control.type === "checkbox") control.checked = !!state.values[name];
  else control.value = state.values[name] ?? "";
  const eventName = control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input";
  control.addEventListener(eventName, () => {
    state.values[name] = control.type === "checkbox" ? control.checked : parser(control.value);
  });
  return control;
}

function optionSelect(options, value) {
  return selectEl(options.map(([v, label]) => ({ value: v, label })), { value: value ?? "" });
}

function setDatalistOptions(datalist, values) {
  clear(datalist);
  const seen = new Set();
  for (const item of values) {
    const value = String(typeof item === "object" ? item.value : item || "").trim();
    if (!value) continue;
    const key = normalise(value);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof item === "object" ? item.label : null;
    datalist.appendChild(el("option", { value, label }));
  }
}

function choiceInput(state, name, values, placeholder = "") {
  const control = input();
  const datalist = el("datalist", { id: `${state.formId}-${name}-choices` });
  control.setAttribute("list", datalist.id);
  control.placeholder = placeholder;
  control.autocomplete = "off";
  control._inventoryExtras = [datalist];
  control._setChoices = (nextValues) => setDatalistOptions(datalist, nextValues);
  control._setChoices(values);
  return control;
}

function catalogueContext(state, producer = state.values.producer, cuvee = state.values.cuvee) {
  let wines = state.catalogWines || [];
  const producerKey = normalise(producer);
  if (!producerKey) return [];
  const exact = wines.filter((wine) => normalise(wine.producer) === producerKey);
  wines = exact.length ? exact : [];
  const cuveeKey = normalise(cuvee);
  if (cuveeKey) {
    const exact = wines.filter((wine) => normalise(wine.cuvee) === cuveeKey);
    if (exact.length) wines = exact;
  }
  return wines;
}

function contextFirst(contextValues, standardValues) {
  const contextKeys = new Set(contextValues.map(normalise));
  return [...unique(contextValues), ...unique(standardValues).filter((value) => !contextKeys.has(normalise(value)))];
}

async function ensureCatalogue(state) {
  if (state.catalogLoaded) return;
  state.catalogLoaded = true;
  try {
    const wines = await api.get("/wines");
    state.catalogWines = Array.isArray(wines) ? wines : [];
  } catch {
    state.catalogWines = [];
  }
}

function applySuggestedValue(state, name, value, source) {
  const current = state.values[name];
  const currentSource = state.sources[name] || "unknown";
  const meaningful = current !== undefined && current !== null && current !== "";
  if (source === "ai" && meaningful && currentSource !== "unknown" && JSON.stringify(current) !== JSON.stringify(value)) {
    state.aiSuggestions[name] = value;
    state.sources[name] = "conflict";
    return;
  }
  state.values[name] = value;
  state.sources[name] = source;
  delete state.aiSuggestions[name];
}

function applyPrefill(state, prefill, source = "ai") {
  const identity = prefill.identity || {};
  const map = {
    producer: "producer",
    cuvee: "cuvee",
    vintage: "vintage",
    non_vintage: "nonVintage",
    wine_type: "wineType",
    format: "format",
    format_ml: "formatMl",
    country: "country",
    region: "region",
    appellation: "appellation",
    classification: "classification",
    vineyard: "vineyard",
    sweetness: "sweetness",
    alcohol_percentage: "alcohol",
    barcode: "barcode",
  };
  for (const [incoming, local] of Object.entries(map)) {
    if (identity[incoming] !== undefined && identity[incoming] !== null && identity[incoming] !== "") {
      applySuggestedValue(state, local, identity[incoming], source);
    }
  }
  if (identity.grapes?.length) applySuggestedValue(state, "grapes", identity.grapes.join(", "), source);
  if (identity.certifications?.length) applySuggestedValue(state, "certifications", identity.certifications.join(", "), source);
  if (identity.external_identifiers && Object.keys(identity.external_identifiers).length) {
    applySuggestedValue(state, "externalIdentifiers", JSON.stringify(identity.external_identifiers, null, 2), source);
  }

  state.otherEnrichmentCandidates = [];
  for (const candidate of prefill.enrichment_candidates || []) {
    const config = ENRICHMENT_FIELDS[candidate.topic];
    if (!config) {
      state.otherEnrichmentCandidates.push(candidate);
      continue;
    }
    const value = config.kind === "list" && Array.isArray(candidate.value)
      ? candidate.value.join(", ")
      : candidate.value;
    applySuggestedValue(state, config.local, value, source);
    state.enrichmentMeta[candidate.topic] = candidate;
  }
}

function buildEnrichmentCandidates(state) {
  const candidates = [...state.otherEnrichmentCandidates];
  for (const [topic, config] of Object.entries(ENRICHMENT_FIELDS)) {
    let value = state.values[config.local];
    if (!hasValue(value)) continue;
    if (config.kind === "year") value = Number(value);
    if (config.kind === "list") value = String(value).split(",").map((item) => item.trim()).filter(Boolean);
    const original = state.enrichmentMeta[topic] || {};
    candidates.push({
      topic,
      label: original.label || labelPair(config.label),
      value,
      confidence: original.confidence ?? 0.5,
      rationale: original.rationale || text("Entered or reviewed in Add inventory", "Saisi ou vérifié dans Ajouter au stock"),
      evidence_links: original.evidence_links || [],
    });
  }
  return candidates;
}

function buildPayload(state) {
  const numberOrNull = (value) => value === "" || value == null ? null : Number(value);
  const list = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  let identifiers = {};
  if (String(state.values.externalIdentifiers || "").trim()) {
    try {
      identifiers = JSON.parse(state.values.externalIdentifiers);
    } catch {
      throw new Error(text("External identifiers must be valid JSON.", "Les identifiants externes doivent être un JSON valide."));
    }
  }
  const quantity = Number(state.values.quantity || 0);
  if (!state.values.existingWineId && !String(state.values.producer || "").trim()) {
    throw new Error(text("Producer is required.", "Le producteur est obligatoire."));
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(text("Quantity must be a positive whole number.", "La quantité doit être un entier positif."));
  }
  const wineType = String(state.values.wineType || "other").trim().toLocaleLowerCase().replaceAll(" ", "_");
  return {
    identity: {
      existing_wine_id: state.values.existingWineId || null,
      producer: state.values.existingWineId ? null : String(state.values.producer || "").trim(),
      cuvee: state.values.cuvee || null,
      vintage: state.values.nonVintage ? null : numberOrNull(state.values.vintage),
      non_vintage: !!state.values.nonVintage,
      wine_type: wineType || "other",
      format: state.values.format || "75cl",
      format_ml: Number(state.values.formatMl || STANDARD_FORMATS.get(normalise(state.values.format)) || 750),
      country: state.values.country || null,
      region: state.values.region || null,
      appellation: state.values.appellation || null,
      classification: state.values.classification || null,
      vineyard: state.values.vineyard || null,
      sweetness: state.values.sweetness || null,
      alcohol_percentage: numberOrNull(state.values.alcohol),
      grapes: list(state.values.grapes),
      certifications: list(state.values.certifications),
      external_identifiers: identifiers,
      barcode: state.values.barcode || null,
      notes: state.values.wineNotes || null,
      field_sources: Object.fromEntries(Object.entries(state.sources).map(([key, value]) => [key, value])),
    },
    acquisition: {
      quantity,
      price_mode: state.values.priceMode || "per_bottle",
      amount: numberOrNull(state.values.amount),
      currency: String(state.values.currency || "EUR").toUpperCase(),
      purchase_date: state.values.purchaseDate || null,
      vendor: state.values.vendor || null,
      tax_included: state.values.taxIncluded === "" ? null : state.values.taxIncluded === "true",
      fees: Number(state.values.fees || 0),
      shipping: Number(state.values.shipping || 0),
      acquisition_type: state.values.acquisitionType || "purchase",
      invoice_reference: state.values.invoiceReference || null,
      notes: state.values.acquisitionNotes || null,
      fill_level: state.values.fillLevel || null,
      label_condition: state.values.labelCondition || null,
      capsule_condition: state.values.capsuleCondition || null,
      bottle_condition: state.values.bottleCondition || null,
      provenance: state.values.provenance || null,
      storage_history: state.values.storageHistory || null,
      original_case: state.values.originalCase === "" ? null : state.values.originalCase === "true",
      serial_number: state.values.serialNumber || null,
      personal_notes: state.values.personalNotes || null,
      tags: list(state.values.tags),
    },
    storage: {
      cellar_id: state.values.cellarId || null,
      location: state.values.location || null,
      quantity,
    },
    enrichment_candidates: buildEnrichmentCandidates(state),
    client_op_id: state.clientOpId,
  };
}

function hasMedia(state) {
  return Object.values(state.media).some((file) => file instanceof File);
}

function pathChooser(state) {
  const paths = [
    ["manual", "✍️", L("manual"), L("manualHelp")],
    ["photo", "📷", L("photo"), L("photoHelp")],
    ["existing", "➕", L("existing"), L("existingHelp")],
    ["chatgpt", "💬", L("chatgpt"), L("chatgptHelp")],
  ];
  return el("div", {}, [
    el("h3", { text: L("choose") }),
    el("div", { class: "inventory-paths" }, paths.map(([id, icon, title, help]) =>
      el("button", { type: "button", class: "inventory-path", onclick: () => {
        state.path = id;
        state.stage = id === "manual" ? "wizard" : "prepare";
        state.step = 0;
        state.render();
      } }, [el("strong", { text: `${icon} ${title}` }), el("small", { text: help })])
    )),
  ]);
}

async function renderExistingSearch(state, body) {
  const search = input("search");
  search.placeholder = text("Producer, cuvée, appellation…", "Producteur, cuvée, appellation…");
  const results = el("div", { class: "inventory-search-results" });
  let timer;
  async function run() {
    clear(results);
    const wines = await api.get(`/wines${search.value.trim() ? `?search=${encodeURIComponent(search.value.trim())}` : ""}`);
    for (const wine of wines.slice(0, 20)) {
      results.appendChild(el("div", { class: "inventory-result" }, [
        el("div", {}, [
          el("strong", { text: `${wine.producer}${wine.cuvee ? ` — ${wine.cuvee}` : ""}` }),
          el("div", { class: "inventory-hint", text: [wine.appellation, wine.vintage || "NV", wine.format].filter(Boolean).join(" · ") }),
        ]),
        el("button", { type: "button", class: "primary", text: text("Select", "Sélectionner"), onclick: () => {
          selectExistingWine(state, wine);
          state.stage = "wizard";
          state.step = 1;
          state.render();
        } }),
      ]));
    }
  }
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => run().catch((err) => { results.textContent = err.message; }), 180);
  });
  body.append(el("h3", { text: L("existing") }), search, results);
  await run();
}

function selectExistingWine(state, wine) {
  state.values.existingWineId = wine.id;
  state.values.producer = wine.producer;
  state.values.cuvee = wine.cuvee || "";
  state.values.appellation = wine.appellation || "";
  state.values.vintage = wine.vintage || "";
  state.values.nonVintage = wine.vintage == null;
  state.values.wineType = wine.color || "other";
  state.values.region = wine.area || "";
  state.values.format = wine.format || "75cl";
  state.values.formatMl = wine.format_ml || STANDARD_FORMATS.get(normalise(wine.format)) || 750;
  state.aiSuggestions = {};
  for (const key of ["producer", "cuvee", "appellation", "vintage", "nonVintage", "wineType", "region", "format", "formatMl"]) {
    state.sources[key] = "matched";
  }
}

async function renderChatGPTPrepare(state, body) {
  body.classList.add("inventory-chatgpt");
  const info = await api.get("/inventory/manual-chatgpt-template");
  const copyText = `${info.prompt}\n\nJSON Schema:\n${JSON.stringify(info.json_schema, null, 2)}`;
  const promptBox = el("pre", { class: "inventory-prompt", text: copyText });
  const preview = el("details", { class: "inventory-more" }, [
    el("summary", { text: text("Show prompt and JSON schema", "Afficher le prompt et le schéma JSON") }),
    el("div", { class: "inventory-more-content" }, [promptBox]),
  ]);
  const paste = textarea();
  paste.placeholder = text("Paste the complete ChatGPT JSON object here", "Collez ici l’objet JSON complet de ChatGPT");
  paste.spellcheck = false;
  paste.autocapitalize = "off";
  paste.autocomplete = "off";
  const error = el("p", { class: "inventory-error", hidden: true });
  const actions = el("div", { class: "inventory-chatgpt-actions" }, [
    el("button", { type: "button", text: text("Copy research prompt", "Copier le prompt de recherche"), onclick: async () => {
      await navigator.clipboard.writeText(copyText);
      showToast(text("Copied", "Copié"));
    } }),
  ]);
  if (navigator.clipboard?.readText) {
    actions.appendChild(el("button", { type: "button", text: text("Paste from clipboard", "Coller depuis le presse-papiers"), onclick: async () => {
      paste.value = await navigator.clipboard.readText();
    } }));
  }
  body.append(
    el("h3", { text: L("chatgpt") }),
    el("p", { class: "inventory-hint", text: text(
      "The prompt asks ChatGPT to identify the bottle and research drinking window, serving advice, pairings and reviews. Upload the photos there, then paste the complete object from { to }. Code fences and smart quotes are accepted.",
      "Le prompt demande à ChatGPT d’identifier la bouteille et de rechercher la fenêtre de dégustation, le service, les accords et les avis. Envoyez-y les photos, puis collez l’objet complet de { à }. Les blocs de code et guillemets typographiques sont acceptés."
    ) }),
    actions,
    preview,
    paste,
    error,
    el("button", { type: "button", class: "primary", text: text("Validate and populate form", "Valider et remplir le formulaire"), onclick: async () => {
      error.hidden = true;
      try {
        const parsed = parseChatGPTJson(paste.value);
        const prefill = await api.post("/inventory/manual-chatgpt-validate", parsed);
        applyPrefill(state, prefill);
        state.stage = "wizard";
        state.step = 0;
        state.render();
      } catch (err) {
        const prefix = err instanceof SyntaxError
          ? text("The pasted response is not valid JSON. Paste the complete object, including its opening and closing braces. ", "La réponse collée n’est pas un JSON valide. Collez l’objet complet, avec ses accolades ouvrante et fermante. ")
          : "";
        error.textContent = `${prefix}${err.message}`;
        error.hidden = false;
      }
    } }),
  );
}

async function renderPhotoPrepare(state, body) {
  const front = input("file");
  front.accept = "image/*";
  front.capture = "environment";
  const back = input("file");
  back.accept = "image/*";
  back.capture = "environment";
  const capsule = input("file");
  capsule.accept = "image/*";
  capsule.capture = "environment";
  const error = el("p", { class: "inventory-error", hidden: true });
  const status = await api.get("/inventory/vision/status");
  const collect = () => [front.files[0], back.files[0], capsule.files[0]].filter(Boolean);
  body.append(
    el("h3", { text: L("photo") }),
    field(text("Front label", "Étiquette avant"), front),
    field(text("Back label", "Contre-étiquette"), back),
    field(text("Capsule or neck label", "Capsule ou collerette"), capsule),
    el("p", { class: "inventory-hint", text: status.configured
      ? text("Automatic analysis is configured. All suggestions remain editable.", "L’analyse automatique est configurée. Toutes les suggestions restent modifiables.")
      : text("No API credentials are configured. Continue manually or use the Manual ChatGPT path.", "Aucun identifiant API n’est configuré. Continuez manuellement ou utilisez le parcours ChatGPT manuel.") }),
    error,
    el("div", { class: "modal-actions" }, [
      el("button", { type: "button", onclick: () => {
        for (const [key, node] of [["front_label", front], ["back_label", back], ["capsule", capsule]]) {
          if (node.files[0]) state.media[key] = node.files[0];
        }
        state.stage = "wizard";
        state.step = 0;
        state.render();
      }, text: text("Continue without analysis", "Continuer sans analyse") }),
      el("button", { type: "button", class: "primary", disabled: !status.configured, text: text("Analyse photos", "Analyser les photos"), onclick: async () => {
        const files = collect();
        if (!files.length) {
          error.textContent = text("Choose at least one photo.", "Choisissez au moins une photo.");
          error.hidden = false;
          return;
        }
        const fd = new FormData();
        for (const file of files) fd.append("files", file);
        try {
          const prefill = await api.postForm("/inventory/vision-prefill", fd);
          applyPrefill(state, prefill);
          for (const [key, node] of [["front_label", front], ["back_label", back], ["capsule", capsule]]) {
            if (node.files[0]) state.media[key] = node.files[0];
          }
          state.stage = "wizard";
          state.step = 0;
          state.render();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      } }),
    ]),
  );
}

function detailsSection(summary, content, open = false) {
  const node = el("details", { class: "inventory-more" }, [
    el("summary", { text: summary }),
    el("div", { class: "inventory-more-content" }, [content]),
  ]);
  node.open = open;
  return node;
}

function identityStep(state) {
  const v = state.values;
  const producerChoices = unique((state.catalogWines || []).map((wine) => wine.producer));
  const producer = choiceInput(state, "producer", producerChoices, text("Select or type a producer", "Sélectionnez ou saisissez un producteur"));
  const initialContext = catalogueContext(state);
  const cuvee = choiceInput(state, "cuvee", initialContext.map((wine) => wine.cuvee), text("Select or type a cuvée", "Sélectionnez ou saisissez une cuvée"));
  const typeChoices = contextFirst(initialContext.map((wine) => wine.color), STANDARD_TYPES.map(([value]) => value))
    .map((value) => {
      const standard = STANDARD_TYPES.find(([candidate]) => candidate === value);
      return { value, label: standard ? text(standard[1], standard[2]) : value };
    });
  const wineType = choiceInput(state, "wineType", typeChoices, text("Select or type a wine type", "Sélectionnez ou saisissez un type de vin"));
  const formatChoices = contextFirst(initialContext.map((wine) => wine.format), [...STANDARD_FORMATS.keys()]);
  const format = choiceInput(state, "format", formatChoices, text("Select or type a format", "Sélectionnez ou saisissez un format"));
  const vintage = input("number");
  vintage.min = "1000";
  vintage.max = "3000";
  const nonVintage = input("checkbox");

  for (const [name, control] of [["producer", producer], ["cuvee", cuvee], ["wineType", wineType], ["format", format], ["vintage", vintage], ["nonVintage", nonVintage]]) {
    bind(state, name, control);
    if (v.existingWineId) control.disabled = true;
  }
  vintage.disabled = !!v.nonVintage || !!v.existingWineId;

  const refreshContextChoices = () => {
    const context = catalogueContext(state, producer.value, cuvee.value);
    cuvee._setChoices(catalogueContext(state, producer.value, "").map((wine) => wine.cuvee));
    wineType._setChoices(
      contextFirst(context.map((wine) => wine.color), STANDARD_TYPES.map(([value]) => value))
        .map((value) => {
          const standard = STANDARD_TYPES.find(([candidate]) => candidate === value);
          return { value, label: standard ? text(standard[1], standard[2]) : value };
        }),
    );
    format._setChoices(contextFirst(context.map((wine) => wine.format), [...STANDARD_FORMATS.keys()]));
  };
  producer.addEventListener("input", refreshContextChoices);
  cuvee.addEventListener("input", refreshContextChoices);
  format.addEventListener("change", () => {
    const context = catalogueContext(state, producer.value, cuvee.value);
    const matched = context.find((wine) => normalise(wine.format) === normalise(format.value));
    const ml = matched?.format_ml || STANDARD_FORMATS.get(normalise(format.value));
    if (ml) state.values.formatMl = ml;
  });
  nonVintage.addEventListener("change", () => {
    if (nonVintage.checked) {
      state.values.vintage = "";
      vintage.value = "";
      vintage.disabled = true;
    } else if (!v.existingWineId) {
      vintage.disabled = false;
    }
  });

  const core = el("div", { class: "inventory-core" }, [
    el("p", { class: "inventory-required-note", text: text("Only the essential identity fields are shown. Choose an existing suggestion or type a new value.", "Seuls les champs d’identité essentiels sont affichés. Choisissez une suggestion existante ou saisissez une nouvelle valeur.") }),
    el("div", { class: "inventory-grid" }, [
      trackedField(state, "producer", text("Producer", "Producteur"), producer, { required: true }),
      trackedField(state, "cuvee", text("Wine / cuvée name", "Nom du vin / cuvée"), cuvee),
      trackedField(state, "vintage", text("Vintage", "Millésime"), vintage),
      trackedField(state, "nonVintage", text("Non-vintage", "Sans millésime"), nonVintage),
      trackedField(state, "wineType", text("Wine color / type", "Couleur / type"), wineType),
      trackedField(state, "format", text("Bottle format", "Format de bouteille"), format),
    ]),
  ]);

  const advancedNames = ["country", "region", "appellation", "classification", "vineyard", "sweetness", "alcohol", "grapes", "certifications", "barcode", "externalIdentifiers", "wineNotes", "formatMl"];
  const advanced = el("div", { class: "inventory-grid" });
  const context = catalogueContext(state);
  const fields = [
    ["country", text("Country", "Pays"), choiceInput(state, "country", context.map((wine) => wine.country))],
    ["region", text("Region", "Région"), choiceInput(state, "region", context.map((wine) => wine.area))],
    ["appellation", text("Appellation", "Appellation"), choiceInput(state, "appellation", context.map((wine) => wine.appellation))],
    ["classification", text("Classification", "Classement"), input()],
    ["vineyard", text("Vineyard", "Vignoble / parcelle"), input()],
    ["sweetness", text("Sweetness", "Sucrosité"), input()],
    ["alcohol", text("Alcohol %", "Alcool %"), input("number")],
    ["formatMl", text("Format (ml)", "Format (ml)"), input("number")],
    ["grapes", text("Grapes (comma-separated)", "Cépages (séparés par des virgules)"), input()],
    ["certifications", text("Certifications", "Certifications"), input()],
    ["barcode", text("Barcode", "Code-barres"), input()],
    ["externalIdentifiers", text("External identifiers (JSON)", "Identifiants externes (JSON)"), textarea(), true],
    ["wineNotes", text("Wine notes", "Notes sur le vin"), textarea(), true],
  ];
  for (const [name, label, control, wide] of fields) {
    bind(state, name, control);
    if (v.existingWineId) control.disabled = true;
    advanced.appendChild(trackedField(state, name, label, control, { wide }));
  }
  return el("div", {}, [
    core,
    detailsSection(text("More identity details", "Plus de détails d’identité"), advanced, advancedNames.some((name) => hasValue(v[name]))),
  ]);
}

function stockStep(state) {
  const quantity = input("number");
  quantity.min = "1";
  quantity.step = "1";
  bind(state, "quantity", quantity, Number);
  const cellar = optionSelect([["", text("No cellar", "Aucune cave")], ...state.cellars.map((item) => [item.id, item.name])], state.values.cellarId);
  bind(state, "cellarId", cellar);
  const location = choiceInput(state, "location", [], text("Location", "Emplacement"));
  bind(state, "location", location);
  return el("div", {}, [
    el("p", { class: "inventory-required-note", text: text("Quantity is required. Cellar and location can be left empty and completed later.", "La quantité est obligatoire. La cave et l’emplacement peuvent être complétés plus tard.") }),
    el("div", { class: "inventory-grid" }, [
      trackedField(state, "quantity", text("Quantity", "Quantité"), quantity, { required: true }),
      trackedField(state, "cellarId", text("Cellar", "Cave"), cellar),
      trackedField(state, "location", text("Location", "Emplacement"), location),
      el("p", { class: "inventory-hint wide", text: text("The location is validated against the selected cellar’s rules. This first version assigns the whole quantity to one location.", "L’emplacement est validé selon les règles de la cave choisie. Cette première version affecte toute la quantité à un seul emplacement.") }),
    ]),
  ]);
}

function purchaseDetails(state) {
  const grid = el("div", { class: "inventory-grid" });
  const fields = [
    ["priceMode", text("Price type", "Type de prix"), optionSelect([["per_bottle", text("Per bottle", "Par bouteille")], ["total", text("Total lot price", "Prix total du lot")]], state.values.priceMode)],
    ["amount", text("Amount", "Montant"), input("number")],
    ["currency", text("Currency", "Devise"), choiceInput(state, "currency", ["EUR", "GBP", "USD", "CHF", "CAD", "AUD"])],
    ["purchaseDate", text("Purchase date", "Date d’achat"), input("date")],
    ["vendor", text("Vendor / auction house", "Vendeur / maison de vente"), choiceInput(state, "vendor", unique((state.catalogWines || []).map((wine) => wine.vendor)))],
    ["taxIncluded", text("Taxes included", "Taxes comprises"), optionSelect([["", text("Unknown", "Inconnu")], ["true", text("Yes", "Oui")], ["false", text("No", "Non")]], state.values.taxIncluded)],
    ["fees", text("Additional fees", "Frais supplémentaires"), input("number")],
    ["shipping", text("Shipping", "Livraison"), input("number")],
    ["acquisitionType", text("Acquisition type", "Type d’acquisition"), optionSelect([["purchase", text("Purchase", "Achat")], ["gift", text("Gift", "Cadeau")], ["inheritance", text("Inheritance", "Héritage")], ["cellar_import", text("Cellar import", "Import de cave")], ["other", text("Other", "Autre")]], state.values.acquisitionType)],
    ["invoiceReference", text("Invoice / order reference", "Référence facture / commande"), input()],
    ["acquisitionNotes", text("Acquisition notes", "Notes d’acquisition"), textarea(), true],
  ];
  for (const [name, label, control, wide] of fields) {
    bind(state, name, control);
    grid.appendChild(trackedField(state, name, label, control, { wide }));
  }
  return grid;
}

function conditionDetails(state) {
  const grid = el("div", { class: "inventory-grid" });
  const fields = [
    ["fillLevel", text("Fill level", "Niveau de remplissage"), input()],
    ["labelCondition", text("Label condition", "État de l’étiquette"), input()],
    ["capsuleCondition", text("Capsule condition", "État de la capsule"), input()],
    ["bottleCondition", text("Bottle condition", "État de la bouteille"), input()],
    ["provenance", text("Provenance", "Provenance"), textarea(), true],
    ["storageHistory", text("Storage history", "Historique de conservation"), textarea(), true],
    ["originalCase", text("Original case / carton", "Caisse / carton d’origine"), optionSelect([["", text("Unknown", "Inconnu")], ["true", text("Yes", "Oui")], ["false", text("No", "Non")]], state.values.originalCase)],
    ["serialNumber", text("Serial / bottle number", "Numéro de série / bouteille"), input()],
    ["tags", text("Tags", "Étiquettes"), input()],
    ["personalNotes", text("Personal notes", "Notes personnelles"), textarea(), true],
  ];
  for (const [name, label, control, wide] of fields) {
    bind(state, name, control);
    grid.appendChild(trackedField(state, name, label, control, { wide }));
  }
  return grid;
}

function enrichmentDetails(state) {
  const grid = el("div", { class: "inventory-grid" });
  for (const [topic, config] of Object.entries(ENRICHMENT_FIELDS)) {
    const control = config.kind === "text" ? textarea() : input(config.kind === "year" ? "number" : "text");
    if (config.kind === "year") {
      control.min = "1900";
      control.max = "3000";
    }
    bind(state, config.local, control);
    grid.appendChild(trackedField(state, config.local, labelPair(config.label), control, { wide: config.kind === "text" }));
  }
  if (state.otherEnrichmentCandidates.length) {
    grid.appendChild(el("div", { class: "wide inventory-hint", text: text(
      `${state.otherEnrichmentCandidates.length} additional enrichment proposal(s) will also be saved.`,
      `${state.otherEnrichmentCandidates.length} proposition(s) d’enrichissement supplémentaire(s) seront également enregistrées.`
    ) }));
  }
  return grid;
}

function mediaDetails(state) {
  const categories = [
    ["front_label", text("Front label", "Étiquette avant")],
    ["back_label", text("Back label", "Contre-étiquette")],
    ["full_bottle", text("Full bottle", "Bouteille entière")],
    ["capsule", text("Capsule", "Capsule")],
    ["original_case", text("Original case", "Caisse d’origine")],
    ["receipt", text("Receipt / invoice", "Reçu / facture")],
    ["condition", text("Condition photo", "Photo d’état")],
    ["cellar_location", text("Cellar location", "Emplacement dans la cave")],
    ["other", text("Other document", "Autre document")],
  ];
  return el("div", {}, [
    el("p", { class: "inventory-hint", text: text("Optional. Photos can be added later. PDF receipts are accepted.", "Facultatif. Les photos pourront être ajoutées plus tard. Les reçus PDF sont acceptés.") }),
    el("div", { class: "inventory-media-grid" }, categories.map(([key, label]) => {
      const control = input("file");
      control.accept = key === "receipt" || key === "other" ? "image/*,application/pdf" : "image/*";
      control.addEventListener("change", () => { state.media[key] = control.files[0] || null; });
      const nodes = [control];
      if (state.media[key]) nodes.push(el("p", { class: "inventory-file-current", text: `${text("Selected", "Sélectionné")}: ${state.media[key].name}` }));
      return field(label, el("div", {}, nodes));
    })),
  ]);
}

function optionalStep(state) {
  const purchaseNames = ["amount", "purchaseDate", "vendor", "taxIncluded", "fees", "shipping", "invoiceReference", "acquisitionNotes"];
  const conditionNames = ["fillLevel", "labelCondition", "capsuleCondition", "bottleCondition", "provenance", "storageHistory", "originalCase", "serialNumber", "tags", "personalNotes"];
  const enrichmentNames = Object.values(ENRICHMENT_FIELDS).map((item) => item.local);
  return el("div", {}, [
    el("p", { class: "inventory-required-note", text: text("Everything on this page is optional. Open only the sections you need.", "Tout ce qui figure sur cette page est facultatif. Ouvrez uniquement les sections utiles.") }),
    detailsSection(text("Purchase details", "Détails d’achat"), purchaseDetails(state), purchaseNames.some((name) => hasValue(state.values[name]))),
    detailsSection(text("AI / research enrichment", "Enrichissement IA / recherche"), enrichmentDetails(state), enrichmentNames.some((name) => hasValue(state.values[name]))),
    detailsSection(text("Condition and provenance", "État et provenance"), conditionDetails(state), conditionNames.some((name) => hasValue(state.values[name]))),
    detailsSection(text("Photos and documents", "Photos et documents"), mediaDetails(state), hasMedia(state)),
  ]);
}

function formatEnrichmentValue(candidate) {
  if (Array.isArray(candidate.value)) return candidate.value.join(", ");
  return String(candidate.value ?? "");
}

async function reviewStep(state) {
  const payload = buildPayload(state);
  const container = el("div", { class: "inventory-summary" });
  const i = payload.identity;
  const a = payload.acquisition;
  const s = payload.storage;
  container.append(
    el("section", {}, [
      el("strong", { text: text("Wine", "Vin") }),
      el("div", { text: `${state.values.producer}${state.values.cuvee ? ` — ${state.values.cuvee}` : ""} ${state.values.nonVintage ? "NV" : state.values.vintage || ""}` }),
      el("div", { class: "inventory-hint", text: `${state.values.wineType} · ${state.values.format}` }),
    ]),
    el("section", {}, [
      el("strong", { text: text("Acquisition", "Acquisition") }),
      el("div", { text: `${a.quantity} ${text("bottles", "bouteilles")}${a.amount == null ? "" : ` · ${a.amount} ${a.currency} (${a.price_mode})`}` }),
      el("div", { class: "inventory-hint", text: [a.purchase_date, a.vendor].filter(Boolean).join(" · ") || text("No purchase details", "Aucun détail d’achat") }),
    ]),
    el("section", {}, [
      el("strong", { text: text("Storage", "Stockage") }),
      el("div", { text: `${s.quantity} → ${(state.cellars.find((cellar) => cellar.id === s.cellar_id)?.name || text("No cellar", "Aucune cave"))} / ${s.location || "—"}` }),
    ]),
    el("section", {}, [
      el("strong", { text: text("Media", "Médias") }),
      el("div", { text: Object.entries(state.media).filter(([, file]) => file).map(([key]) => key.replaceAll("_", " ")).join(", ") || text("None (can be added later)", "Aucun (ajout possible plus tard)") }),
    ]),
  );

  if (payload.enrichment_candidates.length) {
    container.appendChild(el("section", {}, [
      el("strong", { text: text("Enrichment proposals", "Propositions d’enrichissement") }),
      el("ul", { class: "inventory-enrichment-list" }, payload.enrichment_candidates.map((candidate) =>
        el("li", { text: `${candidate.label}: ${formatEnrichmentValue(candidate)}` })
      )),
    ]));
  }

  if (!i.existing_wine_id) {
    const duplicateSection = el("section", {}, [el("strong", { text: text("Possible duplicates", "Doublons possibles") })]);
    const results = el("div", { class: "inventory-duplicates" });
    duplicateSection.appendChild(results);
    container.appendChild(duplicateSection);
    try {
      const matches = await api.post("/inventory/duplicates", {
        producer: i.producer,
        cuvee: i.cuvee,
        appellation: i.appellation,
        vintage: i.vintage,
        non_vintage: i.non_vintage,
        format: i.format,
      });
      if (!matches.length) {
        results.appendChild(el("p", { class: "inventory-hint", text: text("No similar wine found. A new identity will be created.", "Aucun vin similaire trouvé. Une nouvelle identité sera créée.") }));
      }
      for (const match of matches) {
        results.appendChild(el("div", { class: "inventory-result" }, [
          el("div", {}, [
            el("strong", { text: `${match.producer}${match.cuvee ? ` — ${match.cuvee}` : ""}` }),
            el("div", { class: "inventory-hint", text: `${match.vintage || "NV"} · ${match.format} · ${Math.round(match.score * 100)}%` }),
          ]),
          el("button", { type: "button", text: text("Use existing wine", "Utiliser ce vin"), onclick: async () => {
            const wine = await api.get(`/wines/${match.wine_id}`);
            selectExistingWine(state, wine);
            state.render();
          } }),
        ]));
      }
      if (matches.length) {
        results.appendChild(el("p", { class: "inventory-hint", text: text("Matching is advisory. Leave the selection unchanged to create a new wine.", "La correspondance est indicative. Ne changez rien pour créer un nouveau vin.") }));
      }
    } catch {
      results.appendChild(el("p", { class: "inventory-hint", text: text("Duplicate check unavailable offline; saving remains possible.", "Vérification des doublons indisponible hors ligne ; l’enregistrement reste possible.") }));
    }
  }
  return container;
}

async function save(state, errorBox, saveButton) {
  errorBox.hidden = true;
  saveButton.disabled = true;
  try {
    const payload = buildPayload(state);
    let result;
    let queued = false;
    if (hasMedia(state)) {
      const fd = new FormData();
      const categories = [];
      fd.append("payload", JSON.stringify(payload));
      for (const [category, file] of Object.entries(state.media)) {
        if (!file) continue;
        categories.push(category);
        fd.append("files", file);
      }
      fd.append("categories", JSON.stringify(categories));
      result = await api.postForm("/inventory/with-media", fd);
    } else {
      const response = await api.mutateOrQueue("inventory/add", "/inventory", payload);
      result = response.result;
      queued = response.queued;
    }
    showToast(queued ? text("Inventory queued for sync", "Stock mis en attente de synchronisation") : text("Inventory added", "Stock ajouté"));
    state.overlay.remove();
    await state.onDone?.(result);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
    saveButton.disabled = false;
  }
}

async function wizard(state, body) {
  await ensureCatalogue(state);
  const labels = [L("identity"), L("stock"), L("optional"), L("review")];
  body.appendChild(el("div", { class: "inventory-steps" }, labels.map((label, index) =>
    el("button", { type: "button", class: `inventory-step ${state.step === index ? "active" : ""}`, text: `${index + 1}. ${label}`, onclick: () => {
      state.step = index;
      state.render();
    } })
  )));
  body.appendChild(el("h3", { text: labels[state.step] }));
  if (state.step === 0) body.appendChild(identityStep(state));
  if (state.step === 1) body.appendChild(stockStep(state));
  if (state.step === 2) body.appendChild(optionalStep(state));
  if (state.step === 3) body.appendChild(await reviewStep(state));

  const error = el("p", { class: "inventory-error", hidden: true });
  const actions = el("div", { class: "modal-actions" });
  actions.appendChild(el("button", { type: "button", text: L("back"), onclick: () => {
    if (state.step > 0) state.step -= 1;
    else {
      state.stage = "choose";
      state.path = null;
    }
    state.render();
  } }));
  if (state.step < 3) {
    actions.appendChild(el("button", { type: "button", class: "primary", text: L("next"), onclick: () => {
      try {
        if (state.step <= 1) buildPayload(state);
        state.step += 1;
        state.render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    } }));
  } else {
    const saveButton = el("button", { type: "button", class: "primary", text: L("save") });
    saveButton.addEventListener("click", () => save(state, error, saveButton));
    actions.appendChild(saveButton);
  }
  body.append(error, actions);
}

export function openAddInventory({ cellars = [], onDone = null, existingWine = null } = {}) {
  injectStyles();
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal inventory-modal" });
  const header = el("div", { class: "inventory-modal-header" });
  const body = el("div", { class: "inventory-modal-body" });
  const state = {
    overlay,
    body,
    cellars,
    onDone,
    formId: `inventory-${Math.random().toString(36).slice(2)}`,
    clientOpId: newClientOpId(),
    path: existingWine ? "existing" : null,
    stage: existingWine ? "wizard" : "choose",
    step: existingWine ? 1 : 0,
    catalogWines: [],
    catalogLoaded: false,
    otherEnrichmentCandidates: [],
    enrichmentMeta: {},
    media: {},
    sources: {},
    aiSuggestions: {},
    values: {
      existingWineId: null,
      producer: "",
      cuvee: "",
      vintage: "",
      nonVintage: false,
      wineType: "other",
      format: "75cl",
      formatMl: 750,
      country: "",
      region: "",
      appellation: "",
      classification: "",
      vineyard: "",
      sweetness: "",
      alcohol: "",
      grapes: "",
      certifications: "",
      externalIdentifiers: "",
      barcode: "",
      wineNotes: "",
      quantity: 1,
      priceMode: "per_bottle",
      amount: "",
      currency: "EUR",
      purchaseDate: "",
      vendor: "",
      taxIncluded: "",
      fees: 0,
      shipping: 0,
      acquisitionType: "purchase",
      invoiceReference: "",
      acquisitionNotes: "",
      cellarId: cellars[0]?.id || "",
      location: "",
      fillLevel: "",
      labelCondition: "",
      capsuleCondition: "",
      bottleCondition: "",
      provenance: "",
      storageHistory: "",
      originalCase: "",
      serialNumber: "",
      personalNotes: "",
      tags: "",
      drinkAfter: "",
      drinkBefore: "",
      servingAdvice: "",
      pairings: "",
      reviewSummary: "",
    },
  };
  for (const key of Object.keys(state.values)) state.sources[key] = "unknown";
  if (existingWine) selectExistingWine(state, existingWine);

  state.render = async () => {
    clear(header);
    header.append(
      el("h2", { text: L("title") }),
      el("button", { type: "button", class: "inventory-modal-close", text: "×", "aria-label": L("cancel"), onclick: () => overlay.remove() }),
    );
    body.className = "inventory-modal-body";
    clear(body);
    try {
      if (state.stage === "choose") body.appendChild(pathChooser(state));
      else if (state.stage === "prepare" && state.path === "existing") await renderExistingSearch(state, body);
      else if (state.stage === "prepare" && state.path === "chatgpt") await renderChatGPTPrepare(state, body);
      else if (state.stage === "prepare" && state.path === "photo") await renderPhotoPrepare(state, body);
      else {
        state.stage = "wizard";
        await wizard(state, body);
      }
    } catch (err) {
      body.appendChild(el("p", { class: "inventory-error", text: err.message }));
    }
    if (state.stage !== "wizard") {
      body.appendChild(el("div", { class: "modal-actions" }, [
        el("button", { type: "button", text: L("back"), onclick: () => {
          state.stage = "choose";
          state.path = null;
          state.render();
        } }),
        el("button", { type: "button", text: L("cancel"), onclick: () => overlay.remove() }),
      ]));
    }
    body.scrollTop = 0;
  };

  modal.append(header, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  state.render();
}
