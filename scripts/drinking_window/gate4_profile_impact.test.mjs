import assert from 'node:assert/strict';
import test from 'node:test';
import { measureProfileImpact } from './gate4_profile_impact.mjs';

const file = 'CellarManager_Burgaud.json';
const profiles = { [file]: {
  producer: { name: 'Domaine Jean-Marc Burgaud' },
  cuvees: [
    { id: 'py', name: 'Morgon Côte du Py', aliases: ['Côte du Py'], color: 'red' },
    { id: 'james', name: 'Morgon Côte du Py Cuvée James', aliases: ['James'], color: 'red' },
  ],
  exact_release_calibrations: [
    { cuvee_id: 'py', vintage: 2022, format_ml: 750 },
    { cuvee_id: 'james', vintage: 2022, format_ml: 750 },
  ],
} };
const map = { [file]: ['Burgaud'] };
const wine = (cuvee, vintage = 2022, format_ml = 750) => ({
  producer: 'Burgaud', cuvee, vintage, format_ml, color: 'red', bottles: 2,
});

test('counts exact release candidates without mistaking James for Côte du Py', () => {
  const result = measureProfileImpact(profiles, map, [wine('Cote du Py'), wine('James')]);
  assert.deepEqual(result.exact_cuvee_vintage_format, { wines: 2, bottles: 4 });
  assert.equal(result.rows[0].unique_profile_rows_hit, 2);
  assert.match(result.policy, /Candidate overlap only/);
});

test('does not infer a missing vintage, bottle size or wine colour', () => {
  const result = measureProfileImpact(profiles, map, [
    wine('James', 2023), wine('James', 2022, 1500),
    { ...wine('James'), color: 'white' }, wine('James', null),
  ]);
  assert.deepEqual(result.exact_cuvee_vintage_format, { wines: 0, bottles: 0 });
  assert.equal(result.rows[0].missing_vintage_after_cuvee_match, 1);
  assert.equal(result.rows[0].color_mismatches, 1);
});

test('ambiguous producer labels are rejected rather than linked', () => {
  const other = { ...profiles[file], producer: { name: 'Other' } };
  assert.throws(() => measureProfileImpact({ ...profiles, Other: other },
    { [file]: ['Burgaud'], Other: ['burgaud'] }, []), /Ambiguous/);
});
