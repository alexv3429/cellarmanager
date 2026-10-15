#!/usr/bin/env node

import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseServiceHeaders } from '../../workers/supabaseServiceHeaders.mjs';

const REFERENCE_SHEETS = 'Barraud|Barthod|Boillot|Bouzereau|Cal Demoura|Carillon|Castagnier|Chagnoleau|Clavelier|Langoureau|Montcalmes|Pernot|Millesimes';
const LOCATOR = new RegExp(`^(${REFERENCE_SHEETS})![A-O][0-9]+:[A-O][0-9]+$`);
const CELL = new RegExp(`^(${REFERENCE_SHEETS})![A-O][0-9]+(:[A-O][0-9]+)?$`);
const ROW_KEYS = new Set([
  'source_sha256', 'source_locator', 'candidate_scope', 'source_identity',
  'wine_color', 'vintage_year', 'first_trial_year', 'best_start_year',
  'best_end_year', 'review_status', 'review_reason',
]);
const IDENTITY_KEYS = new Set([
  'producer', 'cuvee', 'appellation', 'region', 'color', 'historical_bin',
  'source_cells', 'unpaired_start_year', 'unpaired_end_year',
]);
const CELL_KEYS = new Set([
  'vintage', 'cuvee', 'appellation', 'color', 'region', 'best_start',
  'best_end', 'unpaired_start', 'unpaired_end', 'best_start_offset',
  'best_end_offset', 'offsets',
]);
const REASONS = new Set([
  'incomplete_pair', 'invalid_identity_or_years',
  'producer_only_scope_not_reviewed', 'invalid_region_or_offsets', 'no_pair',
]);
const HASH = /^[0-9a-f]{64}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value, keys) => Object.keys(value).every((key) => keys.has(key));
const isYear = (value, max = 2200) => Number.isInteger(value) && value >= 1800 && value <= max;

export function parseOptions(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--candidates' || arg === '--expected-sha256') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      options[arg] = argv[++index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options['--candidates'] || !HASH.test(options['--expected-sha256'] ?? '')) {
    throw new Error('Usage: stage_workbook_candidates.mjs --candidates PRIVATE_JSON --expected-sha256 HASH [--apply]');
  }
  return options;
}

export function validateCandidates(rows, expectedSha256) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 250 || !HASH.test(expectedSha256)) {
    throw new Error('Expected 1 to 250 candidates and a workbook SHA-256');
  }
  const locators = new Set();
  let staged = 0;
  let quarantined = 0;
  for (const row of rows) {
    if (!isObject(row) || !hasOnly(row, ROW_KEYS)
        || row.source_sha256 !== expectedSha256
        || typeof row.source_locator !== 'string'
        || row.source_locator.length > 100 || !LOCATOR.test(row.source_locator)
        || locators.has(row.source_locator)) {
      throw new Error('Candidate has an invalid source or duplicate reference-sheet locator');
    }
    locators.add(row.source_locator);
    const id = row.source_identity;
    if (!isObject(id) || !hasOnly(id, IDENTITY_KEYS)
        || JSON.stringify(id).length > 8000
        || !isObject(id.source_cells) || !hasOnly(id.source_cells, CELL_KEYS)
        || !Object.values(id.source_cells).every((cell) => typeof cell === 'string' && CELL.test(cell))
        || !['producer', 'cuvee', 'appellation', 'region', 'color', 'historical_bin']
          .every((key) => id[key] === undefined || (typeof id[key] === 'string' && id[key].length <= 200))
        || (id.historical_bin !== undefined && !['standard', 'premium'].includes(id.historical_bin))
        || !['unpaired_start_year', 'unpaired_end_year'].every((key) =>
          id[key] === undefined || id[key] === null || isYear(id[key], 2300))) {
      throw new Error('Candidate identity must contain only reference-sheet fields');
    }
    const vintage = row.vintage_year;
    const start = row.best_start_year;
    const end = row.best_end_year;
    if (!Object.hasOwn(row, 'first_trial_year') || row.first_trial_year !== null
        || (vintage !== null && !isYear(vintage))
        || (start !== null && !isYear(start, 2300))
        || (end !== null && !isYear(end, 2300))
        || (start !== null && end !== null && start > end)
        || (vintage !== null && start !== null && start < vintage)
        || (row.wine_color !== null && !['red', 'white', 'rose'].includes(row.wine_color))) {
      throw new Error('Workbook candidate has an invalid year pair or colour');
    }
    if (row.review_status === 'staged') {
      if (!['release', 'producer_appellation', 'producer_region', 'region'].includes(row.candidate_scope)
          || row.review_reason !== undefined || !isYear(vintage)
          || !isYear(start, 2300) || !isYear(end, 2300) || row.wine_color === null) {
        throw new Error('A staged candidate must have a valid optimum pair and identity');
      }
      staged++;
    } else if (row.review_status === 'needs-review') {
      if (row.candidate_scope !== 'quarantine' || !REASONS.has(row.review_reason)) {
        throw new Error('Quarantined candidates require a known review reason');
      }
      quarantined++;
    } else {
      throw new Error('Only staged or quarantined workbook candidates are accepted');
    }
  }
  return { total: rows.length, staged, quarantined, source_sha256: expectedSha256 };
}

export async function stageCandidates(rows, { supabaseUrl, secretKey, serviceRoleKey, fetchImpl = fetch }) {
  const key = secretKey ?? serviceRoleKey;
  if (!key || !supabaseUrl) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for --apply');
  const url = new URL(supabaseUrl);
  if (url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:'
          && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)))) {
    throw new Error('SUPABASE_URL must be HTTPS, except for localhost');
  }
  const response = await fetchImpl(new URL('/rest/v1/rpc/drinking_window_stage_workbook_candidates', url), {
    method: 'POST',
    headers: supabaseServiceHeaders(key),
    body: JSON.stringify({ p_rows: rows }),
  });
  if (!response.ok) throw new Error(`Private candidate staging failed (HTTP ${response.status}); no candidate contents were logged`);
  const result = await response.json();
  if (!Array.isArray(result) || result.length !== 1
      || !Number.isInteger(result[0].inserted_count)
      || !Number.isInteger(result[0].unchanged_count)
      || result[0].inserted_count + result[0].unchanged_count !== rows.length) {
    throw new Error('Candidate staging returned an unexpected count; check the private database before retrying');
  }
  return result[0];
}

async function run() {
  const options = parseOptions(process.argv.slice(2));
  const source = await realpath(resolve(options['--candidates']));
  const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const inRepo = relative(repoRoot, source);
  if (inRepo === '' || (!inRepo.startsWith('..') && !isAbsolute(inRepo))) {
    throw new Error('Candidate JSON must remain outside the repository');
  }
  if ((await stat(source)).size > 2_000_000) throw new Error('Candidate JSON exceeds the 2 MB limit');
  const rows = JSON.parse(await readFile(source, 'utf8'));
  const summary = validateCandidates(rows, options['--expected-sha256']);
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', ...summary }, null, 2)}\n`);
    return;
  }
  const result = await stageCandidates(rows, {
    supabaseUrl: process.env.SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  process.stdout.write(`${JSON.stringify({ mode: 'applied', ...summary, ...result }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
