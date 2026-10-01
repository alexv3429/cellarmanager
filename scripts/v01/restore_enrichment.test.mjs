import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { buildLegacyEnrichmentPlan } from "./restore_enrichment_lib.mjs"
import { renderRestorationSql, sha256 } from "./restore_metadata_lib.mjs"

const SOURCE_SHA = "a".repeat(64)
const WINE_ID = "33333333-3333-4333-8333-333333333333"
const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111"
const OWNER_ID = "22222222-2222-4222-8222-222222222222"

async function archive({ identifiers = [], profiles = [], sources = [], sourceSha = SOURCE_SHA } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "v01-enrichment-test-"))
  const exportsDir = path.join(directory, "source-export")
  await mkdir(exportsDir)
  const tables = {
    wines: [{ id: WINE_ID }],
    wine_external_identifiers: identifiers,
    wine_enrichment_profiles: profiles,
    enrichment_sources: sources,
  }
  const manifest = {}
  for (const [name, rows] of Object.entries(tables)) {
    const contents = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")
    await writeFile(path.join(exportsDir, `${name}.jsonl`), contents)
    manifest[name] = { export_file: `${name}.jsonl`, export_sha256: sha256(contents), rows: rows.length }
  }
  await writeFile(path.join(directory, "source-manifest.json"), JSON.stringify(manifest))
  await writeFile(path.join(directory, "import-plan.json"), JSON.stringify({ ready_to_apply: true, source: { sha256: sourceSha } }))
  return directory
}

function profile(extra = {}) {
  return {
    wine_id: WINE_ID,
    updated_at: "2026-08-20T12:00:00Z",
    version: 7,
    profile_json: JSON.stringify({
      "composition:composition": { value: { grapes: [{ name: "Pinot Noir", percentage: 100 }], sweetness: "dry", oak: "light", alcohol_percent: 13, certifications: [] } },
      "drinking_window:drinking_window": { value: { drink_after_year: 2026, drink_before_year: 2032 } },
      "identifiers:external_identifiers": { value: [{ scheme: "Shop SKU", value: "SKU-42" }] },
      "market_value:replacement_value": { value: { amount: 999999, currency: "EUR" } },
      "maturity:maturity": { value: { state: "ready", rationale: "Historical assessment" } },
      "pairing:dish_pairings": { value: [{ dish: "Roast chicken" }] },
      "reviews:critical_reviews": { value: [{ reviewer: "Critic", note_excerpt: "Do not copy this protected review excerpt" }] },
      "serving:serving_advice": { value: { temperature_min_c: 15, temperature_max_c: 17, decant_minutes: 30, stand_upright_hours: null, glass: null, method: "gentle" } },
      ...extra,
    }),
  }
}

test("restores exact-wine historical identifiers and a bounded non-authoritative summary", async () => {
  const archiveDir = await archive({
    identifiers: [{ wine_id: WINE_ID, scheme: "Shop SKU", value: "SKU-42", confidence: 0.69, source_id: "source-1", updated_at: "2026-08-19T12:00:00Z" }],
    profiles: [profile()],
    sources: [{ id: "source-1", url: "https://example.org/wine/42" }],
  })
  const plan = await buildLegacyEnrichmentPlan({ archiveDir, expectedSourceSha256: SOURCE_SHA })
  assert.deepEqual(plan.report.blockers, [])
  assert.equal(plan.report.external_identifiers, 1)
  assert.equal(plan.report.legacy_profiles, 1)
  assert.equal(plan.report.deferred.market_profile_values, 1)
  assert.equal(plan.report.deferred.profile_only_identifiers, 0)
  assert.equal(plan.report.observations, 1)
  assert.equal(plan.rows[0].wine_id, WINE_ID)
  assert.equal(plan.rows[0].observation_date, "2026-08-20")
  assert.match(plan.rows[0].observation_note, /Shop SKU: SKU-42 \(source: https:\/\/example\.org\/wine\/42\)/u)
  assert.match(plan.rows[0].observation_note, /not bottle barcodes/u)
  assert.match(plan.rows[0].observation_note, /not used for current wine facts, recommendations, or stock/u)
  assert.match(plan.rows[0].observation_note, /Roast chicken/u)
  assert.doesNotMatch(plan.rows[0].observation_note, /999999|protected review excerpt/u)
  assert.equal(plan.rows[0].country, undefined)

  const preview = renderRestorationSql({ apply: false, householdId: HOUSEHOLD_ID, recordedBy: OWNER_ID, plan, requireUnmerged: true })
  assert.match(preview, /rollback;\s*$/u)
  assert.match(preview, /and target\.merged_into_wine_id is null/u)
  assert.doesNotMatch(preview, /insert into public\.wine_barcode_links/u)
  assert.doesNotMatch(preview, /update public\.wines target/u)
  const rehearsal = renderRestorationSql({ apply: true, commit: false, expectedPreviewFingerprint: "b".repeat(32), householdId: HOUSEHOLD_ID, recordedBy: OWNER_ID, plan })
  assert.match(rehearsal, /Restoration preview changed/u)
  assert.match(rehearsal, /rollback;\s*$/u)
})

test("detects archive changes, unknown profile fields, and unsafe source URLs", async () => {
  const archiveDir = await archive({
    identifiers: [{ wine_id: WINE_ID, scheme: "Shop SKU", value: "SKU-42", confidence: 0.69, source_id: "source-1", updated_at: "2026-08-19T12:00:00Z" }],
    profiles: [profile({ "new:unknown": { value: "unsafe" } })],
    sources: [{ id: "source-1", url: "http://example.org/wine/42" }],
  })
  await assert.rejects(buildLegacyEnrichmentPlan({ archiveDir, expectedSourceSha256: "b".repeat(64) }), /Archive source hash mismatch/u)
  const plan = await buildLegacyEnrichmentPlan({ archiveDir, expectedSourceSha256: SOURCE_SHA })
  assert.deepEqual(plan.report.blockers.map((item) => item.reason).sort(), ["invalid-entry", "unknown-profile-field"])
  assert.throws(() => renderRestorationSql({ apply: false, householdId: HOUSEHOLD_ID, recordedBy: OWNER_ID, plan }), /plan has blockers/u)
})

test("reports profile-only candidate identifiers without promoting them", async () => {
  const archiveDir = await archive({
    profiles: [profile({ "identifiers:external_identifiers": { value: [{ scheme: "Shop SKU", value: "UNVERIFIED" }] } })],
  })
  const plan = await buildLegacyEnrichmentPlan({ archiveDir, expectedSourceSha256: SOURCE_SHA })
  assert.deepEqual(plan.report.blockers, [])
  assert.equal(plan.report.deferred.profile_only_identifiers, 1)
  assert.doesNotMatch(plan.rows[0].observation_note, /UNVERIFIED/u)
})
