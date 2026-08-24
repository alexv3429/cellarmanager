import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  inferHierarchicalMaturity,
  validateHierarchyKnowledge,
} from "./maturity_hierarchy_model.mjs";
import {
  defaultMigrationPath,
  renderHierarchicalKnowledgeMigration,
} from "./maturity_hierarchy_sql.mjs";

const knowledge = JSON.parse(
  await readFile(new URL("./maturity_hierarchy_poc.json", import.meta.url), "utf8"),
);

test("validates the hierarchical proof-of-concept knowledge", () => {
  assert.deepEqual(validateHierarchyKnowledge(knowledge), {
    cuveeCount: 6,
    placeCount: 5,
    producerEraCount: 3,
    releaseCount: 1,
    sourceCount: 11,
    vintageCount: 7,
  });
});

test("keeps the generated v3 migration synchronized with reviewed knowledge", async () => {
  assert.equal(
    await readFile(defaultMigrationPath, "utf8"),
    renderHierarchicalKnowledgeMigration(knowledge),
  );
});

test("reproduces the reviewed Les Evocelles vintage ordering", () => {
  const expected = new Map([
    [2017, { first: 2021, bestStart: 2023, bestEnd: 2029, outer: 2034 }],
    [2018, { first: 2023, bestStart: 2025, bestEnd: 2033, outer: 2038 }],
    [2019, { first: 2022, bestStart: 2024, bestEnd: 2034, outer: 2039 }],
    [2020, { first: 2026, bestStart: 2028, bestEnd: 2038, outer: 2043 }],
    [2021, { first: 2024, bestStart: 2026, bestEnd: 2030, outer: 2034 }],
    [2022, { first: 2026, bestStart: 2028, bestEnd: 2035, outer: 2040 }],
  ]);

  for (const [vintage, years] of expected) {
    const result = inferHierarchicalMaturity(knowledge, {
      appellation: "Gevrey-Chambertin",
      color: "red",
      cuvee: "Evocelles",
      producer: "Boillot",
      producerKey: "louis-boillot",
      vintage,
    });
    assert.equal(result.status, "projected");
    assert.deepEqual(result.years, years);
    assert.equal(result.specificity, vintage === 2021 ? "release" : "cuvee");
  }
});

test("applies hot-vintage interaction without delaying first assessment", () => {
  const result = inferHierarchicalMaturity(knowledge, {
    appellation: "Gevrey Chambertin",
    color: "Rouge",
    cuvee: "Les Evocelles",
    producer: "Louis Boillot",
    producerKey: "louis-boillot",
    vintage: 2019,
  });

  assert.deepEqual(result.ages, {
    first: 3,
    bestStart: 5,
    bestEnd: 15,
    outer: 20,
  });
  assert.ok(
    result.contributions.some(
      (item) =>
        item.layer === "interaction" &&
        item.label === "Early harvest and freshness retention in a hot, dry vintage",
    ),
  );
});

test("selects the transition producer era by vintage", () => {
  const established = inferHierarchicalMaturity(knowledge, {
    appellation: "Gevrey-Chambertin",
    color: "red",
    cuvee: "Evocelles",
    producer: "Boillot",
    producerKey: "louis-boillot",
    vintage: 2021,
  });
  const transition = inferHierarchicalMaturity(knowledge, {
    appellation: "Gevrey-Chambertin",
    color: "red",
    cuvee: "Evocelles",
    producer: "Boillot",
    producerKey: "louis-boillot",
    vintage: 2022,
  });

  assert.ok(
    established.contributions.some(
      (item) => item.label === "Louis Boillot — established era",
    ),
  );
  assert.ok(
    transition.contributions.some(
      (item) => item.label === "Louis and Clément Boillot — transition era",
    ),
  );
  assert.equal(established.confidenceLabel, "medium");
  assert.equal(transition.confidenceLabel, "medium");
});

test("distinguishes Cal Demoura cuvees within one producer, place, and vintage", () => {
  const expected = new Map([
    ["Terres de Jonquieres", { first: 2026, bestStart: 2027, bestEnd: 2028, outer: 2033 }],
    ["Combariolles", { first: 2028, bestStart: 2030, bestEnd: 2032, outer: 2038 }],
    ["Belle Fiolle", { first: 2026, bestStart: 2027, bestEnd: 2030, outer: 2036 }],
    ["Feu Sacre", { first: 2030, bestStart: 2033, bestEnd: 2038, outer: 2043 }],
    ["Fragments", { first: 2031, bestStart: 2035, bestEnd: 2040, outer: 2046 }],
  ]);

  for (const [cuvee, years] of expected) {
    const result = inferHierarchicalMaturity(knowledge, {
      appellation: "Terrasses du Larzac",
      color: "red",
      cuvee,
      producer: "Cal Demoura",
      producerKey: "cal-demoura",
      vintage: 2023,
    });
    assert.equal(result.status, "projected");
    assert.equal(result.specificity, "cuvee");
    assert.deepEqual(result.years, years);
  }
});

test("keeps reliability separate from specificity", () => {
  const placeResult = inferHierarchicalMaturity(knowledge, {
    appellation: "Gevrey-Chambertin",
    color: "red",
    cuvee: "Unknown cuvee",
    producer: "Unknown producer",
    vintage: 2018,
  });
  const cuveeResult = inferHierarchicalMaturity(knowledge, {
    appellation: "Gevrey-Chambertin",
    color: "red",
    cuvee: "Les Evocelles",
    producer: "Louis Boillot",
    producerKey: "louis-boillot",
    vintage: 2018,
  });

  assert.equal(placeResult.status, "projected");
  assert.equal(placeResult.specificity, "place");
  assert.equal(placeResult.confidenceLabel, "high");
  assert.deepEqual(placeResult.warnings, [
    "No confirmed producer-era profile was used.",
    "No confirmed cuvee or climat profile was used.",
  ]);
  assert.equal(cuveeResult.specificity, "cuvee");
  assert.equal(cuveeResult.confidenceLabel, "medium");
  assert.ok(cuveeResult.confidence < placeResult.confidence);
});

test("does not select an ambiguous producer alias without a confirmed key", () => {
  const result = inferHierarchicalMaturity(knowledge, {
    appellation: "Gevrey-Chambertin",
    color: "red",
    cuvee: "Evocelles",
    producer: "Boillot",
    vintage: 2018,
  });

  assert.equal(result.specificity, "place");
  assert.ok(
    result.warnings.includes("No confirmed producer-era profile was used."),
  );
  assert.ok(
    result.contributions.every(
      (item) => !["producer-era", "interaction", "cuvee"].includes(item.layer),
    ),
  );
});

test("does not invent a release without a vintage", () => {
  assert.deepEqual(
    inferHierarchicalMaturity(knowledge, {
      appellation: "Gevrey-Chambertin",
      color: "red",
      cuvee: "Evocelles",
      producer: "Boillot",
      producerKey: "louis-boillot",
      vintage: null,
    }),
    {
      reason: "missing-vintage",
      status: "needs-review",
      wine: {
        appellation: "Gevrey-Chambertin",
        color: "red",
        cuvee: "Evocelles",
        producer: "Boillot",
        producerKey: "louis-boillot",
        vintage: null,
      },
    },
  );
});
