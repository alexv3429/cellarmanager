import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessKnowledgeCoverage,
  defaultKnowledgePath,
  normalizeWineText,
  renderExpandedKnowledgeMigration,
  validateMaturityKnowledge,
} from "./maturity_knowledge_v2.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const baseMigrationPath = resolve(
  scriptDirectory,
  "../../supabase/migrations/20260822090000_maturity_projections.sql",
);

async function knowledgeFixture() {
  return JSON.parse(await readFile(defaultKnowledgePath, "utf8"));
}

test("validates the reviewed maturity v2 dataset", async () => {
  const counts = validateMaturityKnowledge(await knowledgeFixture());

  assert.deepEqual(counts, {
    aliasCount: 204,
    archetypeCount: 70,
    placeCount: 149,
    placeProfileCount: 151,
    sourceCount: 12,
    vintageProfileCount: 67,
  });
});

test("normalizes punctuation and accents like the database boundary", () => {
  assert.equal(normalizeWineText("Moulin-à-Vent"), "moulin a vent");
  assert.equal(normalizeWineText("Côtes d’Auvergne"), "cotes d auvergne");
  assert.equal(normalizeWineText("CŒUR de Cuvée"), "coeur de cuvee");
});

test("rejects a cross-place alias collision", async () => {
  const knowledge = await knowledgeFixture();
  knowledge.places[1].aliases.push("Burgundy");

  assert.throws(
    () => validateMaturityKnowledge(knowledge),
    /alias collision.*Burgundy.*bourgogne.*beaujolais/,
  );
});

test("reports exact coverage and preserves unsafe cases", async () => {
  const knowledge = await knowledgeFixture();
  const coverage = assessKnowledgeCoverage(knowledge, [
    {
      appellation: "Saint-Véran",
      bottles: 4,
      color: "white",
      vintage_count: 2,
      wines: 2,
    },
    {
      appellation: "Terrasses du Larzac",
      bottles: 1,
      color: "rose",
      vintage_count: 1,
      wines: 1,
    },
    {
      appellation: "Champagne",
      bottles: 2,
      color: "sparkling",
      vintage_count: 0,
      wines: 2,
    },
  ]);

  assert.deepEqual(coverage.covered, { bottles: 4, wines: 2 });
  assert.deepEqual(coverage.reasons, {
    "appellation-color-conflict": { bottles: 1, groups: 1, wines: 1 },
    "missing-vintage": { bottles: 2, groups: 1, wines: 2 },
  });
});

test("generates an explicit-only and reason-aware SQL migration", async () => {
  const [knowledge, baseMigrationSql] = await Promise.all([
    knowledgeFixture(),
    readFile(baseMigrationPath, "utf8"),
  ]);
  const sql = renderExpandedKnowledgeMigration(knowledge, baseMigrationSql);

  assert.match(sql, /install_expanded_maturity_knowledge/);
  assert.match(sql, /'place_profile_count', 151/);
  assert.match(sql, /v_place_match text := 'exact-appellation'/);
  assert.match(sql, /assessment_reason/);
  assert.doesNotMatch(sql, /v_place_match := 'area-fallback'/);
  assert.doesNotMatch(sql, /broader compatible area profile was used/);
});
