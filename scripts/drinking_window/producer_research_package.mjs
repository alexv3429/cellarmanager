import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESEARCH_SCHEMA = 'cellarmanager.research.domaine.v1';
const RESEARCH_STATUS = 'DRAFT_NOT_VALIDATED_FOR_PUBLICATION';
const YEAR_MIN = 1800;
const YEAR_MAX = 2300;
const COLORS = new Set(['red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other']);
const STRUCTURE_KEYS = [
  'body', 'acidity', 'tannin', 'sweetness', 'alcohol', 'freshness', 'savoury', 'concentration',
];

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected non-empty text');
  return value;
}

function year(value, path) {
  if (!Number.isInteger(value) || value < YEAR_MIN || value > YEAR_MAX) {
    fail(path, 'expected a calendar year');
  }
  return value;
}

function yearsInOrder(value, path, vintage = null) {
  const dates = object(value, path);
  const first = year(dates.first_trial_year, `${path}.first_trial_year`);
  const start = year(dates.best_start_year, `${path}.best_start_year`);
  const end = year(dates.best_end_year, `${path}.best_end_year`);
  if ((vintage !== null && first < vintage) || first > start || start > end) {
    fail(path, 'the three milestones must be ordered and not precede the vintage');
  }
  return [first, start, end];
}

function sourcePointers(ids, known, path) {
  for (const id of array(ids, path)) {
    if (!known.has(id)) fail(path, `unknown source pointer ${String(id)}`);
  }
}

function uniqueId(value, seen, path) {
  const id = text(value, path);
  if (seen.has(id)) fail(path, `duplicate ID ${id}`);
  seen.add(id);
  return id;
}

export function validateProducerResearchPackage(input) {
  const pack = object(input, 'package');
  if (pack.schema !== RESEARCH_SCHEMA || pack.schema_version !== '1.0.0'
      || pack.status !== RESEARCH_STATUS) {
    fail('package', 'unsupported schema/version or a non-draft status');
  }
  const producer = object(pack.producer, 'producer');
  text(producer.id, 'producer.id');
  text(producer.name, 'producer.name');
  const knownSources = new Set();
  for (const [index, item] of array(pack.sources, 'sources').entries()) {
    const source = object(item, `sources[${index}]`);
    uniqueId(source.id, knownSources, `sources[${index}].id`);
    const url = text(source.url, `sources[${index}].url`);
    if (!/^https:\/\//.test(url)) fail(`sources[${index}].url`, 'expected an HTTPS pointer');
    if (source.rights !== 'pointer_only_unreviewed_for_publication') {
      fail(`sources[${index}].rights`, 'this research format cannot grant publication rights');
    }
  }
  sourcePointers(producer.sources, knownSources, 'producer.sources');

  const cuveeIds = new Set();
  const cuvees = array(pack.cuvees, 'cuvees');
  for (const [index, item] of cuvees.entries()) {
    const cuvee = object(item, `cuvees[${index}]`);
    uniqueId(cuvee.id, cuveeIds, `cuvees[${index}].id`);
    text(cuvee.display_name, `cuvees[${index}].display_name`);
    text(cuvee.appellation, `cuvees[${index}].appellation`);
    text(cuvee.region, `cuvees[${index}].region`);
    if (!COLORS.has(cuvee.color)) fail(`cuvees[${index}].color`, 'unsupported wine colour');
    if (cuvee.vintage_existence_not_implied !== true) {
      fail(`cuvees[${index}]`, 'a modeled range must not imply that a release exists');
    }
    if ((cuvee.base_ages_years === null) !== (cuvee.structure_estimate_0_to_5 === null)) {
      fail(`cuvees[${index}]`, 'unmodeled products must omit both ages and structure');
    }
    if (cuvee.base_ages_years !== null) {
      const ages = object(cuvee.base_ages_years, `cuvees[${index}].base_ages_years`);
      const ageValues = ['first_trial', 'best_start', 'best_end'].map((key) => ages[key]);
      if (ageValues.some((value) => !Number.isInteger(value) || value < 0 || value > 100)
          || ageValues[0] > ageValues[1] || ageValues[1] > ageValues[2]) {
        fail(`cuvees[${index}].base_ages_years`, 'invalid relative three-milestone ages');
      }
      const structure = object(cuvee.structure_estimate_0_to_5, `cuvees[${index}].structure_estimate_0_to_5`);
      for (const key of STRUCTURE_KEYS) {
        if (typeof structure[key] !== 'number' || structure[key] < 0 || structure[key] > 5) {
          fail(`cuvees[${index}].structure_estimate_0_to_5.${key}`, 'expected a 0–5 estimate');
        }
      }
    }
    array(cuvee.food_pairings, `cuvees[${index}].food_pairings`);
    sourcePointers(cuvee.sources, knownSources, `cuvees[${index}].sources`);
  }
  for (const [index, item] of array(pack.vintage_effects, 'vintage_effects').entries()) {
    const effect = object(item, `vintage_effects[${index}]`);
    year(effect.vintage, `vintage_effects[${index}].vintage`);
    object(effect.relative_year_adjustments, `vintage_effects[${index}].relative_year_adjustments`);
    sourcePointers(effect.source_ids, knownSources, `vintage_effects[${index}].source_ids`);
  }
  const calibrationKeys = new Set();
  for (const [index, item] of array(pack.exact_release_calibrations, 'exact_release_calibrations').entries()) {
    const row = object(item, `exact_release_calibrations[${index}]`);
    if (!cuveeIds.has(row.cuvee_id)) fail(`exact_release_calibrations[${index}]`, 'unknown cuvée');
    const vintage = year(row.vintage, `exact_release_calibrations[${index}].vintage`);
    const key = `${row.cuvee_id}|${vintage}`;
    if (calibrationKeys.has(key)) fail(`exact_release_calibrations[${index}]`, 'duplicate cuvée/vintage calibration');
    calibrationKeys.add(key);
    yearsInOrder(row, `exact_release_calibrations[${index}]`, vintage);
    sourcePointers(row.source_ids, knownSources, `exact_release_calibrations[${index}].source_ids`);
  }
  for (const [index, item] of array(pack.rename_events, 'rename_events').entries()) {
    const event = object(item, `rename_events[${index}]`);
    if (!cuveeIds.has(event.from_id) || !cuveeIds.has(event.to_id) || event.from_id === event.to_id) {
      fail(`rename_events[${index}]`, 'renames need two different known cuvées');
    }
    year(event.effective_from_vintage, `rename_events[${index}].effective_from_vintage`);
    sourcePointers(event.validated_by, knownSources, `rename_events[${index}].validated_by`);
  }
  array(pack.external_drinking_observations, 'external_drinking_observations');
  object(pack.methodology, 'methodology');
  return {
    schema: pack.schema,
    status: 'research-only',
    producer: { id: producer.id, name: producer.name },
    source_count: knownSources.size,
    cuvee_count: cuvees.length,
    exact_calibration_count: calibrationKeys.size,
    publishable_rows: 0,
  };
}

export function producerReleaseReview(pack, cuveeId, vintage, currentYears = null) {
  validateProducerResearchPackage(pack);
  year(vintage, 'vintage');
  const cuvee = pack.cuvees.find((row) => row.id === cuveeId);
  if (!cuvee) fail('cuveeId', 'unknown cuvée');
  const calibration = pack.exact_release_calibrations.find(
    (row) => row.cuvee_id === cuveeId && row.vintage === vintage,
  );
  if (!calibration) fail('release', 'no cuvée-specific vintage calibration');
  const sourceById = new Map(pack.sources.map((source) => [source.id, source]));
  const proposedYears = yearsInOrder(calibration, 'calibration', vintage);
  const existingYears = currentYears === null ? null : yearsInOrder(currentYears, 'currentYears', vintage);
  return {
    status: 'research-only',
    scope: 'release',
    producer: pack.producer.name,
    cuvee: cuvee.display_name,
    cuvee_id_hint: cuvee.id,
    appellation: cuvee.appellation,
    region: cuvee.region,
    color: cuvee.color,
    vintage,
    ageing_group_hint: cuvee.ageing_group_key ?? null,
    proposed_years: proposedYears,
    current_draft_years: existingYears,
    date_conflict: existingYears !== null && proposedYears.some((value, index) => value !== existingYears[index]),
    rationale: calibration.rationale,
    confidence: calibration.confidence,
    evidence_status: 'pointers_only_fit_and_rights_unreviewed',
    evidence_pointers: calibration.source_ids.map((id) => ({ id, url: sourceById.get(id).url })),
    required_reviews: [
      'confirm_canonical_producer_product_release_and_vintage',
      'confirm_release_existence',
      'review_three_dates_as_one_set',
      'review_evidence_fit_and_reuse_rights',
      'resolve_conflicting_draft',
    ],
    publication_allowed: false,
  };
}

async function main(argv) {
  if (argv.length < 1 || argv.length > 4 || (argv.length > 1 && argv.length < 3)) {
    throw new Error('Usage: node scripts/drinking_window/producer_research_package.mjs PACKAGE.json [CUVEE_ID VINTAGE [CURRENT_FIRST,CURRENT_START,CURRENT_END]]');
  }
  const pack = JSON.parse(await readFile(argv[0], 'utf8'));
  let result = validateProducerResearchPackage(pack);
  if (argv.length >= 3) {
    const vintage = Number(argv[2]);
    const current = argv[3] === undefined ? null : (() => {
      const values = argv[3].split(',').map(Number);
      if (values.length !== 3) fail('currentYears', 'expected three comma-separated years');
      return { first_trial_year: values[0], best_start_year: values[1], best_end_year: values[2] };
    })();
    result = producerReleaseReview(pack, argv[1], vintage, current);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
