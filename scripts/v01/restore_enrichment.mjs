#!/usr/bin/env node

import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { buildLegacyEnrichmentPlan } from "./restore_enrichment_lib.mjs"
import { renderRestorationSql } from "./restore_metadata_lib.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function usage() {
  return `Usage:
  npm run v01:enrichment -- \\
    --archive-dir PATH \\
    --expected-source-sha256 SHA256 \\
    --household-id UUID \\
    --recorded-by OWNER_UUID \\
    --out-dir PRIVATE_PATH

Default mode generates rollback-only preview SQL. Add --rehearse or --apply
with --expected-preview-fingerprint FINGERPRINT only after reviewing the preview.
Generated files contain private cellar information; keep them outside the repo.`
}

function parseArgs(argv) {
  const args = { apply: false, rehearse: false }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === "--apply" || key === "--rehearse" || key === "--help") {
      args[key.slice(2)] = true
      continue
    }
    if (!key.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error(`Invalid argument: ${key}`)
    }
    args[key.slice(2).replaceAll("-", "_")] = argv[++index]
  }
  return args
}

function required(args, key) {
  const value = args[key]
  if (!value || typeof value !== "string") throw new Error(`--${key.replaceAll("_", "-")} is required`)
  return value
}

function isInside(directory, parent) {
  const relative = path.relative(parent, directory)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  if (args.apply && args.rehearse) throw new Error("Choose either --apply or --rehearse")
  const archiveDir = path.resolve(required(args, "archive_dir"))
  const expectedSourceSha256 = required(args, "expected_source_sha256")
  if (!/^[0-9a-f]{64}$/u.test(expectedSourceSha256)) throw new Error("Expected source hash must be lowercase SHA-256")
  const householdId = required(args, "household_id")
  const recordedBy = required(args, "recorded_by")
  const outDir = path.resolve(required(args, "out_dir"))
  if (isInside(outDir, repoRoot)) throw new Error("Private output must be outside the repository")
  const writing = args.apply || args.rehearse
  const fingerprint = writing ? required(args, "expected_preview_fingerprint") : null
  const mode = args.apply ? "apply" : args.rehearse ? "rehearsal" : "preview"

  const plan = await buildLegacyEnrichmentPlan({ archiveDir, expectedSourceSha256 })
  await mkdir(outDir, { recursive: true, mode: 0o700 })
  if (isInside(await realpath(outDir), await realpath(repoRoot))) {
    throw new Error("Private output resolves inside the repository")
  }
  const planPath = path.join(outDir, "legacy-enrichment-plan.json")
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  if (plan.report.blockers.length) throw new Error(`Plan has ${plan.report.blockers.length} blocker(s); SQL was not generated`)

  const sql = renderRestorationSql({
    apply: writing,
    commit: args.apply,
    expectedPreviewFingerprint: fingerprint,
    householdId,
    plan,
    recordedBy,
    requireUnmerged: true,
  })
  const sqlPath = path.join(outDir, `legacy-enrichment-${mode}.sql`)
  await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 })
  console.log(JSON.stringify({ mode, plan: planPath, plan_sha256: plan.plan_sha256, report: plan.report, sql: sqlPath }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
