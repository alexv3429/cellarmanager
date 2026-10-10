import assert from 'node:assert/strict';
import test from 'node:test';
import { convertWorkbookRows } from './workbook_candidates.mjs';

const hash = 'a'.repeat(64);
const sample = () => ({
  producerSheets: [{ name: 'Barraud', rows: [
    { row: 2, cells: [2019, 'En France', 'Pouilly-Fuissé', 'Blanc', 2024, 2030] },
    { row: 3, cells: [2021, '', 'Pouilly-Fuissé', 'Blanc', 2025, 2031] },
    { row: 4, cells: [2022, '', '', 'Blanc', 2025, 2032] },
    { row: 5, cells: [2023, '', 'Pouilly-Fuissé', 'Blanc', 2027, null] },
  ] }, { name: 'Chagnoleau', rows: [
    { row: 2, cells: [2022, '', '', 'Blanc', 2028, 2033] },
    { row: 3, cells: [2024, 'Madrigal', 'Pouilly-Fuissé', 'Blanc', 2030, 2035] },
  ] }],
  regionalRows: [
    { row: 3, cells: ['Bourgogne', null, 'Rouge', 2021, null, null, null, null, null, null, null, 2, 6, 4, 8] },
    { row: 4, cells: [null, null, null, 2022, null, null, null, null, null, null, null, 3, 7, 5, 10] },
    { row: 5, cells: ['Provence', null, 'Rosé', 2023, null, null, null, null, null, null, null, null, null, null, null] },
  ],
});

test('stages intact pairs without inventing the missing start-tasting year', () => {
  const { candidates, report } = convertWorkbookRows(sample(), hash);
  assert.deepEqual(report.counts, {
    release: 2, producer_appellation: 1, producer_region: 1, regional_standard: 2,
    regional_premium: 2, producer_only_unreviewed: 1, producer_partial: 1,
    regional_no_pair: 1, other_quarantine: 0,
  });
  assert.equal(report.staged_count, 8);
  assert.equal(report.quarantine_count, 3);
  assert.equal(report.publishable_three_milestone_count, 0);
  const release = candidates.find((candidate) => candidate.source_locator === 'Barraud!E2:F2');
  assert.equal(release.candidate_scope, 'release');
  assert.deepEqual([release.first_trial_year, release.best_start_year,
    release.best_end_year], [null, 2024, 2030]);
  assert.equal('drink_by_year' in release, false);
  const producer = candidates.find((candidate) => candidate.source_locator === 'Chagnoleau!E2:F2');
  assert.equal(producer.candidate_scope, 'producer_region');
  assert.equal(producer.review_status, 'staged');
  assert.deepEqual([producer.best_start_year, producer.best_end_year], [2028, 2033]);
  assert.ok(report.unresolved_mappings.find((mapping) => mapping.source_locator === 'Chagnoleau!E2:F2')
    .needs.includes('canonical_region'));
  assert.ok(report.unresolved_mappings.find((mapping) => mapping.source_locator === 'Chagnoleau!E2:F2')
    .needs.includes('ageing_group_membership'));
  assert.equal(report.unresolved_mappings.find((mapping) => mapping.source_locator === 'Chagnoleau!E2:F2')
    .needs.includes('canonical_appellation'), false);
  const region = candidates.find((candidate) => candidate.source_locator === 'Millesimes!N4:O4');
  assert.equal(region.source_identity.region, 'Bourgogne');
  assert.equal(region.source_identity.source_cells.region, 'Millesimes!A3');
  assert.equal(region.source_identity.source_cells.color, 'Millesimes!C3');
  assert.equal(region.source_identity.historical_bin, 'premium');
  assert.deepEqual([region.best_start_year, region.best_end_year], [2027, 2032]);
  const partial = candidates.find((candidate) => candidate.source_locator === 'Barraud!E5:F5');
  assert.equal(partial.review_status, 'needs-review');
  assert.deepEqual([partial.best_start_year, partial.best_end_year], [null, null]);
  assert.equal(partial.source_identity.unpaired_start_year, 2027);
  assert.equal(partial.source_identity.source_cells.unpaired_start, 'Barraud!E5');
  const rose = candidates.find((candidate) => candidate.source_locator === 'Millesimes!L5:O5');
  assert.equal(rose.wine_color, 'rose');
  assert.equal(rose.review_status, 'needs-review');
});

test('rejects invalid pairs without borrowing nearby vintages or colors', () => {
  const rows = sample();
  rows.regionalRows.push({ row: 6, cells: [null, null, null, 2024,
    null, null, null, null, null, null, null, 8, 2, null, null] });
  const { candidates, report } = convertWorkbookRows(rows, hash);
  assert.equal(report.counts.other_quarantine, 1);
  assert.equal(candidates.find((candidate) => candidate.source_locator === 'Millesimes!L6:M6').review_status, 'needs-review');
  assert.equal(candidates.find((candidate) => candidate.source_locator === 'Millesimes!N6:O6'), undefined);
});

test('same source snapshot and rows produce deterministic candidates', () => {
  assert.deepEqual(convertWorkbookRows(sample(), hash), convertWorkbookRows(sample(), hash));
});
