import * as api from "../api.js";
import { el } from "../dom.js";
import { openBottleDetailsDialog } from "./bottleDetails.js";

const COPY = {
  en: {
    title: "Bottles at location",
    loading: "Loading bottles…",
    close: "Close",
    empty: "No bottles are recorded at this location.",
    quantity: "bottles",
    open: "Open bottle details",
    unknown: "Unknown wine",
  },
  fr: {
    title: "Bouteilles à l’emplacement",
    loading: "Chargement des bouteilles…",
    close: "Fermer",
    empty: "Aucune bouteille n’est enregistrée à cet emplacement.",
    quantity: "bouteilles",
    open: "Ouvrir les informations de la bouteille",
    unknown: "Vin inconnu",
  },
};

function messages(locale) {
  return COPY[(locale || "en").toLowerCase().split("-")[0]] || COPY.en;
}

export function normalizedLocationKey(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "__UNSPECIFIED__";
  }
  return String(value).trim().toLocaleUpperCase();
}

export function locationKeys(item) {
  if (item?.unspecified) return new Set(["__UNSPECIFIED__"]);

  const keys = new Set();
  for (const value of [item?.internal, item?.import]) {
    if (value !== null && value !== undefined && String(value).trim()) {
      keys.add(normalizedLocationKey(value));
    }
  }
  return keys;
}

export function holdingsForLocation(holdings, item) {
  const keys = locationKeys(item);
  if (!keys.size) return [];
  return (holdings || []).filter((holding) =>
    keys.has(normalizedLocationKey(holding.location)),
  );
}

export function groupHoldingsByWine(holdings) {
  const grouped = new Map();
  for (const holding of holdings || []) {
    const current = grouped.get(holding.wine_id) || {
      wine_id: holding.wine_id,
      quantity: 0,
      holdings: [],
    };
    current.quantity += Number(holding.quantity) || 0;
    current.holdings.push(holding);
    grouped.set(holding.wine_id, current);
  }
  return [...grouped.values()];
}

function wineTitle(wine, message) {
  if (!wine) return message.unknown;
  const identity = [wine.producer, wine.cuvee, wine.vintage || "NV"]
    .filter(Boolean)
    .join(" — ");
  return identity || message.unknown;
}

function locationLabel(item) {
  if (item?.unspecified) return "—";
  return item?.import || item?.internal || "—";
}

export async function openCellarLocationBottlesDialog({
  cellar,
  item,
  holdings,
}) {
  const locale = document.documentElement.lang || "en";
  const message = messages(locale);
  const matching = holdingsForLocation(holdings, item);
  const grouped = groupHoldingsByWine(matching);

  const overlay = el("div", { class: "modal-overlay" });
  const body = el("div", { class: "research-body" }, [
    el("p", { class: "research-progress", text: message.loading }),
  ]);
  const closeButton = el("button", {
    type: "button",
    class: "primary",
    text: message.close,
    onclick: () => overlay.remove(),
  });
  const modal = el("div", { class: "modal research-modal" }, [
    el("h3", {
      text: `${message.title}: ${cellar?.name || ""} · ${locationLabel(item)}`,
    }),
    body,
    el("div", { class: "modal-actions" }, [closeButton]),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  if (!grouped.length) {
    body.replaceChildren(el("p", { class: "empty-state", text: message.empty }));
    return;
  }

  const rows = await Promise.all(
    grouped.map(async (entry) => {
      const wine = await api.get(`/wines/${entry.wine_id}`).catch(() => null);
      const openButton = el("button", {
        type: "button",
        class: "button small",
        text: message.open,
        disabled: !wine,
      });
      if (wine) {
        openButton.addEventListener("click", () => {
          void openBottleDetailsDialog(wine);
        });
      }

      return el("article", { class: "research-candidate bottle-location-row" }, [
        el("div", {}, [
          el("strong", { text: wineTitle(wine, message) }),
          el("p", {
            class: "hint",
            text: `${entry.quantity} ${message.quantity}`,
          }),
        ]),
        openButton,
      ]);
    }),
  );

  body.replaceChildren(...rows);
}

export function attachLocationBottleClick(
  node,
  { cellar, item, holdings, quantity },
) {
  if (!node || !quantity) return node;

  const locale = document.documentElement.lang || "en";
  const message = messages(locale);
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", `${message.title}: ${locationLabel(item)}`);
  node.style.cursor = "pointer";

  const open = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openCellarLocationBottlesDialog({ cellar, item, holdings });
  };

  node.addEventListener("click", open);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") open(event);
  });
  return node;
}

