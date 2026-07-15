import * as api from "../api.js";
import { el, field, selectEl, showToast } from "../dom.js";
import { t } from "../i18n.js";
import { apiErrorMessage } from "./enrichmentResearch.js";

const COLORS = ["red", "white", "rose", "sparkling", "orange", "fortified", "other"];

const COPY = {
  en: {
    button: "Edit",
    title: "Edit bottle",
    identityShared: "Identity changes apply to every holding of this wine. Purchase changes apply only to the selected lot.",
    producer: "Producer",
    cuvee: "Cuvée / wine name",
    appellation: "Appellation",
    vintage: "Vintage",
    color: "Color / type",
    sweetness: "Sweetness",
    area: "Region / area",
    format: "Bottle format",
    holding: "Stock location",
    acquisition: "Purchase lot",
    priceMode: "Price type",
    perBottle: "Price per bottle",
    total: "Total lot price",
    amount: "Amount",
    currency: "Currency",
    purchaseDate: "Purchase date",
    legacyPrice: "Price per bottle",
    costsPreserved: "Existing fees and shipping remain unchanged and are included in the effective bottle cost.",
    noPurchaseLot: "This is legacy stock, so the price is stored directly on the holding.",
    cancel: "Cancel",
    save: "Save changes",
    saved: "Bottle updated",
    loading: "Loading purchase details…",
    unknown: "Unknown",
  },
  fr: {
    button: "Modifier",
    title: "Modifier la bouteille",
    identityShared: "Les modifications d’identité s’appliquent à tous les emplacements de ce vin. Les modifications d’achat ne concernent que le lot sélectionné.",
    producer: "Producteur",
    cuvee: "Cuvée / nom du vin",
    appellation: "Appellation",
    vintage: "Millésime",
    color: "Couleur / type",
    sweetness: "Sucrosité",
    area: "Région / zone",
    format: "Format de bouteille",
    holding: "Emplacement du stock",
    acquisition: "Lot d’achat",
    priceMode: "Type de prix",
    perBottle: "Prix par bouteille",
    total: "Prix total du lot",
    amount: "Montant",
    currency: "Devise",
    purchaseDate: "Date d’achat",
    legacyPrice: "Prix par bouteille",
    costsPreserved: "Les frais et le transport existants restent inchangés et sont inclus dans le coût effectif par bouteille.",
    noPurchaseLot: "Il s’agit d’un stock historique : le prix est donc enregistré directement sur l’emplacement.",
    cancel: "Annuler",
    save: "Enregistrer",
    saved: "Bouteille mise à jour",
    loading: "Chargement des informations d’achat…",
    unknown: "Inconnu",
  },
};

function messages() {
  const locale = (document.documentElement.lang || "en").toLowerCase().split("-")[0];
  return COPY[locale] || COPY.en;
}

export function bottleEditButtonLabel() {
  return messages().button;
}

function nullableNumber(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

function holdingLabel(holding, cellarsById, message) {
  const cellar = cellarsById?.[holding.cellar_id]?.name || message.unknown;
  const location = holding.location || "—";
  return `${cellar} · ${location} · ${holding.quantity}`;
}

function acquisitionLabel(item, index) {
  const date = item.purchase_date || "—";
  const vendor = item.vendor ? ` · ${item.vendor}` : "";
  return `${index + 1}. ${date}${vendor} · ${item.allocation_quantity}/${item.quantity}`;
}

export async function openBottleEditor({ wine, holdings, cellarsById, onDone }) {
  if (!holdings?.length) return;
  const message = messages();
  const overlay = el("div", { class: "modal-overlay" });
  const errorBox = el("p", { class: "form-error", hidden: true });
  const purchaseBox = el("div", {}, [el("p", { class: "hint", text: message.loading })]);

  const producer = el("input", { type: "text", value: wine.producer || "", required: true });
  const cuvee = el("input", { type: "text", value: wine.cuvee || "" });
  const appellation = el("input", { type: "text", value: wine.appellation || "" });
  const vintage = el("input", { type: "number", min: 1000, max: 3000, value: wine.vintage || "" });
  const color = selectEl(
    COLORS.map((value) => ({ value, label: t(`color.${value}`) || value })),
    { value: wine.color || "other" },
  );
  const area = el("input", { type: "text", value: wine.area || "" });
  const sweetness = el("input", {
    type: "text",
    value: "",
    list: "bottle-sweetness-options",
    placeholder: document.documentElement.lang?.startsWith("fr") ? "sec, demi-sec, moelleux, liquoreux…" : "dry, off-dry, sweet, luscious…",
  });
  const sweetnessOptions = el("datalist", { id: "bottle-sweetness-options" }, [
    ...["dry", "off-dry", "demi-sec", "moelleux", "sweet", "liquoreux"].map((value) =>
      el("option", { value })
    ),
  ]);
  const format = el("input", { type: "text", value: wine.format || "75cl", required: true });
  const holdingSelect = selectEl(
    holdings.map((holding) => ({
      value: holding.id,
      label: holdingLabel(holding, cellarsById, message),
    })),
    { value: holdings[0].id },
  );

  let selectedHolding = holdings[0];
  let selectedAcquisition = null;
  let context = null;
  let identityLoaded = false;
  let expectedWineVersion = wine.version;
  let priceMode = null;
  let amount = null;
  let currency = null;
  let purchaseDate = null;
  let legacyPrice = null;
  let legacyDate = null;

  async function loadPurchaseEditor() {
    context = null;
    save.disabled = true;
    selectedHolding = holdings.find((item) => item.id === holdingSelect.value) || holdings[0];
    purchaseBox.replaceChildren(el("p", { class: "hint", text: message.loading }));
    context = await api.get(`/holdings/${selectedHolding.id}/edit-context`);
    selectedHolding = context.holding;
    if (!identityLoaded) {
      const currentWine = context.wine;
      producer.value = currentWine.producer || "";
      cuvee.value = currentWine.cuvee || "";
      appellation.value = currentWine.appellation || "";
      vintage.value = currentWine.vintage || "";
      color.value = currentWine.color || "other";
      area.value = currentWine.area || "";
      sweetness.value = context.sweetness || "";
      format.value = currentWine.format || "75cl";
      expectedWineVersion = currentWine.version;
      identityLoaded = true;
    }
    const acquisitions = context.acquisitions || [];
    const nodes = [];

    if (acquisitions.length) {
      const acquisitionSelect = selectEl(
        acquisitions.map((item, index) => ({ value: item.id, label: acquisitionLabel(item, index) })),
      );
      priceMode = selectEl([
        { value: "per_bottle", label: message.perBottle },
        { value: "total", label: message.total },
      ]);
      amount = el("input", { type: "number", min: 0, step: "0.01" });
      currency = el("input", { type: "text", maxlength: 3 });
      purchaseDate = el("input", { type: "date" });

      function selectAcquisition() {
        selectedAcquisition = acquisitions.find((item) => item.id === acquisitionSelect.value) || acquisitions[0];
        priceMode.value = selectedAcquisition.price_mode || "per_bottle";
        amount.value = selectedAcquisition.amount ?? "";
        currency.value = selectedAcquisition.currency || "EUR";
        purchaseDate.value = selectedAcquisition.purchase_date || "";
      }
      acquisitionSelect.addEventListener("change", selectAcquisition);
      selectAcquisition();
      nodes.push(
        field(message.acquisition, acquisitionSelect),
        field(message.priceMode, priceMode),
        field(message.amount, amount),
        field(message.currency, currency),
        field(message.purchaseDate, purchaseDate),
        el("p", { class: "hint", text: message.costsPreserved }),
      );
    } else {
      selectedAcquisition = null;
      legacyPrice = el("input", {
        type: "number",
        min: 0,
        step: "0.01",
        value: selectedHolding.price_bought ?? "",
      });
      legacyDate = el("input", {
        type: "date",
        value: selectedHolding.acquired_date || "",
      });
      nodes.push(
        field(message.legacyPrice, legacyPrice),
        field(message.purchaseDate, legacyDate),
        el("p", { class: "hint", text: message.noPurchaseLot }),
      );
    }
    purchaseBox.replaceChildren(...nodes);
    save.disabled = false;
  }

  holdingSelect.addEventListener("change", () => {
    errorBox.hidden = true;
    loadPurchaseEditor().catch((error) => {
      purchaseBox.replaceChildren(el("p", { class: "form-error", text: apiErrorMessage(error) }));
    });
  });

  const cancel = el("button", {
    type: "button",
    text: message.cancel,
    onclick: () => overlay.remove(),
  });
  const save = el("button", {
    type: "button",
    class: "primary",
    text: message.save,
    disabled: true,
  });
  save.addEventListener("click", async () => {
    errorBox.hidden = true;
    save.disabled = true;
    try {
      const payload = {
        expected_wine_version: expectedWineVersion,
        expected_holding_version: selectedHolding.version,
        producer: producer.value.trim(),
        cuvee: cuvee.value.trim() || null,
        appellation: appellation.value.trim() || null,
        vintage: nullableNumber(vintage.value),
        color: color.value,
        area: area.value.trim() || null,
        sweetness: sweetness.value.trim() || null,
        format: format.value.trim(),
        acquisition_id: selectedAcquisition?.id || null,
        price_mode: selectedAcquisition ? priceMode.value : "per_bottle",
        amount: selectedAcquisition ? nullableNumber(amount.value) : null,
        currency: selectedAcquisition ? currency.value.trim().toUpperCase() : "EUR",
        purchase_date: selectedAcquisition ? purchaseDate.value || null : null,
        legacy_price_bought: selectedAcquisition ? null : nullableNumber(legacyPrice.value),
        legacy_acquired_date: selectedAcquisition ? null : legacyDate.value || null,
      };
      await api.put(`/holdings/${selectedHolding.id}/bottle`, payload);
      overlay.remove();
      showToast(message.saved);
      await onDone?.();
    } catch (error) {
      errorBox.textContent = apiErrorMessage(error);
      errorBox.hidden = false;
    } finally {
      save.disabled = false;
    }
  });

  const modal = el("div", { class: "modal research-modal" }, [
    el("h3", { text: message.title }),
    el("p", { class: "hint", text: message.identityShared }),
    field(message.producer, producer),
    field(message.cuvee, cuvee),
    field(message.appellation, appellation),
    field(message.vintage, vintage),
    field(message.color, color),
    field(message.area, area),
    field(message.sweetness, sweetness),
    sweetnessOptions,
    field(message.format, format),
    holdings.length > 1 ? field(message.holding, holdingSelect) : null,
    purchaseBox,
    errorBox,
    el("div", { class: "modal-actions" }, [cancel, save]),
  ].filter(Boolean));
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try {
    await loadPurchaseEditor();
  } catch (error) {
    purchaseBox.replaceChildren(el("p", { class: "form-error", text: apiErrorMessage(error) }));
    save.disabled = true;
  }
}
