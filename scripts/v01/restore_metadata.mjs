#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import {
  buildRestorationPlan,
  renderRestorationSql,
} from "./restore_metadata_lib.mjs"

function usage() {
  return `Usage:
  node scripts/v01/restore_metadata.mjs \\
    --archive-dir PATH \\
    --expected-source-sha256 SHA256 \\
    --household-id UUID \\
    --recorded-by UUID \\
    --out-dir PATH

The default mode creates a read-only SQL preview. To execute every guarded
write and roll it back, add:
    --rehearse --expected-preview-fingerprint FINGERPRINT

To create guarded commit SQL, add:
    --apply --expected-preview-fingerprint FINGERPRINT

The source archive and generated plan/SQL contain private cellar data. Keep the
output outside version control.`
}

function parseArgs(argv) {
  const result = { apply: false, rehearse: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--apply") {
      result.apply = true
      continue
    }
    if (argument === "--rehearse") {
      result.rehearse = true
      continue
    }
    if (argument === "--help" || argument === "-h") {
      result.help = true
      continue
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`)
    }
    index += 1
    const name = argument.slice(2).replaceAll("-", "_")
    result[name] = value
  }

  return result
}

function requireArgument(args, name) {
  const value = args[name]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${name.replaceAll("_", "-")} is required`)
  }
  return value
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const archiveDir = path.resolve(requireArgument(args, "archive_dir"))
  const expectedSourceSha256 = requireArgument(
    args,
    "expected_source_sha256",
  )
  if (!/^[0-9a-f]{64}$/u.test(expectedSourceSha256)) {
    throw new Error("--expected-source-sha256 must be lowercase SHA-256")
  }

  const householdId = requireArgument(args, "household_id")
  const recordedBy = requireArgument(args, "recorded_by")
  const outDir = path.resolve(requireArgument(args, "out_dir"))
  if (args.apply && args.rehearse) {
    throw new Error("Choose either --apply or --rehearse, not both")
  }
  const mutatesBeforeFinish = args.apply || args.rehearse
  const expectedPreviewFingerprint = mutatesBeforeFinish
    ? requireArgument(args, "expected_preview_fingerprint")
    : null
  const mode = args.apply ? "apply" : args.rehearse ? "rehearsal" : "preview"

  const plan = await buildRestorationPlan({
    archiveDir,
    expectedSourceSha256,
  })

  await mkdir(outDir, { recursive: true, mode: 0o700 })
  const planPath = path.join(outDir, "metadata-restoration-plan.json")
  const sqlPath = path.join(
    outDir,
    `metadata-restoration-${mode}.sql`,
  )
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })

  if (plan.report.blockers.length > 0) {
    console.error(JSON.stringify(plan.report, null, 2))
    throw new Error(
      `Restoration plan has ${plan.report.blockers.length} blocker(s); SQL was not generated`,
    )
  }

  const sql = renderRestorationSql({
    apply: mutatesBeforeFinish,
    commit: args.apply,
    expectedPreviewFingerprint,
    householdId,
    plan,
    recordedBy,
  })
  await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 })

  console.log(
    JSON.stringify(
      {
        mode,
        plan: planPath,
        plan_sha256: plan.plan_sha256,
        report: plan.report,
        sql: sqlPath,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
