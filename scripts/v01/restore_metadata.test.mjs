import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  buildRestorationPlan,
  canonicalUuid,
  renderRestorationSql,
  sha256,
} from "./restore_metadata_lib.mjs"

const SOURCE_SHA = "a".repeat(64)
const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111"
const OWNER_ID = "22222222-2222-4222-8222-222222222222"
const WINE_ID = "33333333333343338333333333333333"

async function createArchive({
  details = [],
  sourceSha = SOURCE_SHA,
  wines = [],
} = {}) {
  const archiveDir = await mkdtemp(path.join(os.tmpdir(), "v01-restore-test-"))
  const exportsDir = path.join(archiveDir, "source-export")
  await mkdir(exportsDir)

  const tables = { wine_identity_details: details, wines }
  const manifest = {}
  for (const [table, rows] of Object.entries(tables)) {
    const contents = rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length > 0 ? "\n" : "")
    const file = `${table}.jsonl`
    await writeFile(path.join(exportsDir, file), contents)
    manifest[table] = {
      export_file: file,
      export_sha256: sha256(contents),
      rows: rows.length,
    }
  }

  await writeFile(
    path.join(archiveDir, "source-manifest.json"),
    JSON.stringify(manifest),
  )
  await writeFile(
    path.join(archiveDir, "import-plan.json"),
    JSON.stringify({ ready_to_apply: true, source: { sha256: sourceSha } }),
  )
  return archiveDir
}

function sourceWine(overrides = {}) {
  return {
    advice_experience: "Still youthful",
    advice_pairing: "Roast chicken",
    created_at: "2026-07-01T12:00:00Z",
    drink_after: "2028-01-01",
    drink_after_confidence: 1,
    drink_after_source: "manual",
    drink_before: "2038-12-31",
    drink_before_confidence: 0.8,
    drink_before_source: "producer",
    id: WINE_ID,
    notes: "Decant carefully",
    updated_at: "2026-07-17T13:07:28Z",
    ...overrides,
  }
}

test("builds exact-ID fact fills and a non-overriding archived observation", async () => {
  const archiveDir = await createArchive({
    details: [
      {
        alcohol_percentage: 13.5,
        certifications_json: '["Organic"]',
        classification: "Premier Cru",
        country: "France",
        grapes_json: '["Pinot Noir"]',
        region: "Burgundy",
        sweetness: "sec",
        vineyard: "Les Tests",
        wine_id: WINE_ID,
      },
    ],
    wines: [sourceWine()],
  })

  const plan = await buildRestorationPlan({
    archiveDir,
    expectedSourceSha256: SOURCE_SHA,
  })

  assert.deepEqual(plan.report.blockers, [])
  assert.equal(plan.report.proposed_wines, 1)
  assert.equal(plan.report.observations, 1)
  assert.equal(plan.report.facts.sweetness_category, 1)
  assert.equal(plan.rows[0].wine_id, canonicalUuid(WINE_ID))
  assert.equal(plan.rows[0].sweetness_category, "dry")
  assert.deepEqual(plan.rows[0].grape_composition, [
    { name: "Pinot Noir", percentage: null },
  ])
  assert.match(plan.rows[0].observation_note, /does not replace current recommendations/u)
  assert.match(plan.rows[0].observation_note, /01\/01\/2028 to 31\/12\/2038/u)
  assert.match(plan.rows[0].observation_note, /Still youthful/u)
})

test("renders a rollback-only preview and a fingerprint-guarded apply", async () => {
  const archiveDir = await createArchive({ wines: [sourceWine()] })
  const plan = await buildRestorationPlan({
    archiveDir,
    expectedSourceSha256: SOURCE_SHA,
  })

  const previewSql = renderRestorationSql({
    apply: false,
    expectedPreviewFingerprint: null,
    householdId: HOUSEHOLD_ID,
    plan,
    recordedBy: OWNER_ID,
  })
  assert.match(previewSql, /metadata restoration \(preview\)/u)
  assert.match(previewSql, /rollback;\s*$/u)
  assert.doesNotMatch(previewSql, /update public\.wines target/u)

  const applySql = renderRestorationSql({
    apply: true,
    commit: true,
    expectedPreviewFingerprint: "b".repeat(32),
    householdId: HOUSEHOLD_ID,
    plan,
    recordedBy: OWNER_ID,
  })
  assert.match(applySql, /update public\.wines target/u)
  assert.match(applySql, /on conflict \(id\) do nothing/u)
  assert.match(applySql, /Restoration preview changed/u)
  assert.match(applySql, /Inventory changed during metadata restoration/u)
  assert.match(applySql, /commit;\s*$/u)

  const rehearsalSql = renderRestorationSql({
    apply: true,
    commit: false,
    expectedPreviewFingerprint: "b".repeat(32),
    householdId: HOUSEHOLD_ID,
    plan,
    recordedBy: OWNER_ID,
  })
  assert.match(rehearsalSql, /metadata restoration \(rehearsal\)/u)
  assert.match(rehearsalSql, /update public\.wines target/u)
  assert.match(rehearsalSql, /rollback;\s*$/u)
})

test("rejects an archive whose authoritative source hash changed", async () => {
  const archiveDir = await createArchive({
    sourceSha: "b".repeat(64),
    wines: [sourceWine()],
  })

  await assert.rejects(
    buildRestorationPlan({
      archiveDir,
      expectedSourceSha256: SOURCE_SHA,
    }),
    /Archive source hash mismatch/u,
  )
})

test("reports unsupported archived values as blockers", async () => {
  const archiveDir = await createArchive({
    details: [{ sweetness: "mystery", wine_id: WINE_ID }],
    wines: [sourceWine({
      advice_experience: null,
      advice_pairing: null,
      drink_after: null,
      drink_before: null,
      notes: null,
    })],
  })

  const plan = await buildRestorationPlan({
    archiveDir,
    expectedSourceSha256: SOURCE_SHA,
  })
  assert.deepEqual(plan.report.blockers, [
    {
      field: "sweetness_category",
      reason: "unsupported-value",
      value: "mystery",
      wineId: canonicalUuid(WINE_ID),
    },
  ])
  assert.throws(
    () =>
      renderRestorationSql({
        apply: false,
        expectedPreviewFingerprint: null,
        householdId: HOUSEHOLD_ID,
        plan,
        recordedBy: OWNER_ID,
      }),
    /plan has blockers/u,
  )
})
