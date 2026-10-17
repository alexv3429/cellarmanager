import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateFirstReviewBatch } from './first_review_batch.mjs';

const batch = JSON.parse(await readFile(new URL('./first_review_batch.json', import.meta.url), 'utf8'));
const clone = (value) => structuredClone(value);

function workbookCandidates(source = batch) {
  return [...new Map(source.entries.map((entry) => [entry.workbook.source_locator, {
    source_sha256: source.source_sha256,
    source_locator: entry.workbook.source_locator,
    source_identity: {
      region: entry.region,
      historical_bin: entry.workbook.historical_bin,
    },
    wine_color: entry.wine_color,
    vintage_year: entry.vintage_year,
    best_start_year: entry.workbook.best_start_year,
    best_end_year: entry.workbook.best_end_year,
    review_reason: entry.workbook.historical_bin === null ? 'no_pair' : null,
  }])).values()];
}

test('the first research batch retains eight triplets but approves none', () => {
  const report = validateFirstReviewBatch(batch, workbookCandidates());
  assert.equal(report.workbook_export_checked, true);
  assert.equal(report.proposal_count, 8);
  assert.equal(report.approved_reference_count, 0);
  assert.equal(report.rows.filter((row) => row.source_assessment === 'conflicts_with_workbook').length, 4);
  assert.equal(report.rows.filter((row) => row.source_assessment === 'workbook_has_no_pair').length, 4);
  assert.ok(report.rows.every((row) => row.review_required.includes('verify_specific_evidence_and_reuse_rights')));
});

test('a changed workbook pair is rejected instead of silently adopting the proposal', () => {
  const candidates = workbookCandidates();
  candidates.find((row) => row.source_locator === 'Millesimes!L20:M20').best_start_year = 2024;
  assert.throws(() => validateFirstReviewBatch(batch, candidates), /Workbook export differs.*beaujolais-red-generic-2022/);
});

test('a 2023 source gap cannot be fabricated into a workbook pair', () => {
  const candidates = workbookCandidates();
  candidates.find((row) => row.source_locator === 'Millesimes!L21:O21').best_start_year = 2025;
  assert.throws(() => validateFirstReviewBatch(batch, candidates), /Workbook export differs/);
});

test('invalid chronological order or publication status is rejected', () => {
  const years = clone(batch);
  years.entries[0].first_trial_year = 2027;
  assert.throws(() => validateFirstReviewBatch(years), /three-milestone order/);
  const published = clone(batch);
  published.status = 'approved';
  assert.throws(() => validateFirstReviewBatch(published), /research-only batch/);
});

test('duplicate or unrecorded fields are rejected', () => {
  const duplicate = clone(batch);
  duplicate.entries[1].key = duplicate.entries[0].key;
  assert.throws(() => validateFirstReviewBatch(duplicate), /Duplicate proposal key/);
  const invented = clone(batch);
  invented.entries[0].rights_status = 'reuse-allowed';
  assert.throws(() => validateFirstReviewBatch(invented), /unexpected or missing fields/);
});
