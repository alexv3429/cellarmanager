#!/usr/bin/env node

import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { canonicalUuid } from "./restore_metadata_lib.mjs"
import { buildLegacyPricesPlan, renderLegacyPricesSql } from "./restore_prices_lib.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function usage() {
  return `Usage:
  npm run v01:prices -- \\
    --source-db PRIVATE_WINECELLAR_DB \\
    --expected-source-sha256 SHA256 \\
    --household-id UUID \\
    --imported-by OWNER_UUID \\
    --out-dir PRIVATE_OUTPUT

Default mode writes a rollback-only SQL preview, not a database change.
Use --rehearse or --apply only after reviewing the SQL preview, with
--expected-preview-fingerprint FINGERPRINT. Generated files contain private
cellar data and must remain outside the repository.`
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
  const sourceDb = path.resolve(required(args, "source_db"))
  const expectedSourceSha256 = required(args, "expected_source_sha256")
  const householdId = canonicalUuid(required(args, "household_id"))
  const importedBy = canonicalUuid(required(args, "imported_by"))
  const outDir = path.resolve(required(args, "out_dir"))
  if (inside(outDir, repoRoot)) throw new Error("Private output must be outside the repository")
  const expectedPreviewFingerprint = mode === "preview" ? null : required(args, "expected_preview_fingerprint")

  const plan = await buildLegacyPricesPlan({ sourceDb, expectedSourceSha256, householdId })
  if (plan.report.blockers.length) throw new Error(`Plan has ${plan.report.blockers.length} blocker(s); no SQL generated`)
  const sql = renderLegacyPricesSql({ plan, importedBy, mode, expectedPreviewFingerprint })
  await mkdir(outDir, { recursive: true, mode: 0o700 })
  if (inside(await realpath(outDir), await realpath(repoRoot))) {
    throw new Error("Private output resolves inside the repository")
  }
  const planPath = path.join(outDir, "legacy-prices-plan.json")
  const sqlPath = path.join(outDir, `legacy-prices-${mode}.sql`)
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
