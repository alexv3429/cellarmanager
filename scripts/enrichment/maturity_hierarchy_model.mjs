const wineColors = new Set([
  "red",
  "white",
  "rose",
  "sparkling",
  "sweet",
  "fortified",
  "other",
]);

const windowFields = ["first", "bestStart", "bestEnd", "outer"];

export function normalizeHierarchyText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replaceAll("œ", "oe")
    .replaceAll("Œ", "OE")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function addAdjustment(target, adjustment = {}) {
  for (const field of windowFields) {
    target[field] += Number(adjustment[field] ?? 0);
  }
}

function addTraits(target, traits = {}) {
  for (const [trait, value] of Object.entries(traits)) {
    target[trait] = Number(((target[trait] ?? 0) + Number(value)).toFixed(2));
  }
}

function requireText(value, field, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be non-empty text`);
  }
}

function validateAdjustment(adjustment, field, errors, { absolute = false } = {}) {
  if (typeof adjustment !== "object" || adjustment === null || Array.isArray(adjustment)) {
    errors.push(`${field} must be an object`);
    return;
  }
  for (const windowField of windowFields) {
    const value = adjustment[windowField];
    if (!Number.isInteger(value)) {
      errors.push(`${field}.${windowField} must be an integer`);
    } else if (absolute && (value < 0 || value > 100)) {
      errors.push(`${field}.${windowField} must be between 0 and 100`);
    } else if (!absolute && (value < -50 || value > 50)) {
      errors.push(`${field}.${windowField} must be between -50 and 50`);
    }
  }
  if (
    absolute &&
    windowFields.every((windowField) => Number.isInteger(adjustment[windowField])) &&
    (adjustment.first > adjustment.bestStart ||
      adjustment.bestStart > adjustment.bestEnd ||
      adjustment.bestEnd > adjustment.outer)
  ) {
    errors.push(`${field} must be monotonic`);
  }
}

function validateEvidence(profile, field, sourceIds, errors) {
  if (!Array.isArray(profile.evidence) || profile.evidence.length === 0) {
    errors.push(`${field}.evidence must contain at least one source id`);
  } else {
    for (const sourceId of profile.evidence) {
      if (!sourceIds.has(sourceId)) {
        errors.push(`${field}.evidence references unknown source ${sourceId}`);
      }
    }
  }
  if (
    typeof profile.confidence !== "number" ||
    profile.confidence < 0 ||
    profile.confidence > 1
  ) {
    errors.push(`${field}.confidence must be between 0 and 1`);
  }
  requireText(profile.rationale, `${field}.rationale`, errors);
}

function validateAliases(profile, field, errors) {
  if (!Array.isArray(profile.aliases) || profile.aliases.length === 0) {
    errors.push(`${field}.aliases must contain at least one value`);
  } else if (profile.aliases.some((alias) => !normalizeHierarchyText(alias))) {
    errors.push(`${field}.aliases must not normalize to empty text`);
  }
}

export function validateHierarchyKnowledge(knowledge) {
  const errors = [];
  if (typeof knowledge !== "object" || knowledge === null || Array.isArray(knowledge)) {
    throw new Error("Hierarchy knowledge must be an object");
  }
  if (knowledge.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (knowledge.knowledgeVersion !== 3) errors.push("knowledgeVersion must be 3");
  requireText(knowledge.modelVersion, "modelVersion", errors);
  requireText(knowledge.label, "label", errors);
  requireText(knowledge.reviewedOn, "reviewedOn", errors);
  if (!String(knowledge.methodologyUrl ?? "").startsWith("https://")) {
    errors.push("methodologyUrl must use https");
  }
  for (const collection of [
    "sources",
    "places",
    "vintages",
    "producerEras",
    "cuvees",
    "releases",
  ]) {
    if (!Array.isArray(knowledge[collection])) {
      errors.push(`${collection} must be an array`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid hierarchy knowledge:\n- ${errors.join("\n- ")}`);
  }

  const sourceIds = new Set();
  for (const [index, source] of knowledge.sources.entries()) {
    const field = `sources[${index}]`;
    requireText(source.id, `${field}.id`, errors);
    requireText(source.name, `${field}.name`, errors);
    requireText(source.kind, `${field}.kind`, errors);
    if (sourceIds.has(source.id)) errors.push(`duplicate source ${source.id}`);
    sourceIds.add(source.id);
    if (source.url !== null && !String(source.url).startsWith("https://")) {
      errors.push(`${field}.url must be null or use https`);
    }
  }

  const places = new Map();
  for (const [index, place] of knowledge.places.entries()) {
    const field = `places[${index}]`;
    requireText(place.id, `${field}.id`, errors);
    requireText(place.name, `${field}.name`, errors);
    validateAliases(place, field, errors);
    validateEvidence(place, field, sourceIds, errors);
    if (!wineColors.has(place.color)) errors.push(`${field}.color is unsupported`);
    if (places.has(place.id)) errors.push(`duplicate place ${place.id}`);
    places.set(place.id, place);
    if (place.parentId === null) {
      validateAdjustment(place.window, `${field}.window`, errors, { absolute: true });
    } else {
      validateAdjustment(place.windowAdjustment, `${field}.windowAdjustment`, errors);
    }
  }
  for (const place of places.values()) {
    if (place.parentId !== null && !places.has(place.parentId)) {
      errors.push(`place ${place.id} references unknown parent ${place.parentId}`);
    }
  }

  const vintageKeys = new Set();
  for (const [index, vintage] of knowledge.vintages.entries()) {
    const field = `vintages[${index}]`;
    requireText(vintage.id, `${field}.id`, errors);
    if (!places.has(vintage.placeId)) errors.push(`${field}.placeId is unknown`);
    if (!wineColors.has(vintage.color)) errors.push(`${field}.color is unsupported`);
    if (!Number.isInteger(vintage.vintage)) errors.push(`${field}.vintage must be an integer`);
    validateAdjustment(vintage.windowAdjustment, `${field}.windowAdjustment`, errors);
    validateEvidence(vintage, field, sourceIds, errors);
    if (!Array.isArray(vintage.tags)) errors.push(`${field}.tags must be an array`);
    const key = `${vintage.placeId}:${vintage.color}:${vintage.vintage}`;
    if (vintageKeys.has(key)) errors.push(`duplicate vintage ${key}`);
    vintageKeys.add(key);
  }

  const producerKeys = new Set();
  for (const [index, producer] of knowledge.producerEras.entries()) {
    const field = `producerEras[${index}]`;
    requireText(producer.id, `${field}.id`, errors);
    requireText(producer.producerKey, `${field}.producerKey`, errors);
    requireText(producer.name, `${field}.name`, errors);
    validateAliases(producer, field, errors);
    validateAdjustment(producer.windowAdjustment, `${field}.windowAdjustment`, errors);
    validateEvidence(producer, field, sourceIds, errors);
    if (!wineColors.has(producer.color)) errors.push(`${field}.color is unsupported`);
    if (!Number.isInteger(producer.firstVintage)) {
      errors.push(`${field}.firstVintage must be an integer`);
    }
    if (producer.finalVintage !== null && !Number.isInteger(producer.finalVintage)) {
      errors.push(`${field}.finalVintage must be null or an integer`);
    }
    const key = `${producer.producerKey}:${producer.color}:${producer.firstVintage}:${producer.finalVintage}`;
    if (producerKeys.has(key)) errors.push(`duplicate producer era ${key}`);
    producerKeys.add(key);
    for (const [interactionIndex, interaction] of (producer.interactions ?? []).entries()) {
      if (!Array.isArray(interaction.tagsAll) || interaction.tagsAll.length === 0) {
        errors.push(`${field}.interactions[${interactionIndex}].tagsAll must not be empty`);
      }
      validateAdjustment(
        interaction.windowAdjustment,
        `${field}.interactions[${interactionIndex}].windowAdjustment`,
        errors,
      );
    }
  }

  const cuveeKeys = new Set();
  for (const [index, cuvee] of knowledge.cuvees.entries()) {
    const field = `cuvees[${index}]`;
    requireText(cuvee.id, `${field}.id`, errors);
    requireText(cuvee.producerKey, `${field}.producerKey`, errors);
    requireText(cuvee.name, `${field}.name`, errors);
    validateAliases(cuvee, field, errors);
    validateAdjustment(cuvee.windowAdjustment, `${field}.windowAdjustment`, errors);
    validateEvidence(cuvee, field, sourceIds, errors);
    if (!places.has(cuvee.placeId)) errors.push(`${field}.placeId is unknown`);
    if (!wineColors.has(cuvee.color)) errors.push(`${field}.color is unsupported`);
    const key = `${cuvee.producerKey}:${cuvee.id}:${cuvee.color}`;
    if (cuveeKeys.has(key)) errors.push(`duplicate cuvee ${key}`);
    cuveeKeys.add(key);
  }

  const releaseKeys = new Set();
  for (const [index, release] of knowledge.releases.entries()) {
    const field = `releases[${index}]`;
    requireText(release.id, `${field}.id`, errors);
    requireText(release.producerKey, `${field}.producerKey`, errors);
    requireText(release.cuveeId, `${field}.cuveeId`, errors);
    if (!Number.isInteger(release.vintage)) errors.push(`${field}.vintage must be an integer`);
    validateAdjustment(release.windowAdjustment, `${field}.windowAdjustment`, errors);
    validateEvidence(release, field, sourceIds, errors);
    const key = `${release.producerKey}:${release.cuveeId}:${release.vintage}`;
    if (releaseKeys.has(key)) errors.push(`duplicate release ${key}`);
    releaseKeys.add(key);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid hierarchy knowledge:\n- ${errors.join("\n- ")}`);
  }
  return {
    cuveeCount: cuveeKeys.size,
    placeCount: places.size,
    producerEraCount: producerKeys.size,
    releaseCount: releaseKeys.size,
    sourceCount: sourceIds.size,
    vintageCount: vintageKeys.size,
  };
}

function canonicalColor(value) {
  const color = normalizeHierarchyText(value);
  if (["red", "rouge"].includes(color)) return "red";
  if (["white", "blanc"].includes(color)) return "white";
  if (["rose", "pink"].includes(color)) return "rose";
  if (["sparkling", "effervescent", "champagne"].includes(color)) return "sparkling";
  if (["sweet", "doux", "liquoreux"].includes(color)) return "sweet";
  if (["fortified", "fortifie"].includes(color)) return "fortified";
  return "other";
}

function matchesAlias(profile, value) {
  const normalized = normalizeHierarchyText(value);
  return profile.aliases.some((alias) => normalizeHierarchyText(alias) === normalized);
}

function buildPlacePath(placeIndex, leaf) {
  const path = [];
  const visited = new Set();
  let place = leaf;
  while (place) {
    if (visited.has(place.id)) throw new Error(`Place cycle at ${place.id}`);
    visited.add(place.id);
    path.unshift(place);
    place = place.parentId ? placeIndex.get(place.parentId) : null;
  }
  return path;
}

function contribution(layer, profile, adjustment, extra = {}) {
  return {
    adjustment: Object.fromEntries(
      windowFields.map((field) => [field, Number(adjustment?.[field] ?? 0)]),
    ),
    confidence: profile.confidence,
    evidence: profile.evidence,
    label: profile.name ?? profile.id,
    layer,
    rationale: profile.rationale,
    traits: profile.traits ?? {},
    ...extra,
  };
}

export function inferHierarchicalMaturity(knowledge, wine) {
  validateHierarchyKnowledge(knowledge);
  if (!Number.isInteger(wine.vintage)) {
    return { reason: "missing-vintage", status: "needs-review", wine };
  }
  const color = canonicalColor(wine.color);
  const placeIndex = new Map(knowledge.places.map((place) => [place.id, place]));
  const confirmedProducerKey = normalizeHierarchyText(wine.producerKey);
  const producer = knowledge.producerEras.find(
    (candidate) =>
      candidate.color === color &&
      wine.vintage >= candidate.firstVintage &&
      (candidate.finalVintage === null || wine.vintage <= candidate.finalVintage) &&
      ((confirmedProducerKey &&
        normalizeHierarchyText(candidate.producerKey) === confirmedProducerKey) ||
        (candidate.matchPolicy === "exact-canonical-name" &&
          normalizeHierarchyText(candidate.name) === normalizeHierarchyText(wine.producer))),
  );
  const cuvee = producer
    ? knowledge.cuvees.find(
        (candidate) =>
          candidate.producerKey === producer.producerKey &&
          candidate.color === color &&
          matchesAlias(candidate, wine.cuvee),
      )
    : null;

  let leaf = cuvee ? placeIndex.get(cuvee.placeId) : null;
  if (!leaf) {
    leaf = knowledge.places
      .filter((place) => place.color === color && matchesAlias(place, wine.appellation))
      .sort((left, right) => buildPlacePath(placeIndex, right).length - buildPlacePath(placeIndex, left).length)[0];
  }
  if (!leaf) {
    return { reason: "unsupported-place-profile", status: "needs-review", wine };
  }

  const path = buildPlacePath(placeIndex, leaf);
  const root = path[0];
  if (!root.window) throw new Error(`Root place ${root.id} has no base window`);
  const ages = { ...root.window };
  const traits = { ...(root.traits ?? {}) };
  const contributions = [contribution("region", root, {})];
  for (const place of path.slice(1)) {
    addAdjustment(ages, place.windowAdjustment);
    addTraits(traits, place.traits);
    contributions.push(contribution(place.type ?? "place", place, place.windowAdjustment));
  }

  const pathIds = new Set(path.map((place) => place.id));
  const vintage = knowledge.vintages
    .filter(
      (candidate) =>
        candidate.color === color &&
        candidate.vintage === wine.vintage &&
        pathIds.has(candidate.placeId),
    )
    .sort(
      (left, right) =>
        path.findIndex((place) => place.id === right.placeId) -
        path.findIndex((place) => place.id === left.placeId),
    )[0];
  if (vintage) {
    addAdjustment(ages, vintage.windowAdjustment);
    addTraits(traits, vintage.traits);
    contributions.push(
      contribution("vintage", vintage, vintage.windowAdjustment, { tags: vintage.tags }),
    );
  }

  if (producer) {
    addAdjustment(ages, producer.windowAdjustment);
    addTraits(traits, producer.traits);
    contributions.push(contribution("producer-era", producer, producer.windowAdjustment));
    for (const interaction of producer.interactions ?? []) {
      if (interaction.tagsAll.every((tag) => vintage?.tags.includes(tag))) {
        addAdjustment(ages, interaction.windowAdjustment);
        addTraits(traits, interaction.traits);
        contributions.push(
          contribution("interaction", producer, interaction.windowAdjustment, {
            label: interaction.label,
            rationale: interaction.rationale,
            traits: interaction.traits ?? {},
          }),
        );
      }
    }
  }

  if (cuvee) {
    addAdjustment(ages, cuvee.windowAdjustment);
    addTraits(traits, cuvee.traits);
    contributions.push(contribution("cuvee", cuvee, cuvee.windowAdjustment));
  }

  const release = cuvee
    ? knowledge.releases.find(
        (candidate) =>
          candidate.producerKey === producer.producerKey &&
          candidate.cuveeId === cuvee.id &&
          candidate.vintage === wine.vintage,
      )
    : null;
  if (release) {
    addAdjustment(ages, release.windowAdjustment);
    addTraits(traits, release.traits);
    contributions.push(contribution("release", release, release.windowAdjustment));
  }

  ages.first = Math.max(0, ages.first);
  ages.bestStart = Math.max(ages.first, ages.bestStart);
  ages.bestEnd = Math.max(ages.bestStart, ages.bestEnd);
  ages.outer = Math.max(ages.bestEnd, ages.outer);

  const evidenceLayers = contributions.filter((item) => item.layer !== "interaction");
  // Every selected layer is material to the published window. Using an
  // average here would let several well-supported broad layers hide a weak
  // exact cuvee or release assumption. The least-supported material layer is
  // therefore the conservative reliability ceiling for the full result.
  const confidence = Math.min(...evidenceLayers.map((item) => item.confidence));
  const specificity = release
    ? "release"
    : cuvee
      ? "cuvee"
      : producer
        ? "producer-era"
        : path.length > 1
          ? "place"
          : "region";

  return {
    ages,
    color,
    confidence,
    confidenceLabel: confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low",
    contributions,
    specificity,
    status: "projected",
    traits,
    warnings: [
      ...(producer ? [] : ["No confirmed producer-era profile was used."]),
      ...(cuvee ? [] : ["No confirmed cuvee or climat profile was used."]),
      ...(vintage ? [] : ["No local vintage conditions were available."]),
    ],
    wine,
    years: Object.fromEntries(
      windowFields.map((field) => [field, wine.vintage + ages[field]]),
    ),
  };
}
