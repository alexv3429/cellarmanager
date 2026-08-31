#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function read(path) {
  return readFileSync(join(root, path), "utf8")
}

function readJson(path) {
  return JSON.parse(read(path))
}

function matchVersion(text, pattern, label, errors) {
  const match = text.match(pattern)
  if (!match) {
    errors.push(`unable to read ${label}`)
    return null
  }
  return match[1]
}

function productionUrl(args) {
  const index = args.indexOf("--production")
  if (index === -1) return null
  if (!args[index + 1]) {
    throw new Error("--production requires the deployed application URL")
  }
  const url = new URL(args[index + 1])
  if (url.protocol !== "https:") {
    throw new Error("the production release check requires an HTTPS URL")
  }
  return url
}

async function checkProduction(baseUrl, expectedVersion, errors) {
  const statusUrl = new URL("/api/research/status", baseUrl)
  let response
  try {
    response = await fetch(statusUrl, { signal: AbortSignal.timeout(10_000) })
  } catch (error) {
    errors.push(`production status request failed: ${error.message}`)
    return
  }

  if (!response.ok) {
    errors.push(`production status returned HTTP ${response.status}`)
    return
  }

  let status
  try {
    status = await response.json()
  } catch (error) {
    errors.push(`production status is not valid JSON: ${error.message}`)
    return
  }

  if (status.version !== expectedVersion) {
    errors.push(
      `production serves ${status.version ?? "no version"}; expected ${expectedVersion}`,
    )
  }
  if (status.status !== "ready") {
    errors.push(`production research status is ${status.status ?? "missing"}`)
  }
  if (status.configuration?.ai !== true) {
    errors.push("production Workers AI binding is not ready")
  }
  if (status.configuration?.supabase !== true) {
    errors.push("production Supabase service connection is not ready")
  }
  if (
    status.configuration?.tavilySearch !== true &&
    status.configuration?.braveSearch !== true
  ) {
    errors.push("production has no configured web discovery provider")
  }
}

const errors = []
let deployedUrl = null
try {
  deployedUrl = productionUrl(process.argv.slice(2))
} catch (error) {
  errors.push(error.message)
}

const webPackage = readJson("apps/web/package.json")
const lock = readJson("package-lock.json")
const version = webPackage.version

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  errors.push(`web package version is not a release version: ${version ?? "missing"}`)
}

const versions = new Map([
  ["package-lock workspace", lock.packages?.["apps/web"]?.version ?? null],
  [
    "application metadata",
    matchVersion(
      read("apps/web/src/appMetadata.ts"),
      /APP_VERSION\s*=\s*"([^"]+)"/,
      "application version",
      errors,
    ),
  ],
  [
    "worker status",
    matchVersion(
      read("workers/index.mjs"),
      /WORKER_VERSION\s*=\s*"([^"]+)"/,
      "worker version",
      errors,
    ),
  ],
  [
    "README current release",
    matchVersion(
      read("README.md"),
      /\*\*Current release: v([^*]+)\*\*/,
      "README current release",
      errors,
    ),
  ],
])

for (const [label, candidate] of versions) {
  if (candidate !== null && candidate !== version) {
    errors.push(`${label} is ${candidate}; expected ${version}`)
  }
}

const releasePath = `docs/releases/v${version}.md`
try {
  read(releasePath)
} catch {
  errors.push(`missing release notes: ${releasePath}`)
}

for (const [path, required] of [
  ["docs/README.md", `releases/v${version}.md`],
  ["docs/product-roadmap.md", `Released (\`v${version}\`)`],
  ["README.md", `docs/releases/v${version}.md`],
]) {
  if (!read(path).includes(required)) {
    errors.push(`${path} is missing: ${required}`)
  }
}

if (deployedUrl !== null && errors.length === 0) {
  await checkProduction(deployedUrl, version, errors)
}

if (errors.length > 0) {
  console.error("Release checks failed:")
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Release metadata checks passed for v${version}.`)
  if (deployedUrl !== null) {
    console.log(`Production readiness checks passed for ${deployedUrl.origin}.`)
  }
}
