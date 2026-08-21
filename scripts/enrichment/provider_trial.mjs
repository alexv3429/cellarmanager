#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PROVIDER_POLICIES,
  productionEligibility,
} from "./provider_policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultOutputDirectory = resolve(root, ".provider-trials");
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function usage() {
  return `Usage: npm run enrichment:trial -- [options]

Options:
  --sample <path>           Private JSON sample (required)
  --provider <id>          grapeminds or wineapi (repeatable)
  --output <path>           Local report path (default: .provider-trials/...)
  --retry-from <path>       Retry pending rows from an earlier private report
  --max-wines <1-50>       Maximum sample rows (default: 20)
  --timeout-ms <1000-30000> Per-request timeout (default: 15000)
  --help                    Show this help

Credentials are read only from GRAPEMINDS_API_KEY and WINEAPI_API_KEY.
Inputs, responses, and reports must never be committed. Repository-local reports
are accepted only under the gitignored .provider-trials directory.
`;
}

function defaultOutputPath(now = new Date()) {
  const timestamp = now.toISOString().replaceAll(":", "-");
  return resolve(defaultOutputDirectory, `provider-trial-${timestamp}.json`);
}

export function parseOptions(argv, now = new Date()) {
  const options = {
    sample: null,
    providers: [],
    output: defaultOutputPath(now),
    retryFrom: null,
    maxWines: 20,
    timeoutMs: 15_000,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (
      ![
        "--sample",
        "--provider",
        "--output",
        "--retry-from",
        "--max-wines",
        "--timeout-ms",
      ].includes(argument)
    ) {
      throw new Error(`Unknown option: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    index += 1;

    if (argument === "--sample") options.sample = resolve(value);
    if (argument === "--provider") options.providers.push(value);
    if (argument === "--output") options.output = resolve(value);
    if (argument === "--retry-from") options.retryFrom = resolve(value);
    if (argument === "--max-wines") options.maxWines = Number(value);
    if (argument === "--timeout-ms") options.timeoutMs = Number(value);
  }

  if (!options.help && !options.sample) {
    throw new Error("--sample is required");
  }
  if (options.providers.length === 0) {
    options.providers = ["grapeminds", "wineapi"];
  }
  options.providers = [...new Set(options.providers)];
  for (const provider of options.providers) {
    if (!PROVIDER_POLICIES[provider]?.trialAdapter) {
      throw new Error(`Unsupported trial provider: ${provider}`);
    }
  }
  if (
    !Number.isInteger(options.maxWines) ||
    options.maxWines < 1 ||
    options.maxWines > 50
  ) {
    throw new Error("--max-wines must be an integer from 1 to 50");
  }
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 30_000
  ) {
    throw new Error("--timeout-ms must be an integer from 1000 to 30000");
  }

  assertSafeOutputPath(options.output);
  return options;
}

export function assertSafeOutputPath(outputPath) {
  const absolute = resolve(outputPath);
  const insideRepository =
    absolute === root || absolute.startsWith(`${root}${sep}`);
  const insideIgnoredTrialDirectory =
    absolute === defaultOutputDirectory ||
    absolute.startsWith(`${defaultOutputDirectory}${sep}`);

  if (insideRepository && !insideIgnoredTrialDirectory) {
    throw new Error(
      "Repository-local trial reports must be written under .provider-trials",
    );
  }
}

function requiredText(value, field, sampleIndex) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`wines[${sampleIndex}].${field} must be non-empty text`);
  }
  return value.trim();
}

function optionalText(value, field, sampleIndex) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`wines[${sampleIndex}].${field} must be text or null`);
  }
  return value.trim() || null;
}

export function validateSample(input) {
  if (input?.version !== 1 || !Array.isArray(input.wines)) {
    throw new Error("Sample must use version 1 and contain a wines array");
  }
  if (input.wines.length === 0 || input.wines.length > 50) {
    throw new Error("Sample must contain from 1 to 50 wines");
  }

  const sampleIds = new Set();
  const wines = input.wines.map((wine, index) => {
    const sampleId = requiredText(wine?.sampleId, "sampleId", index);
    if (sampleIds.has(sampleId)) {
      throw new Error(`Duplicate sampleId: ${sampleId}`);
    }
    sampleIds.add(sampleId);

    const vintageText =
      typeof wine.vintage === "string" ? wine.vintage.trim() : null;
    const vintage = /^\d{4}$/.test(vintageText ?? "")
      ? Number(vintageText)
      : /^(?:N\.?V\.?|N\.?M\.?)$/i.test(vintageText ?? "")
        ? null
        : wine.vintage;
    if (
      vintage !== null &&
      vintage !== undefined &&
      (!Number.isInteger(vintage) || vintage < 1800 || vintage > 2200)
    ) {
      throw new Error(`wines[${index}].vintage must be a year or null`);
    }
    if (
      wine.lwin7 !== null &&
      wine.lwin7 !== undefined &&
      !/^\d{7}$/.test(String(wine.lwin7))
    ) {
      throw new Error(`wines[${index}].lwin7 must contain seven digits or null`);
    }

    return {
      sampleId,
      producer: requiredText(wine.producer, "producer", index),
      cuvee: requiredText(wine.cuvee, "cuvee", index),
      vintage: vintage ?? null,
      appellation: optionalText(wine.appellation, "appellation", index),
      color: optionalText(wine.color, "color", index),
      lwin7: wine.lwin7 == null ? null : String(wine.lwin7),
    };
  });

  return { version: 1, wines };
}

function wineQuery(wine) {
  return [wine.producer, wine.cuvee, wine.vintage, wine.appellation]
    .filter((value) => value !== null)
    .join(" ");
}

function lwin7(value) {
  const digits = String(value ?? "").replaceAll(/\D/g, "");
  return digits.length >= 7 ? digits.slice(0, 7) : null;
}

function nullableString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function nullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function canonicalColour(value) {
  const text = nullableString(value)
    ?.normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!text) return null;
  if (/\b(red|rouge)\b/.test(text)) return "red";
  if (/\b(white|blanc)\b/.test(text)) return "white";
  if (/\b(rose|pink)\b/.test(text)) return "rose";
  return null;
}

function canonicalProviderVintage(value) {
  if (Number.isInteger(value) && value >= 1800 && value <= 2200) return value;
  if (typeof value === "string" && /^\d{4}$/.test(value.trim())) {
    const vintage = Number(value.trim());
    return vintage >= 1800 && vintage <= 2200 ? vintage : null;
  }
  return null;
}

export function assessIdentityEvidence(
  wine,
  { colour: providerColourValue, vintage: providerVintageValue },
) {
  const sourceColour = canonicalColour(wine.color);
  const providerColour = canonicalColour(providerColourValue);
  const sourceVintage = wine.vintage ?? null;
  const providerVintage = canonicalProviderVintage(providerVintageValue);
  const colourStatus =
    sourceColour === null || providerColour === null
      ? "unverified"
      : sourceColour === providerColour
        ? "exact"
        : "conflict";
  const vintageStatus =
    sourceVintage === null && providerVintage === null
      ? "nv-unresolved"
      : sourceVintage !== null && providerVintage === null
        ? "provider-omitted"
        : sourceVintage === providerVintage
          ? "exact"
          : "conflict";
  const hardBlockers = [];
  if (colourStatus === "conflict") hardBlockers.push("colour-conflict");
  if (vintageStatus === "conflict") hardBlockers.push("vintage-conflict");
  const exactReleaseEvidence =
    hardBlockers.length === 0 && vintageStatus === "exact";

  return {
    sourceColour,
    providerColour,
    colourStatus,
    sourceVintage,
    providerVintage,
    vintageStatus,
    eligibleScope:
      hardBlockers.length > 0
        ? "rejected"
        : exactReleaseEvidence
          ? "release-candidate"
          : "product-only",
    exactReleaseEvidence,
    hardBlockers,
  };
}

function hasNamedField(value, names, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Object.keys(value).some((key) => names.has(key.toLowerCase()))) return true;
  return Object.values(value).some((item) => hasNamedField(item, names, seen));
}

function provenanceSignals(...responses) {
  return {
    sourcePresent: responses.some((response) =>
      hasNamedField(response, new Set(["source", "sources", "provider"])),
    ),
    attributionPresent: responses.some((response) =>
      hasNamedField(response, new Set(["attribution", "credit", "credits"])),
    ),
    methodologyPresent: responses.some((response) =>
      hasNamedField(response, new Set(["method", "methodology", "model"])),
    ),
  };
}

async function requestJson(
  url,
  { headers, timeoutMs, fetchImpl = fetch, acceptedStatuses = [] },
) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "CellarManager-provider-trial/0.4.5",
      ...headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(`Provider request failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error("Provider response exceeds the 2 MB trial limit");
  }
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Provider returned invalid JSON");
    }
  }
  return { data, headers: response.headers, status: response.status };
}

function chooseGrapemindsCandidate(wine, candidates) {
  const exact = wine.lwin7
    ? candidates.find((candidate) => lwin7(candidate.lwin) === wine.lwin7)
    : null;
  return {
    candidate: exact ?? candidates[0] ?? null,
    selectionMethod: exact ? "exact-lwin7" : "provider-first-result",
  };
}

export async function trialGrapemindsWine(
  wine,
  { apiKey, timeoutMs, fetchImpl = fetch },
) {
  const query = wineQuery(wine);
  const searchUrl = new URL("https://api.grapeminds.eu/public/v1/wines/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", "5");
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "accept-language": "en",
  };
  const search = await requestJson(searchUrl, {
    headers,
    timeoutMs,
    fetchImpl,
  });
  const candidates = Array.isArray(search.data?.data) ? search.data.data : [];
  const { candidate, selectionMethod } = chooseGrapemindsCandidate(
    wine,
    candidates,
  );
  if (!candidate) {
    return {
      sampleId: wine.sampleId,
      query,
      status: "not-found",
      candidate: null,
      drinkingWindow: { supported: true, present: false },
      pairing: { supported: true, present: false },
      provenance: provenanceSignals(search.data),
    };
  }

  const detail = await requestJson(
    `https://api.grapeminds.eu/public/v1/wines/${encodeURIComponent(candidate.id)}`,
    { headers, timeoutMs, fetchImpl },
  );
  const periodUrl = new URL(
    `https://api.grapeminds.eu/public/v1/drinking-periods/${encodeURIComponent(candidate.id)}`,
  );
  periodUrl.searchParams.set("lang", "en");
  const period = await requestJson(periodUrl, {
    headers,
    timeoutMs,
    fetchImpl,
    acceptedStatuses: [404],
  });

  const details = detail.data?.data ?? detail.data ?? {};
  const window = period.data?.data ?? period.data ?? {};
  const pairing = details.pairing ?? null;
  const candidateLwin7 = lwin7(candidate.lwin ?? details.lwin);
  const candidateColour = nullableString(candidate.color ?? details.color);
  const identityEvidence = assessIdentityEvidence(wine, {
    colour: candidateColour,
    vintage: null,
  });
  const windowFrom = nullableNumber(window.from);
  const windowTo = nullableNumber(window.to);
  const windowStatement = nullableString(window.statement);
  const pairingText = nullableString(pairing?.text);
  const pairingTextLong = nullableString(pairing?.text_long);

  return {
    sampleId: wine.sampleId,
    query,
    status: "candidate",
    candidate: {
      providerId: String(candidate.id),
      name: nullableString(candidate.display_name),
      producer: nullableString(
        candidate.producer_display_name ?? candidate.producer_name,
      ),
      colour: candidateColour,
      vintage: null,
      lwin7: candidateLwin7,
      expectedLwin7: wine.lwin7,
      exactLwin7:
        wine.lwin7 === null || candidateLwin7 === null
          ? null
          : candidateLwin7 === wine.lwin7,
      selectionMethod,
      alternativesReturned: candidates.length,
    },
    identityEvidence,
    drinkingWindow: {
      supported: true,
      present:
        period.status === 200 &&
        [windowFrom, windowTo, windowStatement].some((value) => value !== null),
      from: windowFrom,
      to: windowTo,
      statement: windowStatement,
      young: nullableString(window.young),
      ripe: nullableString(window.ripe),
      storage: nullableString(window.storage),
      generating: period.status === 404 && window.generating === true,
    },
    pairing: {
      supported: true,
      present: pairingText !== null || pairingTextLong !== null,
      structured: false,
      text: pairingText,
      textLong: pairingTextLong,
      language: nullableString(pairing?.language),
    },
    updateStatus:
      period.status === 404 && window.generating === true ? "pending" : null,
    provenance: provenanceSignals(search.data, detail.data, period.data),
  };
}

async function wineApiCandidateResult(
  wine,
  candidate,
  {
    apiKey,
    timeoutMs,
    fetchImpl,
    searchData,
    selectionMethod,
    alternativesReturned,
  },
) {
  const query = wineQuery(wine);
  const headers = { "x-api-key": apiKey };
  const detail = await requestJson(
    `https://api.wineapi.io/wines/${encodeURIComponent(candidate.id)}`,
    { headers, timeoutMs, fetchImpl },
  );
  const pairings = await requestJson(
    `https://api.wineapi.io/wines/${encodeURIComponent(candidate.id)}/pairings`,
    { headers, timeoutMs, fetchImpl, acceptedStatuses: [404] },
  );
  const items = Array.isArray(pairings.data?.pairings)
    ? pairings.data.pairings
    : Array.isArray(detail.data?.pairings)
      ? detail.data.pairings
      : [];
  const candidateLwin7 = lwin7(detail.data?.lwinCode);
  const candidateColour = nullableString(detail.data?.type ?? candidate.type);
  const candidateVintage = canonicalProviderVintage(
    detail.data?.vintage ?? candidate.vintage,
  );
  const identityEvidence = assessIdentityEvidence(wine, {
    colour: candidateColour,
    vintage: candidateVintage,
  });

  return {
    sampleId: wine.sampleId,
    query,
    status: "candidate",
    candidate: {
      providerId: String(candidate.id),
      name: nullableString(detail.data?.name ?? candidate.name),
      producer: nullableString(detail.data?.winery?.name ?? candidate.winery),
      colour: candidateColour,
      vintage: candidateVintage,
      lwin7: candidateLwin7,
      expectedLwin7: wine.lwin7,
      exactLwin7:
        wine.lwin7 === null || candidateLwin7 === null
          ? null
          : candidateLwin7 === wine.lwin7,
      selectionMethod,
      alternativesReturned,
      confidence: nullableNumber(candidate.confidence),
    },
    identityEvidence,
    drinkingWindow: { supported: false, present: false },
    pairing: {
      supported: true,
      present: items.length > 0,
      structured: true,
      items: items.map((item) => ({
        food: nullableString(item.food),
        confidence:
          nullableNumber(item.confidence) ?? nullableString(item.confidence),
        notes: nullableString(item.notes),
      })),
    },
    updateStatus: nullableString(detail.headers.get("x-update-status")),
    retryAfter: nullableString(detail.headers.get("retry-after")),
    provenance: provenanceSignals(searchData, detail.data, pairings.data),
  };
}

export async function trialWineApiWine(
  wine,
  { apiKey, timeoutMs, fetchImpl = fetch },
) {
  const query = wineQuery(wine);
  const searchUrl = new URL("https://api.wineapi.io/wines/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", "5");
  const headers = { "x-api-key": apiKey };
  const search = await requestJson(searchUrl, {
    headers,
    timeoutMs,
    fetchImpl,
  });
  const candidates = Array.isArray(search.data?.results)
    ? search.data.results
    : [];
  const candidate = candidates[0] ?? null;
  if (!candidate) {
    return {
      sampleId: wine.sampleId,
      query,
      status: "not-found",
      candidate: null,
      drinkingWindow: { supported: false, present: false },
      pairing: { supported: true, present: false },
      provenance: provenanceSignals(search.data),
    };
  }

  return wineApiCandidateResult(wine, candidate, {
    apiKey,
    timeoutMs,
    fetchImpl,
    searchData: search.data,
    selectionMethod: "provider-first-result",
    alternativesReturned: candidates.length,
  });
}

export async function retryWineApiWine(
  wine,
  previousResult,
  { apiKey, timeoutMs, fetchImpl = fetch },
) {
  const previousCandidate = previousResult?.candidate;
  if (!previousCandidate?.providerId) {
    throw new Error(`Cannot retry ${wine.sampleId} without a provider candidate`);
  }

  return wineApiCandidateResult(
    wine,
    {
      id: previousCandidate.providerId,
      name: previousCandidate.name,
      winery: previousCandidate.producer,
      type: previousCandidate.colour,
      vintage: previousCandidate.vintage,
      confidence: previousCandidate.confidence,
    },
    {
      apiKey,
      timeoutMs,
      fetchImpl,
      searchData: null,
      selectionMethod: "provider-id-retry",
      alternativesReturned: previousCandidate.alternativesReturned,
    },
  );
}

function aggregateResults(results) {
  return results.reduce(
    (summary, result) => {
      summary.total += 1;
      if (result.status === "candidate") summary.candidates += 1;
      if (result.status === "not-found") summary.notFound += 1;
      if (result.status === "error") summary.errors += 1;
      if (result.candidate?.exactLwin7 === true) summary.exactLwin7 += 1;
      if (result.candidate?.exactLwin7 === false) summary.conflictingLwin7 += 1;
      if (result.identityEvidence?.colourStatus === "conflict") {
        summary.colourConflicts += 1;
      }
      if (result.identityEvidence?.vintageStatus === "conflict") {
        summary.vintageConflicts += 1;
      }
      if (result.identityEvidence?.eligibleScope === "product-only") {
        summary.productOnly += 1;
      }
      if (result.identityEvidence?.eligibleScope === "release-candidate") {
        summary.releaseCandidates += 1;
      }
      if (result.drinkingWindow?.present) summary.drinkingWindows += 1;
      if (result.pairing?.present) summary.pairings += 1;
      if (result.updateStatus === "pending") summary.pendingUpdates += 1;
      return summary;
    },
    {
      total: 0,
      candidates: 0,
      notFound: 0,
      errors: 0,
      exactLwin7: 0,
      conflictingLwin7: 0,
      colourConflicts: 0,
      vintageConflicts: 0,
      productOnly: 0,
      releaseCandidates: 0,
      drinkingWindows: 0,
      pairings: 0,
      pendingUpdates: 0,
    },
  );
}

export async function runTrial(
  options,
  environment = process.env,
  fetchImpl = fetch,
) {
  const sampleInput = JSON.parse(await readFile(options.sample, "utf8"));
  const sample = validateSample(sampleInput);
  const wines = sample.wines.slice(0, options.maxWines);
  const retryReport = options.retryFrom
    ? JSON.parse(await readFile(options.retryFrom, "utf8"))
    : null;
  if (retryReport && options.providers.some((provider) => provider !== "wineapi")) {
    throw new Error("--retry-from currently supports only the wineapi provider");
  }
  const providers = [];

  for (const providerId of options.providers) {
    const policy = PROVIDER_POLICIES[providerId];
    const apiKey = environment[policy.environmentKey];
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new Error(`${policy.environmentKey} is required for ${providerId}`);
    }

    const previousProvider = retryReport?.providers?.find(
      (provider) => provider.id === providerId,
    );
    if (retryReport && !previousProvider) {
      throw new Error(`Retry report does not contain ${providerId}`);
    }
    const previousBySampleId = new Map(
      (previousProvider?.results ?? []).map((result) => [result.sampleId, result]),
    );
    const results = [];
    for (const wine of wines) {
      try {
        const previousResult = retryReport
          ? previousBySampleId.get(wine.sampleId)
          : null;
        if (retryReport && !previousResult) {
          throw new Error(`Retry report does not contain ${wine.sampleId}`);
        }
        if (previousResult && previousResult.updateStatus !== "pending") {
          results.push(previousResult);
          continue;
        }
        const trial =
          previousResult
            ? await retryWineApiWine(wine, previousResult, {
                apiKey,
                timeoutMs: options.timeoutMs,
                fetchImpl,
              })
            : providerId === "grapeminds"
            ? await trialGrapemindsWine(wine, {
                apiKey,
                timeoutMs: options.timeoutMs,
                fetchImpl,
              })
            : await trialWineApiWine(wine, {
                apiKey,
                timeoutMs: options.timeoutMs,
                fetchImpl,
              });
        results.push(trial);
      } catch (error) {
        results.push({
          sampleId: wine.sampleId,
          query: wineQuery(wine),
          status: "error",
          error: error instanceof Error ? error.message : "Unknown provider error",
        });
      }
    }

    providers.push({
      id: policy.id,
      name: policy.name,
      decision: policy.decision,
      rights: policy.rights,
      productionEligibility: productionEligibility(policy),
      summary: aggregateResults(results),
      results,
    });
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sampleFile: basename(options.sample),
    sampleRows: wines.length,
    retryFrom: options.retryFrom ? basename(options.retryFrom) : null,
    notice:
      "Private local trial output. Do not commit or redistribute provider content.",
    providers,
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(options.output, 0o600);
  return report;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await runTrial(options);
  console.log(`Private provider trial written to ${relative(root, options.output)}`);
  for (const provider of report.providers) {
    console.log(`${provider.id}: ${JSON.stringify(provider.summary)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
