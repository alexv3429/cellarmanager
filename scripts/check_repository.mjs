#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const requiredFiles = [
  ".node-version",
  ".github/workflows/ci.yml",
  ".github/dependabot.yml",
  "CONTRIBUTING.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "scripts/protect_main.sh",
  "supabase/config.toml",
  "wrangler.jsonc",
]

const retiredPaths = [
  ".patches/",
  "backend/",
  "docker/",
  "frontend/",
  "scripts/v01_",
]

const forbiddenNames = new Set([
  ".coverage",
  ".env",
  "coverage.xml",
])

const forbiddenSuffixes = [
  ".db",
  ".db-shm",
  ".db-wal",
  ".key",
  ".pem",
  ".sqlite",
  ".sqlite3",
]

function trackedFiles() {
  return execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
}

const errors = []

for (const path of requiredFiles) {
  try {
    if (!statSync(join(root, path)).isFile()) {
      errors.push(`missing required workflow file: ${path}`)
    }
  } catch {
    errors.push(`missing required workflow file: ${path}`)
  }
}

for (const path of trackedFiles()) {
  const name = path.split("/").at(-1)

  if (forbiddenNames.has(name)) {
    errors.push(`forbidden generated or secret file is tracked: ${path}`)
  }

  if (path.startsWith(".patch-backups/")) {
    errors.push(`patch backup is tracked: ${path}`)
  }

  if (retiredPaths.some((prefix) => path.startsWith(prefix))) {
    errors.push(`retired v0.1 path is tracked: ${path}`)
  }

  if (forbiddenSuffixes.some((suffix) => path.endsWith(suffix))) {
    errors.push(`database or possible private key is tracked: ${path}`)
  }
}

try {
  const lockText = readFileSync(join(root, "package-lock.json"), "utf8")
  const lock = JSON.parse(lockText)
  if (lock.lockfileVersion !== 3) {
    errors.push("package-lock.json must use lockfileVersion 3")
  }
} catch (error) {
  errors.push(`package-lock.json is invalid: ${error.message}`)
}

try {
  const workflowPath = join(root, ".github/workflows/ci.yml")
  const workflow = readFileSync(workflowPath, "utf8")
  for (const required of [
    "pull_request:",
    "merge_group:",
    "name: CI Gate",
    "npm run repository:check",
    "npm run lwin:test",
    "npm run web:ci",
    "npm run supabase -- test db",
  ]) {
    if (!workflow.includes(required)) {
      errors.push(`CI workflow is missing: ${required}`)
    }
  }
} catch (error) {
  errors.push(`unable to validate CI workflow: ${error.message}`)
}

if (errors.length > 0) {
  console.error("Repository policy checks failed:")
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `Repository policy checks passed (${trackedFiles().length} tracked files from ${relative(process.cwd(), root) || "."}).`,
  )
}
