import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewIdentities } from './review_identities.mjs';

const sourceSha = 'a'.repeat(64);
const catalogue = () => ({
  producers: [{ id: 'p1', canonical_name: 'Domaine Barraud' },
    { id: 'p2', canonical_name: 'Domaine Chagnoleau' }],
  products: [{ id: 'w1', producer_id: 'p1', canonical_name: 'En France' }],
  releases: [{ id: 'r1', product_id: 'w1', vintage_year: 2019 }],
  places: [{ id: 'rg1', parent_id: null, place_type: 'region', canonical_name: 'Bourgogne' },
    { id: 'a1', parent_id: 'rg1', place_type: 'appellation', canonical_name: 'Pouilly-Fuissé' },
    { id: 'cl1', parent_id: 'rg1', place_type: 'classification', canonical_name: 'Bourgogne Grand Cru' }],
  place_aliases: [{ place_id: 'a1', alias_value: 'Pouilly Fuisse' }],
  wine_aliases: [{ entity_id: 'p1', entity_type: 'producer', alias_value: 'Barraud' },
    { entity_id: 'p2', entity_type: 'producer', alias_value: 'Chagnoleau' }],
});

const candidate = (scope, source, locator, vintage = 2019) => ({
  source_sha256: sourceSha, source_locator: locator, candidate_scope: scope,
  source_identity: source, review_status: 'staged', wine_color: 'white',
  vintage_year: vintage, first_trial_year: null,
  best_start_year: 2024, best_end_year: 2030,
});

test('suggests a coherent exact release but never verifies or publishes it', () => {
  const row = candidate('release', { producer: 'Barraud', cuvee: 'En France',
    appellation: 'Pouilly Fuisse' }, 'Barraud!E2:F2');
  const result = reviewIdentities([row], catalogue());
  assert.deepEqual(result.rows[0].matches, {
    producer: { status: 'suggested', ids: ['p1'] },
    appellation: { status: 'suggested', ids: ['a1'] },
    region: { status: 'suggested_from_appellation', ids: ['rg1'] },
    product: { status: 'suggested', ids: ['w1'] },
    release: { status: 'suggested', ids: ['r1'] },
  });
  assert.equal(result.summary.scope_identity_suggestions, 1);
  assert.equal(result.summary.publishable_count, 0);
  assert.equal(result.rows[0].publishable, false);
  assert.ok(result.rows[0].review_reasons.includes('first_trial_year_required'));
  assert.ok(result.rows[0].review_reasons.includes('source_rights_required'));
});

test('flags ambiguous aliases rather than selecting one producer', () => {
  const snapshot = catalogue();
  snapshot.wine_aliases.push({ entity_id: 'p2', entity_type: 'producer', alias_value: 'Barraud' });
  const row = candidate('release', { producer: 'Barraud', cuvee: 'En France',
    appellation: 'Pouilly-Fuissé' }, 'Barraud!E2:F2');
  const result = reviewIdentities([row], snapshot).rows[0];
  assert.deepEqual(result.matches.producer, { status: 'ambiguous', ids: ['p1', 'p2'] });
  assert.equal(result.matches.product.status, 'blocked_by_producer');
  assert.ok(result.review_reasons.includes('producer_ambiguous'));
});

test('offers surname hints without treating them as verified identities', () => {
  const snapshot = catalogue();
  snapshot.wine_aliases = [];
  const row = candidate('producer_appellation', { producer: 'Barraud',
    appellation: 'Pouilly-Fuissé' }, 'Barraud!E3:F3');
  const result = reviewIdentities([row], snapshot).rows[0];
  assert.equal(result.matches.producer.status, 'missing');
  assert.deepEqual(result.name_hints.producer, ['p1']);
  assert.ok(result.review_reasons.includes('producer_missing'));
  assert.equal(result.publishable, false);
});

test('keeps researched producer mappings workbook-scoped and unverified', () => {
  const snapshot = catalogue();
  snapshot.wine_aliases = [];
  const row = candidate('release', { producer: 'Barraud', cuvee: 'En France',
    appellation: 'Pouilly-Fuissé' }, 'Barraud!E2:F2');
  const producerResearch = { source_sha256: sourceSha, mappings: [{
    source_sheet: 'Barraud', workbook_producer: 'Barraud', canonical_producer: 'Domaine Barraud',
    evidence_urls: ['https://example.org/domaine'], research_note: 'Candidate only.',
  }] };
  const result = reviewIdentities([row], snapshot, { producerResearch });
  assert.deepEqual(result.rows[0].matches.producer, {
    status: 'research_supported', ids: ['p1'], evidence_urls: ['https://example.org/domaine'],
    research_note: 'Candidate only.',
  });
  assert.equal(result.rows[0].matches.product.status, 'suggested');
  assert.ok(result.rows[0].review_reasons.includes('producer_confirmation_required'));
  assert.equal(result.summary.research_supported_producer_candidates, 1);
  assert.equal(result.summary.scope_identity_suggestions, 0);
  assert.equal(result.rows[0].publishable, false);
  assert.deepEqual(snapshot.wine_aliases, []);
});

test('rejects stale, ambiguous, and conflicting producer research', () => {
  const row = candidate('producer_appellation', { producer: 'Barraud',
    appellation: 'Pouilly-Fuissé' }, 'Barraud!E2:F2');
  const mapping = { source_sheet: 'Barraud', workbook_producer: 'Barraud',
    canonical_producer: 'Domaine Barraud', evidence_urls: ['https://example.org/domaine'],
    research_note: 'Candidate only.' };
  assert.throws(() => reviewIdentities([row], catalogue(), { producerResearch: {
    source_sha256: 'b'.repeat(64), mappings: [mapping],
  } }), /workbook SHA-256/);
  const ambiguous = catalogue();
  ambiguous.producers.push({ id: 'p3', canonical_name: 'Domaine Barraud' });
  assert.throws(() => reviewIdentities([row], ambiguous, { producerResearch: {
    source_sha256: sourceSha, mappings: [mapping],
  } }), /missing or ambiguous/);
  const conflicting = catalogue();
  conflicting.wine_aliases.push({ entity_id: 'p2', entity_type: 'producer', alias_value: 'Barraud' });
  assert.throws(() => reviewIdentities([row], conflicting, { producerResearch: {
    source_sha256: sourceSha, mappings: [mapping],
  } }), /conflicts with catalogue/);
  assert.throws(() => reviewIdentities([row], catalogue(), { producerResearch: {
    source_sha256: sourceSha, mappings: [{ ...mapping, source_sheet: 'Other' }],
  } }), /no matching source rows/);
});

test('requires explicit region review for producer-wide guidance and eligibility for regional bins', () => {
  const rows = [candidate('producer_region', { producer: 'Chagnoleau' }, 'Chagnoleau!E2:F2'),
    candidate('region', { region: 'Bourgogne', historical_bin: 'standard' }, 'Millesimes!L3:M3')];
  const result = reviewIdentities(rows, catalogue());
  assert.equal(result.rows[0].matches.region.status, 'missing');
  assert.ok(result.rows[0].review_reasons.includes('ageing_group_eligibility_required'));
  assert.deepEqual(result.rows[1].matches.region, { status: 'suggested', ids: ['rg1'] });
  assert.ok(result.rows[1].review_reasons.includes('ageing_group_eligibility_required'));
  assert.equal(result.summary.publishable_count, 0);
});

test('does not substitute a classification for a missing appellation or publish quarantined rows', () => {
  const rows = [candidate('producer_appellation', { producer: 'Barraud',
    appellation: 'Bourgogne Grand Cru' }, 'Barraud!E3:F3'),
  { ...candidate('quarantine', { producer: 'Barraud' }, 'Barraud!E4:F4'),
    review_status: 'needs-review', review_reason: 'incomplete_pair' }];
  const result = reviewIdentities(rows, catalogue());
  assert.equal(result.rows[0].matches.appellation.status, 'missing');
  assert.ok(result.rows[0].review_reasons.includes('appellation_missing'));
  assert.deepEqual(result.rows[1].review_reasons, ['incomplete_pair']);
  assert.equal(result.summary.quarantine_count, 1);
});

test('keeps vintage and producer boundaries when suggesting a release', () => {
  const snapshot = catalogue();
  snapshot.releases[0].vintage_year = 2020;
  snapshot.products.push({ id: 'w2', producer_id: 'p2', canonical_name: 'En France' });
  const row = candidate('release', { producer: 'Barraud', cuvee: 'En France',
    appellation: 'Pouilly-Fuissé' }, 'Barraud!E2:F2', 2019);
  const result = reviewIdentities([row], snapshot).rows[0];
  assert.deepEqual(result.matches.product, { status: 'suggested', ids: ['w1'] });
  assert.deepEqual(result.matches.release, { status: 'missing', ids: [] });
  assert.ok(result.review_reasons.includes('release_missing'));
});

test('rejects malformed catalogue relationships and duplicate source locators', () => {
  const snapshot = catalogue();
  snapshot.products[0].producer_id = 'unknown';
  assert.throws(() => reviewIdentities([], snapshot), /no producer/);
  const row = candidate('region', { region: 'Bourgogne' }, 'Millesimes!L3:M3');
  assert.throws(() => reviewIdentities([row, row], catalogue()), /duplicate source locator/);
});

test('keeps the raw Barraud label but reviews its appellation and Premier Cru separately', () => {
  const snapshot = catalogue();
  snapshot.places.push({ id: 'pc1', parent_id: 'a1', place_type: 'classification',
    canonical_name: 'Pouilly-Fuissé Premier Cru' });
  const row = candidate('release', { producer: 'Barraud', cuvee: 'Sur la Roche',
    appellation: 'Pouilly-Fuissé 1C', color: 'Blanc' }, 'Barraud!E5:F5', 2023);
  const manifest = { source_sha256: sourceSha, row_interpretations: [{
    source_locator: row.source_locator,
    expected: { producer: 'Barraud', cuvee: 'Sur la Roche', appellation: 'Pouilly-Fuissé 1C',
      color: 'Blanc', vintage_year: 2023 },
    corrected: { appellation: 'Pouilly-Fuissé', classification: 'Pouilly-Fuissé Premier Cru' },
    owner_note: 'Owner confirmed the appellation and classification.',
  }], scope_interpretations: [] };
  const result = reviewIdentities([row], snapshot, { sourceInterpretations: manifest }).rows[0];
  assert.equal(result.source_identity.appellation, 'Pouilly-Fuissé 1C');
  assert.equal(result.review_identity.appellation, 'Pouilly-Fuissé');
  assert.deepEqual(result.matches.appellation, { status: 'suggested', ids: ['a1'] });
  assert.deepEqual(result.matches.classification, { status: 'suggested', ids: ['pc1'] });
  assert.ok(result.review_reasons.includes('classification_eligibility_required'));
  assert.equal(result.publishable, false);
});

test('a corrected Vin de France designation cannot inherit a false appellation or region', () => {
  const snapshot = catalogue();
  snapshot.places.push({ id: 'a2', parent_id: 'rg1', place_type: 'appellation',
    canonical_name: 'Terrasses du Larzac' });
  const row = candidate('release', { producer: 'Cal Demoura', cuvee: 'Belle Fiolle',
    appellation: 'Terrasses du Larzac', color: 'Rouge' }, 'Cal Demoura!E4:F4', 2023);
  const manifest = { source_sha256: sourceSha, row_interpretations: [{
    source_locator: row.source_locator,
    expected: { producer: 'Cal Demoura', cuvee: 'Belle Fiolle',
      appellation: 'Terrasses du Larzac', color: 'Rouge', vintage_year: 2023 },
    corrected: { appellation: null, designation: 'Vin de France' },
    owner_note: 'Owner confirmed Vin de France.',
  }], scope_interpretations: [] };
  const result = reviewIdentities([row], snapshot, { sourceInterpretations: manifest }).rows[0];
  assert.equal(result.source_identity.appellation, 'Terrasses du Larzac');
  assert.equal(result.review_identity.designation, 'Vin de France');
  assert.deepEqual(result.matches.appellation, { status: 'not_applicable', ids: [] });
  assert.deepEqual(result.matches.region, { status: 'missing', ids: [] });
  assert.ok(result.review_reasons.includes('designation_model_review_required'));
  assert.equal(result.publishable, false);
});

test('records grouped and producer-wide intent without establishing wine eligibility', () => {
  const rows = [candidate('producer_appellation', { producer: 'Boillot', cuvee: '',
    appellation: 'Volnay', color: 'Rouge' }, 'Boillot!E50:F50', 2022),
  candidate('producer_region', { producer: 'Chagnoleau', cuvee: '',
    appellation: '', color: 'Blanc' }, 'Chagnoleau!E2:F2', 2016)];
  const manifest = { source_sha256: sourceSha, row_interpretations: [], scope_interpretations: [
    { source_sheet: 'Boillot', candidate_scope: 'producer_appellation', expected_count: 1,
      intent: 'grouped_cuvees', owner_note: 'Cuvée membership needs review.' },
    { source_sheet: 'Chagnoleau', candidate_scope: 'producer_region', expected_count: 1,
      intent: 'producer_vintage_guidance', owner_note: 'Partial producer advice.' },
  ] };
  const result = reviewIdentities(rows, catalogue(), { sourceInterpretations: manifest });
  assert.equal(result.rows[0].scope_interpretation.intent, 'grouped_cuvees');
  assert.ok(result.rows[0].review_reasons.includes('grouped_cuvee_membership_required'));
  assert.equal(result.rows[1].scope_interpretation.intent, 'producer_vintage_guidance');
  assert.ok(result.rows[1].review_reasons.includes('producer_wine_eligibility_required'));
  assert.equal(result.summary.owner_interpreted_scope_rows, 2);
  assert.equal(result.summary.publishable_count, 0);
});

test('rejects stale owner interpretations rather than applying them to changed source rows', () => {
  const row = candidate('release', { producer: 'Barraud', cuvee: 'Sur la Roche',
    appellation: 'Pouilly-Fuissé 1C', color: 'Blanc' }, 'Barraud!E5:F5', 2023);
  const entry = { source_locator: row.source_locator,
    expected: { producer: 'Barraud', cuvee: 'Sur la Roche', appellation: 'Pouilly-Fuissé 1C',
      color: 'Blanc', vintage_year: 2023 },
    corrected: { appellation: 'Pouilly-Fuissé', classification: 'Pouilly-Fuissé Premier Cru' },
    owner_note: 'Confirmed.' };
  const manifest = { source_sha256: sourceSha, row_interpretations: [entry], scope_interpretations: [] };
  assert.throws(() => reviewIdentities([row], catalogue(), { sourceInterpretations: {
    ...manifest, source_sha256: 'b'.repeat(64),
  } }), /workbook SHA-256/);
  assert.throws(() => reviewIdentities([row], catalogue(), { sourceInterpretations: {
    ...manifest, row_interpretations: [{ ...entry, expected: { ...entry.expected, vintage_year: 2022 } }],
  } }), /stale or invalid/);
  assert.throws(() => reviewIdentities([row], catalogue(), { sourceInterpretations: {
    ...manifest, scope_interpretations: [{ source_sheet: 'Barraud', candidate_scope: 'producer_appellation',
      expected_count: 1, intent: 'grouped_cuvees', owner_note: 'Wrong scope.' }],
  } }), /stale or invalid/);
});

test('a classification under another appellation is flagged as incompatible', () => {
  const snapshot = catalogue();
  snapshot.places.push({ id: 'a2', parent_id: 'rg1', place_type: 'appellation',
    canonical_name: 'Another appellation' },
  { id: 'pc2', parent_id: 'a2', place_type: 'classification',
    canonical_name: 'Pouilly-Fuissé Premier Cru' });
  const row = candidate('release', { producer: 'Barraud', cuvee: 'Sur la Roche',
    appellation: 'Pouilly-Fuissé 1C', color: 'Blanc' }, 'Barraud!E5:F5', 2023);
  const manifest = { source_sha256: sourceSha, row_interpretations: [{
    source_locator: row.source_locator,
    expected: { producer: 'Barraud', cuvee: 'Sur la Roche', appellation: 'Pouilly-Fuissé 1C',
      color: 'Blanc', vintage_year: 2023 },
    corrected: { appellation: 'Pouilly-Fuissé', classification: 'Pouilly-Fuissé Premier Cru' },
    owner_note: 'Confirmed.',
  }], scope_interpretations: [] };
  const result = reviewIdentities([row], snapshot, { sourceInterpretations: manifest }).rows[0];
  assert.equal(result.matches.classification.status, 'incompatible');
  assert.ok(result.review_reasons.includes('classification_appellation_conflict'));
  assert.equal(result.publishable, false);
});
