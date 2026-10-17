import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedKeys = new Set([
  'key', 'region', 'wine_color', 'vintage_year', 'proposed_group',
  'comparison_scope', 'first_trial_year', 'best_start_year', 'best_end_year', 'workbook',
]);
const expectedWorkbookKeys = new Set([
  'source_locator', 'historical_bin', 'best_start_year', 'best_end_year',
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value);
  const extra = actual.filter((key) => !keys.has(key));
  const missing = [...keys].filter((key) => !Object.hasOwn(value, key));
  if (extra.length || missing.length) {
    throw new Error(`${label} has unexpected or missing fields: ${[...extra, ...missing].join(', ')}`);
  }
}

function year(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (!Number.isInteger(value) || value < 1800 || value > 2300) {
    throw new Error(`${label} must be a calendar year${nullable ? ' or null' : ''}`);
  }
}

function validateEntry(entry) {
  assertObject(entry, 'Entry');
  exactKeys(entry, expectedKeys, entry.key || 'Entry');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(entry.key)
      || !['ALSACE', 'BEAUJOLAIS'].includes(entry.region)
      || !['white', 'red'].includes(entry.wine_color)
      || entry.comparison_scope !== 'unverified'
      || typeof entry.proposed_group !== 'string'
      || entry.proposed_group.trim().length < 15) {
    throw new Error(`Invalid identity or group in ${entry.key}`);
  }
  for (const name of ['vintage_year', 'first_trial_year', 'best_start_year', 'best_end_year']) {
    year(entry[name], `${entry.key}.${name}`);
  }
  if (entry.vintage_year > entry.first_trial_year
      || entry.first_trial_year > entry.best_start_year
      || entry.best_start_year > entry.best_end_year) {
    throw new Error(`Invalid three-milestone order in ${entry.key}`);
  }
  assertObject(entry.workbook, `${entry.key}.workbook`);
  exactKeys(entry.workbook, expectedWorkbookKeys, `${entry.key}.workbook`);
  if (!/^Millesimes!(?:L([0-9]+):M\1|N([0-9]+):O\2|L([0-9]+):O\3)$/.test(entry.workbook.source_locator)
      || ![null, 'standard', 'premium'].includes(entry.workbook.historical_bin)) {
    throw new Error(`Invalid workbook provenance in ${entry.key}`);
  }
  year(entry.workbook.best_start_year, `${entry.key}.workbook.best_start_year`, true);
  year(entry.workbook.best_end_year, `${entry.key}.workbook.best_end_year`, true);
  if ((entry.workbook.best_start_year === null) !== (entry.workbook.best_end_year === null)
      || (entry.workbook.best_start_year === null) !== (entry.workbook.historical_bin === null)) {
    throw new Error(`Incomplete historical pair in ${entry.key}`);
  }
  if (entry.workbook.best_start_year !== null
      && entry.workbook.best_start_year > entry.workbook.best_end_year) {
    throw new Error(`Invalid historical pair in ${entry.key}`);
  }
}

export function validateFirstReviewBatch(batch, candidates = null) {
  assertObject(batch, 'Batch');
  exactKeys(batch, new Set(['schema_version', 'batch_id', 'source_sha256', 'status', 'source_note', 'entries']), 'Batch');
  if (batch.schema_version !== 1 || batch.status !== 'research-only'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(batch.batch_id)
      || !/^[0-9a-f]{64}$/.test(batch.source_sha256)
      || typeof batch.source_note !== 'string' || batch.source_note.length < 40
      || !Array.isArray(batch.entries) || batch.entries.length !== 8) {
    throw new Error('Invalid research-only batch header or size');
  }
  if (candidates !== null && !Array.isArray(candidates)) {
    throw new Error('Workbook candidate export must be an array');
  }
  const keys = new Set();
  const rows = batch.entries.map((entry) => {
    validateEntry(entry);
    if (keys.has(entry.key)) throw new Error(`Duplicate proposal key: ${entry.key}`);
    keys.add(entry.key);
    if (candidates !== null) {
      const matches = candidates.filter((row) => row.source_locator === entry.workbook.source_locator
        && row.source_sha256 === batch.source_sha256);
      const candidate = matches[0];
      if (matches.length !== 1 || candidate.vintage_year !== entry.vintage_year
          || candidate.wine_color !== entry.wine_color
          || candidate.source_identity?.region !== entry.region
          || candidate.best_start_year !== entry.workbook.best_start_year
          || candidate.best_end_year !== entry.workbook.best_end_year
          || (entry.workbook.historical_bin === null
            ? candidate.review_reason !== 'no_pair'
            : candidate.source_identity?.historical_bin !== entry.workbook.historical_bin)) {
        throw new Error(`Workbook export differs from recorded provenance: ${entry.key}`);
      }
    }
    return {
      key: entry.key,
      proposed_years: [entry.first_trial_year, entry.best_start_year, entry.best_end_year],
      historical_workbook_years: [entry.workbook.best_start_year, entry.workbook.best_end_year],
      historical_workbook_locator: entry.workbook.source_locator,
      comparison_scope: entry.comparison_scope,
      historical_comparison: entry.workbook.best_start_year === null
        ? 'no_historical_pair'
        : entry.best_start_year === entry.workbook.best_start_year
          && entry.best_end_year === entry.workbook.best_end_year
          ? 'same_years_scope_unverified' : 'different_years_scope_unverified',
      owner_review: [
        'review_group_definition', 'review_complete_three_milestone_estimate',
      ],
      curator_work: [
        'verify_group_membership', 'verify_specific_evidence_and_reuse_rights',
      ],
    };
  });
  const pairKeys = new Set(batch.entries.map((entry) => `${entry.region}|${entry.wine_color}|${entry.vintage_year}|${entry.proposed_group}`));
  if (pairKeys.size !== batch.entries.length) throw new Error('Duplicate region/colour/vintage/group proposal');
  return {
    batch_id: batch.batch_id,
    status: batch.status,
    workbook_export_checked: candidates !== null,
    proposal_count: rows.length,
    approved_reference_count: 0,
    rows,
  };
}

async function main(argv) {
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--candidates')) {
    throw new Error('Usage: node scripts/drinking_window/first_review_batch.mjs [--candidates PRIVATE_CANDIDATES_JSON]');
  }
  const batch = JSON.parse(await readFile(new URL('./first_review_batch.json', import.meta.url), 'utf8'));
  const candidates = argv.length ? JSON.parse(await readFile(argv[1], 'utf8')) : null;
  process.stdout.write(`${JSON.stringify(validateFirstReviewBatch(batch, candidates), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
