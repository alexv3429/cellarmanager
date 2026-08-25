const ATTRIBUTE_KEYS = [
  "intensity",
  "fat",
  "acidity",
  "sweetness",
  "salt",
  "umami",
  "spice",
  "protein",
  "fish",
];

const WINE_TRAIT_KEYS = [
  "body",
  "acidity",
  "tannin",
  "sweetness",
  "alcohol",
  "freshness",
  "savory",
  "concentration",
];

export const PAIRING_STYLES = ["fresh", "light", "rich", "savory", "mature"];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) {
    throw new Error(`${field} must be a number between 0 and 5`);
  }
  return value;
}

function validateShape(input, keys, field) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${field} must be an object`);
  }
  return Object.fromEntries(
    keys.map((key) => [key, boundedNumber(input[key], `${field}.${key}`)]),
  );
}

export function validateDishAttributes(input) {
  return validateShape(input, ATTRIBUTE_KEYS, "dish attributes");
}

export function validateWineTraits(input) {
  return validateShape(input, WINE_TRAIT_KEYS, "wine traits");
}

export function scorePairing({
  dish: dishInput,
  maturityState = null,
  preferredStyle = null,
  previousVerdict = null,
  wine: wineInput,
}) {
  const dish = validateDishAttributes(dishInput);
  const wine = validateWineTraits(wineInput);
  if (preferredStyle !== null && !PAIRING_STYLES.includes(preferredStyle)) {
    throw new Error("Unsupported pairing style preference");
  }

  const reasons = [];
  const cautions = [];
  let score = 82;

  const intensityGap = Math.abs(wine.body - dish.intensity);
  score -= intensityGap * 7;
  if (intensityGap <= 0.8) {
    reasons.push("Wine and dish intensity are well matched.");
  } else if (intensityGap > 2) {
    cautions.push("The wine and dish differ substantially in intensity.");
  }

  const acidityDeficit = dish.acidity - wine.acidity;
  if (acidityDeficit > 0.5) {
    score -= acidityDeficit * 11;
    cautions.push("The dish may make this wine seem insufficiently fresh.");
  } else if (dish.acidity >= 3 && wine.acidity >= dish.acidity - 0.5) {
    score += 5;
    reasons.push("Its acidity can stand up to the dish.");
  }

  const sweetnessDeficit = dish.sweetness - wine.sweetness;
  if (sweetnessDeficit > 0) {
    score -= sweetnessDeficit * 18;
    cautions.push("The dish is sweeter than the wine.");
  }

  const excessSweetness = wine.sweetness - dish.sweetness;
  const supportsSweetSavoryContrast =
    dish.sweetness < 3 && dish.salt >= 4 && dish.umami >= 4;
  const hasExcessSweetness =
    dish.sweetness < 3 &&
    !supportsSweetSavoryContrast &&
    excessSweetness > 0.75;
  const hasUnsafeExcessSweetness =
    hasExcessSweetness && excessSweetness > 1.5;
  if (hasExcessSweetness) {
    score -= (excessSweetness - 0.75) * 14;
    cautions.push("The wine may be too sweet for this savoury dish.");
  }

  if (dish.fat >= 3) {
    score += (wine.acidity + wine.tannin) * 1.2;
    reasons.push("Acidity and structure can balance the richness.");
  }
  if (dish.protein >= 3) {
    score += wine.tannin * 1.5;
  }
  if (dish.fish >= 3 && wine.tannin > 2.5) {
    score -= (wine.tannin - 2.5) * dish.fish * 3;
    cautions.push("Tannin may become metallic or harsh with the fish.");
  }
  if (dish.umami >= 3) {
    score += wine.savory * 1.2;
    score -= Math.max(0, wine.tannin - 3.5) * dish.umami * 1.5;
    if (wine.savory >= 3.5) {
      reasons.push("The wine's savoury character echoes the dish's umami.");
    }
  }
  if (dish.spice >= 3) {
    const heatRisk = Math.max(0, wine.alcohol - 3.5) + Math.max(0, wine.tannin - 3.5);
    score -= heatRisk * dish.spice * 1.5;
    score += Math.max(0, wine.freshness - 3) * 1.5;
    if (heatRisk > 1) {
      cautions.push("High alcohol or firm tannin may amplify chilli heat.");
    } else {
      reasons.push("Moderate alcohol and tannin limit the spice risk.");
    }
  }
  if (dish.salt >= 3 && wine.freshness >= 3.5) {
    score += 4;
    reasons.push("Freshness should work well with the salt.");
  }

  const maturityAdjustment = {
    hold: -25,
    assess: -6,
    ready: 4,
    priority: 7,
    "assess-now": 2,
  }[maturityState] ?? -2;
  score += maturityAdjustment;
  if (maturityState === "hold") {
    cautions.push("The maturity model recommends holding this bottle.");
  } else if (maturityState === "priority") {
    reasons.push("This bottle should be prioritised according to its maturity window.");
  } else if (maturityState === "ready") {
    reasons.push("The bottle is inside its likely drinking period.");
  } else if (maturityState === null) {
    cautions.push("No maturity window is available, so readiness is uncertain.");
  }

  const styleAdjustment = {
    fresh: (wine.acidity + wine.freshness - 5) * 2,
    light: (7 - wine.body - wine.alcohol) * 2,
    rich: (wine.body + wine.concentration - 5) * 2,
    savory: (wine.savory - 2.5) * 3,
    mature: ["ready", "priority", "assess-now"].includes(maturityState) ? 8 : -5,
  }[preferredStyle] ?? 0;
  score += styleAdjustment;
  if (preferredStyle && styleAdjustment >= 3) {
    reasons.push(`It fits your ${preferredStyle} style preference.`);
  } else if (preferredStyle && styleAdjustment <= -3) {
    cautions.push(`It is a weak fit for your ${preferredStyle} style preference.`);
  }

  const personalAdjustment = {
    useful: 6,
    questionable: -4,
    wrong: -18,
  }[previousVerdict] ?? 0;
  score += personalAdjustment;
  if (personalAdjustment > 0) {
    reasons.push("You previously liked this wine with this dish profile.");
  } else if (personalAdjustment < 0) {
    cautions.push("Your previous feedback lowers this personal recommendation.");
  }

  const roundedScore = Math.round(clamp(score, 0, 100));
  return {
    baseScore: Math.round(clamp(score - styleAdjustment - personalAdjustment, 0, 100)),
    cautions: [...new Set(cautions)].slice(0, 4),
    personalAdjustment,
    reasons: [...new Set(reasons)].slice(0, 5),
    score: roundedScore,
    styleAdjustment: Math.round(styleAdjustment),
    suitable:
      roundedScore >= 55 &&
      (dish.sweetness < 3 || sweetnessDeficit <= 0.75) &&
      !hasUnsafeExcessSweetness,
  };
}

export function rankPairingCandidates(candidates, dish, options = {}) {
  const preferredColors = new Set(options.preferredColors ?? []);
  return candidates
    .filter((candidate) => preferredColors.size === 0 || preferredColors.has(candidate.color))
    .map((candidate) => ({
      ...candidate,
      ...scorePairing({
        dish,
        maturityState: candidate.maturityState,
        preferredStyle: options.preferredStyle ?? null,
        previousVerdict: candidate.previousVerdict ?? null,
        wine: candidate.traits,
      }),
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
