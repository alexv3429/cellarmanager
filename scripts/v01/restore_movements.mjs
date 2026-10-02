#!/usr/bin/env node

import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { canonicalUuid } from "./restore_metadata_lib.mjs"
import { buildLegacyMovementsPlan } from "./restore_movements_lib.mjs"
import { renderLegacyMovementsSql } from "./restore_movements_sql.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function usage() {
  return `Usage:
  npm run v01:movements -- \\
    --archive-dir PRIVATE_ARCHIVE \\
    --expected-source-sha256 SHA256 \\
    --household-id UUID \\
    --imported-by OWNER_UUID \\
    --out-dir PRIVATE_OUTPUT

Default mode generates rollback-only preview SQL. After reviewing its result,
use --rehearse or --apply with --expected-preview-fingerprint FINGERPRINT.
The generated plan and SQL contain private cellar data. No database command
is executed by this tool; keep all outputs outside the repository.`
}

function parseArgs(argv) {
  const args = { apply: false, rehearse: false }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (["--apply", "--rehearse", "--help"].includes(key)) {
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

function inside(directory, parent) {
  const relative = path.relative(parent, directory)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(usage())
  if (args.apply && args.rehearse) throw new Error("Choose either --apply or --rehearse")
  const mode = args.apply ? "apply" : args.rehearse ? "rehearsal" : "preview"
  const archiveDir = path.resolve(required(args, "archive_dir"))
  const sourceSha256 = required(args, "expected_source_sha256")
  const householdId = canonicalUuid(required(args, "household_id"))
  const importedBy = canonicalUuid(required(args, "imported_by"))
  const outDir = path.resolve(required(args, "out_dir"))
  if (inside(outDir, repoRoot)) throw new Error("Private output must be outside the repository")
  const fingerprint = mode === "preview" ? null : required(args, "expected_preview_fingerprint")

  const plan = await buildLegacyMovementsPlan({
    archiveDir,
    expectedSourceSha256: sourceSha256,
    householdId,
  })
  if (plan.report.blockers.length) {
    throw new Error(`Plan has ${plan.report.blockers.length} blocker(s); no SQL was generated`)
  }
  const sql = renderLegacyMovementsSql({
    mode,
    plan,
    importedBy,
    expectedPreviewFingerprint: fingerprint,
  })
  await mkdir(outDir, { recursive: true, mode: 0o700 })
  if (inside(await realpath(outDir), await realpath(repoRoot))) {
    throw new Error("Private output resolves inside the repository")
  }
  const planPath = path.join(outDir, "legacy-movements-plan.json")
  const sqlPath = path.join(outDir, `legacy-movements-${mode}.sql`)
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 })
  console.log(JSON.stringify({ mode, plan: planPath, sql: sqlPath,
    plan_sha256: plan.plan_sha256, report: plan.report }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
