import { readFile } from "node:fs/promises";

const ATTRIBUTE_KEYS = Object.freeze([
  "body",
  "acidity",
  "tannin",
  "sweetness",
  "alcohol",
  "aromaticIntensity",
  "freshness",
  "savory",
]);

const STATE_LABELS = Object.freeze({
  hold: "Hold",
  trial: "Start assessing",
  ready: "Likely ready",
  priority: "Prioritize",
  late: "Drink soon and assess",
  "assess-now": "Assess immediately",
});

export async function loadKnowledge(path) {
  return validateKnowledge(JSON.parse(await readFile(path, "utf8")));
}

function requiredArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Knowledge ${field} must be a non-empty array`);
  }
  return value;
}

export function validateKnowledge(input) {
  if (input?.version !== 1) {
    throw new Error("Inference knowledge must use version 1");
  }
  for (const field of [
    "sources",
    "placeProfiles",
    "vintageProfiles",
    "producerProfiles",
    "cuveeProfiles",
    "dishProfiles",
  ]) {
    requiredArray(input[field], field);
  }
  const sourceIds = new Set(input.sources.map((source) => source.id));
  if (sourceIds.size !== input.sources.length) {
    throw new Error("Knowledge source IDs must be unique");
  }
  for (const collection of [
    input.placeProfiles,
    input.vintageProfiles,
    input.producerProfiles,
    input.cuveeProfiles,
    input.dishProfiles,
  ]) {
    const ids = new Set(collection.map((entry) => entry.id));
    if (ids.size !== collection.length) {
      throw new Error("Knowledge profile IDs must be unique within each collection");
    }
    for (const entry of collection) {
      for (const evidenceId of entry.evidence ?? []) {
        if (!sourceIds.has(evidenceId)) {
          throw new Error(`${entry.id} references unknown evidence ${evidenceId}`);
        }
      }
    }
  }
  return input;
}

function requiredText(value, field, index) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`wines[${index}].${field} must be non-empty text`);
  }
  return value.trim();
}

export function validatePocSample(input) {
  if (
    input?.version !== 1 ||
    !Number.isInteger(input.asOfYear) ||
    !Array.isArray(input.wines)
  ) {
    throw new Error("POC sample must use version 1, an asOfYear, and a wines array");
  }
  if (input.wines.length === 0 || input.wines.length > 50) {
    throw new Error("POC sample must contain from 1 to 50 wines");
  }
  const sampleIds = new Set();
  const wines = input.wines.map((wine, index) => {
    const sampleId = requiredText(wine?.sampleId, "sampleId", index);
    if (sampleIds.has(sampleId)) throw new Error(`Duplicate sampleId: ${sampleId}`);
    sampleIds.add(sampleId);
    if (!Number.isInteger(wine.vintage) || wine.vintage < 1800 || wine.vintage > 2200) {
      throw new Error(`wines[${index}].vintage must be a valid year`);
    }
    const quantity = wine.quantity ?? 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`wines[${index}].quantity must be positive`);
    }
    return {
      ...wine,
      sampleId,
      producer: requiredText(wine.producer, "producer", index),
      cuvee: requiredText(wine.cuvee, "cuvee", index),
      appellation: requiredText(wine.appellation, "appellation", index),
      region: requiredText(wine.region, "region", index),
      color: requiredText(wine.color, "color", index),
      quantity,
    };
  });
  return { version: 1, asOfYear: input.asOfYear, wines };
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

export function canonicalColour(value) {
  const normalized = normalizeText(value);
  if (/\b(red|rouge)\b/.test(normalized)) return "red";
  if (/\b(white|blanc)\b/.test(normalized)) return "white";
  if (/\b(rose|pink)\b/.test(normalized)) return "rose";
  return normalized || null;
}

function matchesAlias(value, aliases = []) {
  const normalized = normalizeText(value);
  return aliases.some((alias) => normalizeText(alias) === normalized);
}

function findProducer(wine, knowledge) {
  return (
    knowledge.producerProfiles.find((profile) =>
      matchesAlias(wine.producer, profile.producerAliases),
    ) ?? null
  );
}

function findCuvee(wine, producer, knowledge) {
  return (
    knowledge.cuveeProfiles.find((profile) => {
      const producerMatches = profile.producerProfileId
        ? profile.producerProfileId === producer?.id
        : matchesAlias(wine.producer, profile.producerAliases);
      return producerMatches && matchesAlias(wine.cuvee, profile.cuveeAliases);
    }) ?? null
  );
}

function findPlace(wine, cuvee, colour, knowledge) {
  const warnings = [];
  const exactAppellation = knowledge.placeProfiles.filter((profile) =>
    matchesAlias(wine.appellation, profile.appellationAliases),
  );
  if (
    exactAppellation.length > 0 &&
    !exactAppellation.some((profile) => profile.colors.includes(colour))
  ) {
    warnings.push(
      `Official/profile scope for ${wine.appellation} does not include ${colour}; using a broader compatible profile.`,
    );
  }

  if (cuvee?.placeProfileId) {
    const profile = knowledge.placeProfiles.find(
      (candidate) => candidate.id === cuvee.placeProfileId,
    );
    if (profile?.colors.includes(colour)) return { profile, warnings };
  }

  const exact = exactAppellation.find((profile) => profile.colors.includes(colour));
  if (exact) return { profile: exact, warnings };

  const regional = knowledge.placeProfiles.find(
    (profile) =>
      profile.colors.includes(colour) &&
      matchesAlias(wine.region, profile.regionAliases),
  );
  return { profile: regional ?? null, warnings };
}

function findVintage(wine, place, colour, knowledge) {
  return (
    knowledge.vintageProfiles.find(
      (profile) =>
        profile.placeGroup === place.placeGroup &&
        profile.color === colour &&
        profile.vintage === wine.vintage,
    ) ?? null
  );
}

function clamp(value, min = 0, max = 5) {
  return Math.min(max, Math.max(min, value));
}

function applyAttributes(base, ...adjustments) {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attribute) => [
      attribute,
      Number(
        clamp(
          (base[attribute] ?? 0) +
            adjustments.reduce(
              (total, adjustment) => total + (adjustment?.[attribute] ?? 0),
              0,
            ),
        ).toFixed(1),
      ),
    ]),
  );
}

function profileAdjustment(profile, field) {
  return Number.isFinite(profile?.[field]) ? profile[field] : 0;
}

function yearRange(vintage, range, adjustment) {
  return range.map((age) => vintage + age + adjustment);
}

function maturityRanges(wine, place, vintage, producer, cuvee) {
  const openingYears =
    profileAdjustment(vintage, "openingYears") +
    profileAdjustment(producer, "openingYears") +
    profileAdjustment(cuvee, "openingYears");
  const longevityYears =
    profileAdjustment(vintage, "longevityYears") +
    profileAdjustment(producer, "longevityYears") +
    profileAdjustment(cuvee, "longevityYears");
  const firstTry = yearRange(wine.vintage, place.maturity.firstTryAge, openingYears);
  const likelyBest = yearRange(wine.vintage, place.maturity.likelyBestAge, 0);
  likelyBest[0] = Math.max(firstTry[0], likelyBest[0] + openingYears);
  likelyBest[1] = Math.max(likelyBest[0], likelyBest[1] + longevityYears);
  const drinkBy = yearRange(wine.vintage, place.maturity.drinkByAge, longevityYears);
  drinkBy[0] = Math.max(likelyBest[1], drinkBy[0]);
  drinkBy[1] = Math.max(drinkBy[0], drinkBy[1]);
  return { firstTry, likelyBest, drinkBy, openingYears, longevityYears };
}

function maturityState(asOfYear, ranges) {
  if (asOfYear < ranges.firstTry[0]) return "hold";
  if (asOfYear < ranges.likelyBest[0]) return "trial";
  if (asOfYear <= ranges.likelyBest[1]) return "ready";
  if (asOfYear < ranges.drinkBy[0]) return "priority";
  if (asOfYear <= ranges.drinkBy[1]) return "late";
  return "assess-now";
}

function maturityMessage(asOfYear, state, ranges) {
  if (state === "hold") {
    const minimum = ranges.firstTry[0] - asOfYear;
    const maximum = ranges.firstTry[1] - asOfYear;
    return `Wait about ${minimum}–${maximum} years before the first trial.`;
  }
  if (state === "trial") {
    return `Start assessing now; the likely best period begins around ${ranges.likelyBest[0]}.`;
  }
  if (state === "ready") {
    return `Likely in its best period; aim to reassess before ${ranges.drinkBy[0]}.`;
  }
  if (state === "priority") {
    return `Past the central estimate; prioritize it and aim to drink by about ${ranges.drinkBy[0]}.`;
  }
  if (state === "late") {
    return `Past the likely best period; open soon and assess bottle condition.`;
  }
  return `Past the suggested drink-by year; assess a bottle now rather than assuming it is lost.`;
}

function locationAdvice(wine, asOfYear, state, ranges) {
  const moveToServiceYear = ranges.firstTry[0] - 1;
  if (state === "hold") {
    return {
      purpose: "aging",
      moveToServiceYear,
      message: `Keep in aging storage; move one bottle to service around ${moveToServiceYear}.`,
    };
  }
  if (state === "trial" || state === "ready") {
    if (wine.quantity > 1) {
      return {
        purpose: "split-service-and-aging",
        moveToServiceYear,
        message: "Keep one bottle in service and the remaining bottles in aging storage.",
      };
    }
    return {
      purpose: "service",
      moveToServiceYear,
      message: "Move or keep this bottle in service storage.",
    };
  }
  return {
    purpose: "service-priority",
    moveToServiceYear: Math.min(asOfYear, moveToServiceYear),
    message: "Move to service storage and prioritize an assessment bottle.",
  };
}

function evidenceIds(...profiles) {
  return [
    ...new Set(
      profiles.flatMap((profile) => (profile ? profile.evidence ?? [] : [])),
    ),
  ];
}

function inferenceConfidence(place, vintage, producer, cuvee, warnings) {
  const score =
    place.confidence * 0.45 +
    (vintage?.confidence ?? 0.2) * 0.2 +
    (producer?.confidence ?? 0.2) * 0.15 +
    (cuvee?.confidence ?? 0.2) * 0.2 -
    warnings.length * 0.06;
  return Number(clamp(score, 0, 1).toFixed(2));
}

function confidenceLabel(confidence) {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

function maturityAdjustedAttributes(attributes, state) {
  const adjustments = {
    hold: { tannin: 0.4, savory: -0.2 },
    trial: { tannin: 0.2 },
    ready: { savory: 0.2 },
    priority: { tannin: -0.3, savory: 0.4 },
    late: { tannin: -0.5, freshness: -0.3, savory: 0.5 },
    "assess-now": { tannin: -0.8, freshness: -0.7, aromaticIntensity: -0.3 },
  };
  return applyAttributes(attributes, adjustments[state]);
}

export function inferWine(wine, asOfYear, knowledge) {
  const colour = canonicalColour(wine.color);
  const producer = findProducer(wine, knowledge);
  const cuvee = findCuvee(wine, producer, knowledge);
  const { profile: place, warnings } = findPlace(wine, cuvee, colour, knowledge);
  if (!place) {
    return {
      sampleId: wine.sampleId,
      status: "insufficient-knowledge",
      wine,
      warnings: [...warnings, "No compatible place/style profile was found."],
      confidence: 0,
      confidenceLabel: "unknown",
    };
  }
  const vintage = findVintage(wine, place, colour, knowledge);
  if (!vintage) {
    warnings.push(
      `No ${place.placeGroup} ${colour} ${wine.vintage} vintage profile; using the place baseline.`,
    );
  }
  if (!producer) warnings.push("No reviewed producer profile; using place and vintage only.");
  if (!cuvee) warnings.push("No reviewed cuvée profile; using broader evidence.");

  const ranges = maturityRanges(wine, place, vintage, producer, cuvee);
  const state = maturityState(asOfYear, ranges);
  const attributes = applyAttributes(
    place.attributes,
    vintage?.attributeAdjustments,
    producer?.attributeAdjustments,
    cuvee?.attributeAdjustments,
  );
  const confidence = inferenceConfidence(place, vintage, producer, cuvee, warnings);
  const evidence = evidenceIds(place, vintage, producer, cuvee);

  return {
    sampleId: wine.sampleId,
    status: "inferred",
    wine,
    matchedProfiles: {
      place: place.id,
      vintage: vintage?.id ?? null,
      producer: producer?.id ?? null,
      cuvee: cuvee?.id ?? null,
    },
    maturity: {
      state,
      stateLabel: STATE_LABELS[state],
      ...ranges,
      message: maturityMessage(asOfYear, state, ranges),
    },
    location: locationAdvice(wine, asOfYear, state, ranges),
    attributes,
    currentAttributes: maturityAdjustedAttributes(attributes, state),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    warnings,
    reasons: [
      place.rationale,
      vintage?.rationale,
      producer?.rationale,
      cuvee?.rationale,
    ].filter(Boolean),
  };
}

function pairingScore(inference, dish) {
  const wine = inference.currentAttributes;
  const food = dish.attributes;
  const reasons = [];
  let score = 82;

  const intensityGap = Math.abs(wine.body - food.intensity);
  score -= intensityGap * 7;
  if (intensityGap <= 0.8) reasons.push("Wine and dish intensity are well matched.");

  const acidityDeficit = food.acidity - wine.acidity;
  if (acidityDeficit > 0.5) {
    score -= acidityDeficit * 11;
    reasons.push("The dish may make this wine seem insufficiently fresh.");
  } else if (food.acidity >= 3 && wine.acidity >= food.acidity - 0.5) {
    score += 5;
    reasons.push("Its acidity can stand up to the dish.");
  }

  const sweetnessDeficit = food.sweetness - wine.sweetness;
  if (sweetnessDeficit > 0) {
    score -= sweetnessDeficit * 18;
    reasons.push("The dish is sweeter than the wine.");
  }

  if (food.fat >= 3) {
    score += (wine.acidity + wine.tannin) * 1.2;
    reasons.push("Acidity and structure can balance the richness.");
  }
  if (food.protein >= 3) {
    score += wine.tannin * 1.5;
  }
  if (food.fish >= 3 && wine.tannin > 2.5) {
    score -= (wine.tannin - 2.5) * food.fish * 3;
    reasons.push("Tannin is a risk with the fish.");
  }
  if (food.umami >= 3) {
    score += wine.savory * 1.2;
    score -= Math.max(0, wine.tannin - 3.5) * food.umami * 1.5;
    if (wine.savory >= 3.5) reasons.push("Savory maturity echoes the umami flavors.");
  }
  if (food.spice >= 3) {
    const heatRisk = Math.max(0, wine.alcohol - 2.5) + Math.max(0, wine.tannin - 2.5);
    score -= heatRisk * food.spice * 2.5;
    reasons.push("Alcohol and tannin may amplify the spice.");
  }
  if (food.salt >= 3 && wine.freshness >= 3.5) {
    score += 4;
    reasons.push("Freshness should work with the salt.");
  }

  const stateAdjustment = {
    hold: -25,
    trial: -6,
    ready: 4,
    priority: 7,
    late: 2,
    "assess-now": -6,
  }[inference.maturity.state];
  score += stateAdjustment;
  if (inference.maturity.state === "hold") {
    reasons.push("It is penalized because the maturity model says to hold it.");
  } else if (["priority", "late"].includes(inference.maturity.state)) {
    reasons.push("It receives a small priority boost because it should be assessed soon.");
  }

  return {
    score: Math.round(clamp(score, 0, 100)),
    suitable: score >= 55 && sweetnessDeficit <= 1,
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}

export function rankPairings(inferences, dishProfiles, limit = 3) {
  return dishProfiles.map((dish) => {
    const ranked = inferences
      .filter((inference) => inference.status === "inferred")
      .map((inference) => ({
        sampleId: inference.sampleId,
        wine: inference.wine,
        maturityState: inference.maturity.state,
        confidence: Number(Math.min(inference.confidence, 0.72).toFixed(2)),
        ...pairingScore(inference, dish),
      }))
      .sort((left, right) => right.score - left.score || left.sampleId.localeCompare(right.sampleId));
    const suitable = ranked.filter((candidate) => candidate.suitable).slice(0, limit);
    return {
      dishId: dish.id,
      dishName: dish.name,
      status: suitable.length > 0 ? "suggestions" : "no-suitable-wine",
      suggestions: suitable,
      bestRejected: suitable.length === 0 ? ranked.slice(0, 1) : [],
    };
  });
}

export function runInferencePoc(sampleInput, knowledgeInput) {
  const sample = validatePocSample(sampleInput);
  const knowledge = validateKnowledge(knowledgeInput);
  const inferences = sample.wines.map((wine) =>
    inferWine(wine, sample.asOfYear, knowledge),
  );
  const pairings = rankPairings(inferences, knowledge.dishProfiles);
  const inferred = inferences.filter((result) => result.status === "inferred");
  const sourceIds = new Set(inferred.flatMap((result) => result.evidence));
  return {
    schemaVersion: 1,
    status: "proof-of-concept",
    asOfYear: sample.asOfYear,
    summary: {
      wines: sample.wines.length,
      inferred: inferred.length,
      insufficientKnowledge: sample.wines.length - inferred.length,
      highConfidence: inferred.filter((result) => result.confidenceLabel === "high").length,
      mediumConfidence: inferred.filter((result) => result.confidenceLabel === "medium").length,
      lowConfidence: inferred.filter((result) => result.confidenceLabel === "low").length,
      sourceCount: sourceIds.size,
      dishes: pairings.length,
      dishesWithSuggestions: pairings.filter((pairing) => pairing.status === "suggestions").length,
    },
    sources: knowledge.sources.filter((source) => sourceIds.has(source.id)),
    inferences,
    pairings,
  };
}
