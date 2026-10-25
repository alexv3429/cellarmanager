import assert from 'node:assert/strict';
import test from 'node:test';
import { producerReleaseReview, validateProducerResearchPackage } from './producer_research_package.mjs';

const fixture = {
  schema: 'cellarmanager.research.domaine.v1',
  schema_version: '1.0.0',
  status: 'DRAFT_NOT_VALIDATED_FOR_PUBLICATION',
  producer: { id: 'example-estate', name: 'Example Estate', sources: ['estate'] },
  sources: [{
    id: 'estate', url: 'https://example.org/wines',
    rights: 'pointer_only_unreviewed_for_publication',
  }],
  cuvees: [{
    id: 'example-long', display_name: 'Long Ageing', appellation: 'Morgon',
    region: 'Beaujolais', color: 'red', vintage_existence_not_implied: true,
    base_ages_years: { first_trial: 4, best_start: 8, best_end: 16 },
    structure_estimate_0_to_5: {
      body: 4, acidity: 4, tannin: 4, sweetness: 0,
      alcohol: 3, freshness: 4, savoury: 3, concentration: 4,
    },
    food_pairings: [], sources: ['estate'], ageing_group_key: 'long',
  }, {
    id: 'special-magnum', display_name: 'Special Magnum', appellation: 'Morgon',
    region: 'Beaujolais', color: 'red', vintage_existence_not_implied: true,
    base_ages_years: null, structure_estimate_0_to_5: null,
    food_pairings: [], sources: ['estate'],
  }],
  vintage_effects: [{
    vintage: 2022, relative_year_adjustments: { first_trial: 0, best_start: 1, best_end: 2 },
    source_ids: ['estate'],
  }],
  exact_release_calibrations: [{
    cuvee_id: 'example-long', vintage: 2022,
    first_trial_year: 2026, best_start_year: 2032, best_end_year: 2042,
    rationale: 'Owner-authored research estimate', confidence: 'medium', source_ids: ['estate'],
  }],
  rename_events: [],
  external_drinking_observations: [],
  methodology: { windows: 'Three distinct years' },
};

const copy = () => structuredClone(fixture);

test('a research package validates without becoming publishable', () => {
  const result = validateProducerResearchPackage(fixture);
  assert.equal(result.cuvee_count, 2);
  assert.equal(result.exact_calibration_count, 1);
  assert.equal(result.publishable_rows, 0);
});

test('a cuvée-specific release proposal preserves a material conflict', () => {
  const result = producerReleaseReview(fixture, 'example-long', 2022, {
    first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035,
  });
  assert.deepEqual(result.proposed_years, [2026, 2032, 2042]);
  assert.deepEqual(result.current_draft_years, [2025, 2028, 2035]);
  assert.equal(result.date_conflict, true);
  assert.equal(result.publication_allowed, false);
  assert.equal(result.evidence_pointers[0].url, 'https://example.org/wines');
});

test('missing release-specific calibration cannot borrow a generic age or vintage modifier', () => {
  assert.throws(() => producerReleaseReview(fixture, 'special-magnum', 2022), /no cuvée-specific vintage calibration/);
  assert.throws(() => producerReleaseReview(fixture, 'example-long', 2023), /no cuvée-specific vintage calibration/);
});

test('duplicate and invalid calibrations fail', () => {
  const duplicate = copy();
  duplicate.exact_release_calibrations.push(structuredClone(duplicate.exact_release_calibrations[0]));
  assert.throws(() => validateProducerResearchPackage(duplicate), /duplicate cuvée\/vintage calibration/);
  const inverted = copy();
  inverted.exact_release_calibrations[0].best_start_year = 2043;
  assert.throws(() => validateProducerResearchPackage(inverted), /milestones must be ordered/);
});

test('source pointers and publication rights cannot be invented by the research pack', () => {
  const missing = copy();
  missing.exact_release_calibrations[0].source_ids = ['not-in-sources'];
  assert.throws(() => validateProducerResearchPackage(missing), /unknown source pointer/);
  const rights = copy();
  rights.sources[0].rights = 'approved';
  assert.throws(() => validateProducerResearchPackage(rights), /cannot grant publication rights/);
  const status = copy();
  status.status = 'PUBLISHED';
  assert.throws(() => validateProducerResearchPackage(status), /non-draft status/);
});

test('a modeled range never asserts that a release exists', () => {
  const exists = copy();
  exists.cuvees[0].vintage_existence_not_implied = false;
  assert.throws(() => validateProducerResearchPackage(exists), /must not imply that a release exists/);
});
