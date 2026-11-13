import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { classifyCalibration, normalizeReferenceName } from './gate4_coverage_manifest.mjs';

const producer = { id: 'producer', name: 'Jean-Marc Burgaud', normalized: 'jean marc burgaud' };
const py = { id: 'py', producer_id: producer.id,
  name: 'Jean-Marc Burgaud, Côte du Py, Morgon',
  normalized: 'jean marc burgaud cote du py morgon' };
const james = { id: 'james', producer_id: producer.id,
  name: 'Jean-Marc Burgaud, Cote du Py James, Morgon',
  normalized: 'jean marc burgaud cote du py james morgon' };
const snapshot = {
  producers: [producer], producer_aliases: [],
  products: [py, james], product_aliases: [],
  releases: [{ id: 'py-2022', product_id: py.id, vintage: 2022 },
    { id: 'james-2022', product_id: james.id, vintage: 2022 }],
  places: [{ id: 'beaujolais', name: 'Beaujolais', normalized: 'beaujolais', type: 'region', parent_id: null },
    { id: 'morgon', name: 'Morgon', normalized: 'morgon', type: 'appellation', parent_id: 'beaujolais' }],
  place_aliases: [],
  reference_rows: [{ id: 'reviewed-py', version: 2, version_status: 'draft', scope: 'release',
    release_id: 'py-2022', format_ml: 750, color: 'red', region_id: 'beaujolais',
    appellation_id: 'morgon', first_trial_year: 2025, best_start_year: 2028,
    best_end_year: 2040, current_approval: true }],
};
const profile = {
  producer: { name: 'Domaine Jean-Marc Burgaud' },
  cuvees: [{ id: 'morgon_cote_du_py', name: 'Morgon Côte du Py',
    region: 'Beaujolais', appellation: 'Morgon', color: 'red' },
  { id: 'morgon_james', name: 'Morgon Côte du Py Cuvée James',
    region: 'Beaujolais', appellation: 'Morgon', color: 'red' }],
};
const pyDates = { cuvee_id: 'morgon_cote_du_py', vintage: 2022, format_ml: 750,
  proposal: { first_trial_year: 2025, best_start_year: 2028, best_end_year: 2040 } };
const file = 'Burgaud.json';
const overrides = { producers: { [file]: producer.name }, products: { [file]: {
  morgon_cote_du_py: py.name, morgon_james: james.name,
} } };

test('normalization agrees on accents and punctuation for lookup triage', () => {
  assert.equal(normalizeReferenceName('Côte-du-Py'), 'cote du py');
});

test('the already reviewed Côte du Py row is counted once, never auto-restaged', () => {
  const result = classifyCalibration(profile, pyDates, snapshot, overrides, file);
  assert.equal(result.status, 'already_reviewed_in_existing_draft');
  assert.equal(result.canonical_release_id, 'py-2022');
  assert.deepEqual(result.reasons, []);
});

test('James is a separate unreviewed release, not approved by the Py decision', () => {
  const result = classifyCalibration(profile, { ...pyDates, cuvee_id: 'morgon_james' },
    snapshot, overrides, file);
  assert.equal(result.status, 'quarantined');
  assert.equal(result.canonical_release_id, 'james-2022');
  assert.deepEqual(result.reasons, ['three_dates_and_source_rights_not_reviewed']);
});

test('an explicit Côte du Py to James identity override is rejected', () => {
  const wrong = structuredClone(overrides);
  wrong.products[file].morgon_cote_du_py = james.name;
  assert.throws(() => classifyCalibration(profile, pyDates, snapshot, wrong, file),
    /cuvée\/product identity terms disagree/);
});

test('a product override cannot silently resolve an unknown producer', () => {
  const wrong = structuredClone(overrides);
  delete wrong.producers[file];
  assert.throws(() => classifyCalibration(profile, pyDates, snapshot, wrong, file),
    /product override requires a resolved producer/);
});

test('an identical row without current approval is still quarantined', () => {
  const draft = structuredClone(snapshot);
  draft.reference_rows[0].current_approval = false;
  const result = classifyCalibration(profile, pyDates, draft, overrides, file);
  assert.equal(result.status, 'quarantined');
  assert.ok(result.reasons.includes('three_dates_and_source_rights_not_reviewed'));
});

test('the committed 23-file coverage is complete and cannot silently approve a row', async () => {
  const raw = await readFile(new URL('../../docs/drinking-window-gate4-coverage.json',
    import.meta.url), 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.profiles.length, 23);
  assert.equal(manifest.rows.length, 670);
  assert.equal(manifest.summary.newly_approved_for_publication, 0);
  assert.equal(manifest.summary.already_reviewed_in_existing_draft, 1);
  assert.equal(manifest.summary.quarantined, 669);
  assert.equal(manifest.profiles.reduce((sum, entry) => sum + entry.proposed_rows, 0), 670);
  assert.equal(manifest.profiles.reduce((sum, entry) => sum + entry.quarantined, 0), 669);
  assert.equal(manifest.rows.filter(row => row.identity_ready).length, 9);
  assert.equal(manifest.rows.filter(row => row.status === 'already_reviewed_in_existing_draft').length, 1);
  assert.ok(manifest.rows.every(row => row.status === 'quarantined'
    ? row.reasons.length > 0 : row.reasons.length === 0));
  assert.doesNotMatch(raw, /https?:\/\/|supporting_source|first_trial_year|best_start_year|best_end_year|household_id/);
});
