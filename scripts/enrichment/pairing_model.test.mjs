import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rankPairingCandidates, scorePairing } from "./pairing_model.mjs";

const freshWhite = {
  acidity: 4.5,
  alcohol: 2.5,
  body: 2.2,
  concentration: 2,
  freshness: 4.5,
  savory: 2,
  sweetness: 0,
  tannin: 0.4,
};

const structuredRed = {
  acidity: 3.5,
  alcohol: 3.5,
  body: 4.2,
  concentration: 4.2,
  freshness: 3.2,
  savory: 3.5,
  sweetness: 0,
  tannin: 4,
};

const sweetWine = {
  acidity: 3.5,
  alcohol: 3,
  body: 4,
  concentration: 4,
  freshness: 3,
  savory: 2,
  sweetness: 4.5,
  tannin: 1,
};

test("validates the expanded reviewed dish archetype library", () => {
  const knowledge = JSON.parse(
    readFileSync(
      new URL("./pairing_knowledge.json", import.meta.url),
      "utf8",
    ),
  );
  const migrations = [
    "../../supabase/migrations/20260825090000_pairing_projections.sql",
    "../../supabase/migrations/20260825110000_expanded_pairing_knowledge.sql",
    "../../supabase/migrations/20260825140000_refined_maury_knowledge.sql",
  ].map((path) =>
    readFileSync(new URL(path, import.meta.url), "utf8"),
  ).join("\n");
  const keys = new Set();

  assert.equal(knowledge.knowledgeVersion, 6);
  assert.equal(knowledge.modelVersion, "pairing-1.2.0");
  assert.equal(knowledge.dishes.length, 32);
  assert.deepEqual(
    knowledge.profileCorrections.map((profile) => ({
      classification: profile.classification,
      place: profile.place,
      sweetness: profile.sweetness,
    })),
    [
      {
        classification: "vin-doux-naturel",
        place: "Maury",
        sweetness: 4.5,
      },
      {
        classification: "dry",
        place: "Maury Sec",
        sweetness: 0,
      },
    ],
  );
  assert.match(migrations, /Maury without the mandatory Sec term/u);
  assert.match(migrations, /Maury Sec is the explicitly labelled dry red/u);

  for (const dish of knowledge.dishes) {
    assert.match(dish.key, /^[a-z0-9][a-z0-9-]*$/u);
    assert.ok(!keys.has(dish.key), `duplicate dish key: ${dish.key}`);
    assert.ok(dish.category.length > 0);
    assert.ok(dish.name.length > 0);
    assert.ok(dish.description.length > 0);
    assert.deepEqual(
      Object.keys(dish.attributes).sort(),
      [
        "acidity",
        "fat",
        "fish",
        "intensity",
        "protein",
        "salt",
        "spice",
        "sweetness",
        "umami",
      ],
    );
    assert.ok(
      Object.values(dish.attributes).every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 5,
      ),
    );
    assert.match(migrations, new RegExp(`"key":"${dish.key}"`, "u"));
    keys.add(dish.key);
  }
});

test("acidic salad favours a fresh ready wine", () => {
  const result = scorePairing({
    dish: {
      acidity: 4,
      fat: 1,
      fish: 0,
      intensity: 2,
      protein: 0,
      salt: 2,
      spice: 0,
      sweetness: 0,
      umami: 1,
    },
    maturityState: "ready",
    wine: freshWhite,
  });

  assert.equal(result.suitable, true);
  assert.ok(result.score >= 75);
  assert.match(result.reasons.join(" "), /acidity/i);
});

test("dessert never receives a dry-wine recommendation", () => {
  const result = scorePairing({
    dish: {
      acidity: 2,
      fat: 2,
      fish: 0,
      intensity: 3,
      protein: 0,
      salt: 0,
      spice: 0,
      sweetness: 4,
      umami: 0,
    },
    maturityState: "ready",
    wine: structuredRed,
  });

  assert.equal(result.suitable, false);
  assert.match(result.cautions.join(" "), /sweeter/i);
});

test("spice is a calibrated risk rather than an automatic red-wine rejection", () => {
  const result = scorePairing({
    dish: {
      acidity: 1,
      fat: 3,
      fish: 0,
      intensity: 4,
      protein: 4,
      salt: 2,
      spice: 3,
      sweetness: 1,
      umami: 2,
    },
    maturityState: "priority",
    wine: { ...structuredRed, alcohol: 3.2, tannin: 3.2 },
  });

  assert.equal(result.suitable, true);
  assert.ok(result.score >= 55);
});

test("a very sweet wine is not recommended for a mildly sweet lamb tagine", () => {
  const result = scorePairing({
    dish: {
      acidity: 1,
      fat: 3,
      fish: 0,
      intensity: 4,
      protein: 4,
      salt: 2,
      spice: 3,
      sweetness: 2,
      umami: 2,
    },
    maturityState: "ready",
    wine: sweetWine,
  });

  assert.equal(result.suitable, false);
  assert.match(result.cautions.join(" "), /too sweet/i);
});

test("the excess-sweetness guard retains the classic salty blue-cheese exception", () => {
  const result = scorePairing({
    dish: {
      acidity: 1,
      fat: 4,
      fish: 0,
      intensity: 5,
      protein: 3,
      salt: 5,
      spice: 0,
      sweetness: 0,
      umami: 5,
    },
    maturityState: "ready",
    wine: sweetWine,
  });

  assert.equal(result.suitable, true);
  assert.doesNotMatch(result.cautions.join(" "), /too sweet/i);
});

test("explicit color filters and personal feedback refine only personal ranking", () => {
  const dish = {
    acidity: 1,
    fat: 4,
    fish: 0,
    intensity: 4,
    protein: 4,
    salt: 2,
    spice: 0,
    sweetness: 0,
    umami: 3,
  };
  const ranked = rankPairingCandidates(
    [
      { id: "red-liked", color: "red", maturityState: "ready", previousVerdict: "useful", traits: structuredRed },
      { id: "red-disliked", color: "red", maturityState: "ready", previousVerdict: "wrong", traits: structuredRed },
      { id: "white", color: "white", maturityState: "ready", traits: freshWhite },
    ],
    dish,
    { preferredColors: ["red"], preferredStyle: "rich" },
  );

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["red-liked", "red-disliked"]);
  assert.ok(ranked[0].score > ranked[1].score);
});
