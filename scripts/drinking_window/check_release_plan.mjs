#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

export const planPath = "docs/drinking-window-release-plan.md"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const focusedPath = /^(?:docs\/(?:drinking-window|maturity|personal-maturity)|scripts\/(?:drinking_window\/|enrichment\/maturity)|supabase\/(?:migrations|tests)\/[^\n]*(?:drinking_window|maturity)|apps\/web\/src\/[^\n]*(?:DrinkingWindow|WineMaturity|wineMaturity))/i
const sourcePath = /^(?:apps\/web\/src\/|workers\/|scripts\/|supabase\/)/
const changedFeatureLine = /(?:drinking[_ -]?window|maturity|first_trial_year|best_start_year|best_end_year)/i

export function requiresPlanUpdate(paths, sourcePatch = "") {
  const relevantPath = paths.some((path) => path !== planPath && focusedPath.test(path))
  const relevantLine = sourcePatch.split("\n").some((line) =>
    /^[+-](?![+-])/.test(line) && changedFeatureLine.test(line),
  )
  return relevantPath || relevantLine
}

export function checkPlanUpdate(paths, sourcePatch = "") {
  return !requiresPlanUpdate(paths, sourcePatch) || paths.includes(planPath)
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
}

function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--base" || !/^[a-f0-9]{40}$/.test(process.argv[3])) {
    console.error("Usage: node scripts/drinking_window/check_release_plan.mjs --base BASE_SHA")
    process.exitCode = 2
    return
  }

  const base = process.argv[3]
  const paths = git(["diff", "--name-only", "-z", base, "HEAD"]).split("\0").filter(Boolean)
  const changedSourcePaths = paths.filter((path) => sourcePath.test(path))
  const sourcePatch = changedSourcePaths.length
    ? git(["diff", "--no-ext-diff", "--unified=0", base, "HEAD", "--", ...changedSourcePaths])
    : ""

  if (!checkPlanUpdate(paths, sourcePatch)) {
    console.error(`Drinking-window work changed without updating ${planPath}.`)
    console.error("Record the affected gate, evidence, risks, and change-log entry in the same PR.")
    process.exitCode = 1
    return
  }

  console.log(requiresPlanUpdate(paths, sourcePatch)
    ? "Drinking-window release plan was updated with this change."
    : "No drinking-window release-plan update required for this change.")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
