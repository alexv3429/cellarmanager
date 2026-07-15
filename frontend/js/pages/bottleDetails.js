import * as api from "../api.js";
import { el } from "../dom.js";
import { apiErrorMessage } from "./enrichmentResearch.js";

const COPY = {
  en: {
    button: "Details",
    title: "Bottle details",
    loading: "Loading accepted bottle information…",
    close: "Close",
    identity: "Bottle",
    drinking: "Drinking window",
    maturity: "Maturity",
    composition: "Composition",
    pairings: "Food suggestions",
    serving: "Serving suggestions",
    reviews: "Reviews",
    market: "Accepted market estimates",
    identifiers: "External identifiers",
    notes: "Notes",
    noEnrichment: "No accepted enrichment data yet. Use Research online to add reviewed information.",
    producer: "Producer",
    cuvee: "Cuvée",
    appellation: "Appellation",
    vintage: "Vintage",
    region: "Region",
    color: "Color",
    format: "Format",
    window: "Window",
    observations: "Observations",
    state: "State",
    readiness: "Readiness",
    grapes: "Grapes",
    alcohol: "Alcohol",
    sweetness: "Sweetness",
    oak: "Oak",
    certifications: "Certifications",
    temperature: "Temperature",
    decant: "Decant",
    upright: "Stand upright",
    glass: "Glass",
    rationale: "Rationale",
    avoid: "Avoid",
    sources: "Sources",
    accepted: "Accepted",
    score: "Score",
    reviewer: "Reviewer",
    date: "Date",
    confidence: "Confidence",
    minutes: "min",
    hours: "h",
    unknown: "—",
  },
  fr: {
    button: "Détails",
    title: "Informations de la bouteille",
    loading: "Chargement des informations acceptées…",
    close: "Fermer",
    identity: "Bouteille",
    drinking: "Fenêtre de dégustation",
    maturity: "Maturité",
    composition: "Composition",
    pairings: "Suggestions d’accords",
    serving: "Conseils de service",
    reviews: "Critiques",
    market: "Estimations de valeur acceptées",
    identifiers: "Identifiants externes",
    notes: "Notes",
    noEnrichment: "Aucune donnée d’enrichissement acceptée. Utilisez Recherche en ligne pour ajouter des informations vérifiées.",
    producer: "Producteur",
    cuvee: "Cuvée",
    appellation: "Appellation",
    vintage: "Millésime",
    region: "Région",
    color: "Couleur",
    format: "Format",
    window: "Fenêtre",
    observations: "Observations",
    state: "État",
    readiness: "Prêt à boire",
    grapes: "Cépages",
    alcohol: "Alcool",
    sweetness: "Sucrosité",
    oak: "Élevage",
    certifications: "Certifications",
    temperature: "Température",
    decant: "Carafage",
    upright: "Mise debout",
    glass: "Verre",
    rationale: "Justification",
    avoid: "À éviter",
    sources: "Sources",
    accepted: "Accepté",
    score: "Note",
    reviewer: "Critique",
    date: "Date",
    confidence: "Confiance",
    minutes: "min",
    hours: "h",
    unknown: "—",
  },
};

function messages(locale) {
  return COPY[(locale || "en").toLowerCase().split("-")[0]] || COPY.en;
}

export function bottleDetailsButtonLabel(locale) {
  return messages(locale).button;
}

export function acceptedProfileValue(profile, key) {
  return profile?.[key]?.value ?? null;
}

function entriesForTopic(profile, topic) {
  return Object.entries(profile || {})
    .filter(([key]) => key.startsWith(`${topic}:`))
    .map(([key, entry]) => ({ key, ...entry }));
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
      return null;
    }
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return null;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
      return null;
    }
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function uniqueUrls(values) {
  const urls = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "source_url" && typeof child === "string" && safeWebUrl(child)) {
        urls.add(safeWebUrl(child));
      } else if (key === "source_urls" && Array.isArray(child)) {
        child.forEach((url) => {
          const safe = safeWebUrl(url);
          if (safe) urls.add(safe);
        });
      } else {
        visit(child);
      }
    }
  };
  values.forEach(visit);
  return [...urls];
}

function sourceDetails(values, message) {
  const urls = uniqueUrls(values);
  if (!urls.length) return null;
  return el("details", {}, [
    el("summary", { text: `${message.sources} (${urls.length})` }),
    el(
      "ul",
      { class: "research-sources" },
      urls.map((url) =>
        el("li", {}, [
          el("a", {
            text: new URL(url).hostname,
            href: url,
            target: "_blank",
            rel: "noopener noreferrer",
          }),
        ]),
      ),
    ),
  ]);
}

function definitionList(rows, message) {
  const children = [];
  for (const [label, value] of rows) {
    if (value === null || value === undefined || value === "") continue;
    children.push(el("dt", { text: label }));
    children.push(el("dd", { text: String(value) }));
  }
  return children.length
    ? el("dl", { class: "bottle-detail-list" }, children)
    : el("p", { class: "hint", text: message.unknown });
}

function section(title, children) {
  return el(
    "section",
    { class: "research-candidate bottle-detail-section" },
    [el("h4", { text: title }), ...children.filter(Boolean)],
  );
}

function yearFromDate(value) {
  if (!value) return null;
  const match = String(value).match(/^\d{4}/);
  return match ? Number(match[0]) : value;
}

function renderIdentity(wine, message) {
  const format = [wine.format, wine.format_ml ? `${wine.format_ml} ml` : null]
    .filter(Boolean)
    .join(" · ");
  return section(message.identity, [
    definitionList(
      [
        [message.producer, wine.producer],
        [message.cuvee, wine.cuvee],
        [message.appellation, wine.appellation],
        [message.vintage, wine.vintage || "NV"],
        [message.region, wine.area],
        [message.color, wine.color],
        [message.format, format],
      ],
      message,
    ),
  ]);
}

function renderDrinking(wine, profile, message) {
  const accepted = acceptedProfileValue(profile, "drinking_window:drinking_window");
  const maturity = acceptedProfileValue(profile, "maturity:maturity") || accepted?.maturity;
  const after = accepted?.drink_after_year ?? yearFromDate(wine.drink_after);
  const before = accepted?.drink_before_year ?? yearFromDate(wine.drink_before);
  if (after == null && before == null && !maturity) return null;

  const windowText = after != null || before != null ? `${after ?? "?"}–${before ?? "?"}` : null;
  const children = [
    definitionList(
      [
        [message.window, windowText],
        [message.observations, accepted?.observation_count],
        [message.state, maturity?.state],
        [message.readiness, maturity?.readiness_score != null ? `${maturity.readiness_score}/10` : null],
        [message.rationale, maturity?.rationale],
      ],
      message,
    ),
  ];
  return section(message.drinking, children);
}

function renderComposition(profile, message) {
  const value = acceptedProfileValue(profile, "composition:composition");
  if (!value) return null;
  const grapes = (value.grapes || [])
    .map((grape) =>
      grape.percentage == null ? grape.name : `${grape.name} ${grape.percentage}%`,
    )
    .filter(Boolean)
    .join(", ");
  return section(message.composition, [
    definitionList(
      [
        [message.grapes, grapes],
        [message.alcohol, value.alcohol_percent != null ? `${value.alcohol_percent}%` : null],
        [message.sweetness, value.sweetness],
        [message.oak, value.oak],
        [message.certifications, (value.certifications || []).join(", ")],
      ],
      message,
    ),
    sourceDetails([value], message),
  ]);
}

function renderPairings(wine, profile, message) {
  const pairings = acceptedProfileValue(profile, "pairing:dish_pairings") || [];
  const children = pairings.map((item) =>
    el("article", { class: "bottle-detail-item" }, [
      el("strong", { text: item.dish || message.unknown }),
      item.rationale ? el("p", { text: item.rationale }) : null,
      item.avoid?.length
        ? el("p", { class: "hint", text: `${message.avoid}: ${item.avoid.join(", ")}` })
        : null,
    ].filter(Boolean)),
  );
  if (!children.length && wine.advice_pairing) children.push(el("p", { text: wine.advice_pairing }));
  if (!children.length) return null;
  children.push(sourceDetails(pairings, message));
  return section(message.pairings, children);
}

function renderServing(wine, profile, message) {
  const value = acceptedProfileValue(profile, "serving:serving_advice");
  if (!value && !wine.advice_experience) return null;
  if (!value) return section(message.serving, [el("p", { text: wine.advice_experience })]);

  const temperature =
    value.temperature_min_c != null || value.temperature_max_c != null
      ? `${value.temperature_min_c ?? "?"}–${value.temperature_max_c ?? "?"} °C`
      : null;
  return section(message.serving, [
    definitionList(
      [
        [message.temperature, temperature],
        [message.decant, value.decant_minutes != null ? `${value.decant_minutes} ${message.minutes}` : null],
        [message.upright, value.stand_upright_hours != null ? `${value.stand_upright_hours} ${message.hours}` : null],
        [message.glass, value.glass],
        [message.rationale, value.rationale],
      ],
      message,
    ),
    sourceDetails([value], message),
  ]);
}

function renderReviews(profile, message) {
  const reviews = acceptedProfileValue(profile, "reviews:critical_reviews") || [];
  if (!reviews.length) return null;
  return section(message.reviews, [
    ...reviews.map((review) =>
      el("article", { class: "bottle-detail-item" }, [
        el("strong", {
          text: `${review.reviewer || message.unknown}${
            review.score != null ? ` — ${review.score}/${review.scale || 100}` : ""
          }`,
        }),
        review.review_date ? el("p", { class: "hint", text: review.review_date }) : null,
        review.note_excerpt ? el("p", { text: review.note_excerpt }) : null,
      ].filter(Boolean)),
    ),
    sourceDetails(reviews, message),
  ]);
}

function renderMarket(profile, message) {
  const entries = entriesForTopic(profile, "market_value");
  if (!entries.length) return null;
  return section(message.market, [
    definitionList(
      entries.map((entry) => {
        const label = entry.key.split(":")[1].replaceAll("_", " ");
        const value = entry.value || {};
        return [label, `${value.amount ?? "?"} ${value.currency || ""}`.trim()];
      }),
      message,
    ),
  ]);
}

function renderIdentifiers(identifiers, message) {
  if (!identifiers?.length) return null;
  return section(message.identifiers, [
    definitionList(
      identifiers.map((item) => [
        item.scheme,
        `${item.value}${item.confidence != null ? ` (${Math.round(item.confidence * 100)}%)` : ""}`,
      ]),
      message,
    ),
  ]);
}

function renderNotes(wine, message) {
  if (!wine.notes) return null;
  return section(message.notes, [el("p", { text: wine.notes })]);
}

export async function openBottleDetailsDialog(wine) {
  const locale = document.documentElement.lang || "en";
  const message = messages(locale);
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
      text: `${message.title}: ${wine.producer}${wine.cuvee ? ` — ${wine.cuvee}` : ""}`,
    }),
    body,
    el("div", { class: "modal-actions" }, [closeButton]),
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let payload;
  try {
    payload = await api.get(`/wines/${wine.id}/enrichment-profile`);
  } catch (error) {
    body.replaceChildren(el("p", { class: "form-error", text: apiErrorMessage(error) }));
    return;
  }

  const profile = payload.profile || {};
  const sections = [
    renderIdentity(wine, message),
    renderDrinking(wine, profile, message),
    renderComposition(profile, message),
    renderPairings(wine, profile, message),
    renderServing(wine, profile, message),
    renderReviews(profile, message),
    renderMarket(profile, message),
    renderIdentifiers(payload.external_identifiers || [], message),
    renderNotes(wine, message),
  ].filter(Boolean);

  if (!Object.keys(profile).length) {
    sections.splice(1, 0, el("p", { class: "hint", text: message.noEnrichment }));
  }
  body.replaceChildren(...sections);
}
