import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../../docs/schemas/producer_exchange_v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('date', {
  type: 'string',
  validate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  },
});
ajv.addFormat('uri', {
  type: 'string',
  validate(value) {
    try { return Boolean(new URL(value).protocol); } catch { return false; }
  },
});
const validateSchema = ajv.compile(schema);

const fail = (path, issue) => { throw new Error(`${path}: ${issue}`); };
const obj = (value, path) => value && typeof value === 'object' && !Array.isArray(value) ? value : fail(path, 'expected object');
const arr = (value, path) => Array.isArray(value) ? value : fail(path, 'expected array');
const str = (value, path) => typeof value === 'string' && value.trim() ? value : fail(path, 'expected nonempty text');
const yr = (value, path) => Number.isInteger(value) && value >= 1800 && value <= 2200 ? value : fail(path, 'invalid calendar year');
const volume = (value, path) => Number.isInteger(value) && value >= 50 && value <= 30000 ? value : fail(path, 'explicit format_ml 50..30000 required');
const unique = (rows, label, fn) => {
  const seen = new Set();
  for (const [i, row] of rows.entries()) {
    const key = fn(row);
    if (seen.has(key)) fail(`${label}[${i}]`, 'duplicate identity');
    seen.add(key);
  }
};
const ordered = (proposal, vintage, path) => {
  const first = yr(proposal.first_trial_year, path + '.first_trial_year');
  const start = yr(proposal.best_start_year, path + '.best_start_year');
  const end = yr(proposal.best_end_year, path + '.best_end_year');
  if (first < vintage || first > start || start > end) fail(path, 'three milestones must be ordered');
  return [first, start, end];
};
export function validateProducerResearchPackage(input) {
  const d = obj(input, '$');
  if (!validateSchema(d)) {
    const details = validateSchema.errors.slice(0, 20).map(error => {
      const field = error.params?.missingProperty || error.params?.additionalProperty;
      return `${error.instancePath || '$'}${field ? `/${field}` : ''}: ${error.message}`;
    }).join('; ');
    fail('schema', details);
  }
  if (d.format !== 'cellarmanager.producer_research' || d.schema_version !== '1.1.0'
      || d.status !== 'draft_for_curator_review' || d.scope !== 'producer_independent_of_any_household')
    fail('$', 'unsupported exchange version or non-draft research');
  obj(d.producer, 'producer');
  if (!d.import_policy?.review_required || !d.import_policy?.no_direct_production_publication
      || !d.import_policy?.no_direct_household_inventory_write) fail('import_policy', 'unsafe publication policy');
  const sources = new Map(arr(d.sources, 'sources').map(s => [s.id, s]));
  if (sources.size !== d.sources.length) fail('sources', 'duplicate source ID');
  const checkSources = (ids, path, urls = null) => {
    const list = arr(ids, path);
    if (!list.length || new Set(list).size !== list.length) fail(path, 'empty or duplicate source pointers');
    for (const id of list) if (!sources.has(id)) fail(path, `unknown source pointer ${id}`);
    if (urls && (urls.length !== list.length || list.some(id => !urls.includes(sources.get(id).url))))
      fail(path, 'source URL mismatch');
  };
  for (const s of sources.values()) {
    if (typeof s.url !== 'string' || !s.url.startsWith('https://')) fail('sources', 'HTTPS URLs required');
    if (s.reuse?.store_raw_content !== false || s.reuse?.pointer_candidate_only !== true)
      fail('sources', 'research cannot grant raw-storage or publication rights');
  }
  checkSources(d.producer.source_ids, 'producer.source_ids');
  const cuvees = new Map(arr(d.cuvees, 'cuvees').map(c => [c.id, c]));
  if (cuvees.size !== d.cuvees.length) fail('cuvees', 'duplicate cuvee ID');
  for (const c of cuvees.values()) {
    str(c.name, 'cuvee.name');str(c.appellation,'cuvee.appellation');str(c.region,'cuvee.region');
    checkSources(c.source_ids,'cuvee.source_ids');
    if (c.format_constraint_ml != null) volume(c.format_constraint_ml,'cuvee.format_constraint_ml');
    if (c.vintage_existence_policy !== 'never_infer_from_vintage_effect_or_name_history')
      fail('cuvee', 'name history may not imply production');
    for (const h of c.name_history || []) checkSources(h.source_ids, 'name_history.source_ids');
  }
  const hasCuvee = (id, path) => { if (!cuvees.has(id)) fail(path, 'unknown cuvee_id'); };
  for (const v of arr(d.vintage_effects,'vintage_effects')) {
    yr(v.vintage,'vintage_effect.vintage'); checkSources(v.source_ids,'vintage_effect.source_ids');
    for (const id of v.applies_to_cuvee_ids) {hasCuvee(id,'vintage_effect');if (cuvees.get(id).color !== v.color) fail('vintage_effect','colour mismatch');}
  }
  const nonproduced = new Set((d.known_nonproduced_releases || []).map(x => `${x.cuvee_id}|${x.vintage}`));
  for (const r of d.known_nonproduced_releases || []) {hasCuvee(r.cuvee_id,'nonproduced');checkSources(r.source_ids,'nonproduced.source_ids');}
  const releases=arr(d.exact_release_calibrations,'exact_release_calibrations');
  unique(releases,'exact_release_calibrations',r=>`${r.cuvee_id}|${r.vintage}|${r.format_ml}`);
  for (const r of releases) {
    hasCuvee(r.cuvee_id,'release');yr(r.vintage,'release.vintage');volume(r.format_ml,'release.format_ml');
    if (cuvees.get(r.cuvee_id).format_constraint_ml && cuvees.get(r.cuvee_id).format_constraint_ml !== r.format_ml)
      fail('release','violates cuvee format constraint');
    if (nonproduced.has(`${r.cuvee_id}|${r.vintage}`)) fail('release','known not produced');
    if (r.release_existence?.status !== 'confirmed_by_named_vintage_source') fail('release','missing asserted release existence');
    checkSources(r.release_existence.source_ids,'release.existence',r.release_existence.source_urls);
    checkSources(r.proposal?.supporting_source_ids,'release.proposal',r.proposal?.supporting_source_urls);
    ordered(r.proposal,r.vintage,'release.proposal');
    if (r.proposal.review_status !== 'candidate_not_approved') fail('release.proposal','must remain unapproved');
  }
  for (const x of d.external_drinking_observations || []) {
    hasCuvee(x.cuvee_id,'observation');volume(x.format_ml,'observation.format_ml');
    checkSources([x.source_id],'observation.source_id',[x.source_url]);
  }
  for (const p of d.structure_profiles || []) {hasCuvee(p.cuvee_id,'structure');checkSources(p.source_ids,'structure.source_ids');}
  for (const p of d.pairing_profiles || []) {
    hasCuvee(p.cuvee_id,'pairing');checkSources(p.source_ids,'pairing.source_ids');
    if (!['structural_inference_not_directly_tasted','documented_pairing_source_pending_review'].includes(p.hypothesis_basis))
      fail('pairing','hypothesis_basis required');
    for (const dish of p.pairings) {
      checkSources(dish.source_ids,'pairing.dish.source_ids');
      if (!['structural_inference_not_directly_tasted','documented_pairing_source_pending_review'].includes(dish.evidence_basis))
        fail('pairing.dish','evidence_basis required');
    }
  }
  for (const x of d.source_discrepancies || []) checkSources(x.source_ids,'discrepancy');
  return {schema_version:d.schema_version,status:'research-only',producer:d.producer.name,
    cuvee_count:cuvees.size,exact_calibration_count:releases.length,publishable_rows:0};
}

function releaseReviewFromValidatedPack(pack, cuveeId, vintage, currentYears, formatMl) {
  const matching = pack.exact_release_calibrations.filter(r=>r.cuvee_id===cuveeId && r.vintage===vintage && r.format_ml===formatMl);
  if (matching.length !== 1) fail('release','no exact cuvee/vintage/format calibration');
  const row=matching[0], cuvee=pack.cuvees.find(c=>c.id===cuveeId);
  const sources=new Map(pack.sources.map(s=>[s.id,s]));
  const proposed=ordered(row.proposal,vintage,'proposal');
  const existing=currentYears===null?null:ordered(currentYears,vintage,'currentYears');
  const observations=(pack.external_drinking_observations || []).filter(x => x.cuvee_id===cuveeId && x.vintage===vintage);
  return {status:'research-only',scope:'release',producer:pack.producer.name,cuvee:cuvee.name,cuvee_id_hint:cuveeId,
    vintage,format_ml:formatMl,proposed_years:proposed,current_draft_years:existing,
    date_conflict:existing!==null && proposed.some((x,i)=>x!==existing[i]),
    rationale:row.proposal.rationale,confidence:row.proposal.confidence,
    evidence_status:'unreviewed_pointer_evidence',
    release_existence_pointers:row.release_existence.source_ids.map(id=>({id,url:sources.get(id).url})),
    evidence_pointers:row.proposal.supporting_source_ids.map(id=>({id,url:sources.get(id).url})),
    same_format_observations:observations.filter(x=>x.format_ml===formatMl),
    other_format_observation_count:observations.filter(x=>x.format_ml!==formatMl).length,
    required_reviews:['confirm_identity_and_format','confirm_named_release_existence','review_all_three_dates',
      'verify_evidence_fit_and_rights','resolve_conflicting_draft'],publication_allowed:false};
}
export function producerReleaseReview(pack, cuveeId, vintage, currentYears = null, formatMl = 750) {
  validateProducerResearchPackage(pack);
  return releaseReviewFromValidatedPack(pack,cuveeId,vintage,currentYears,formatMl);
}
export function producerResearchReviewManifest(pack) {
  validateProducerResearchPackage(pack);
  return {
    status:'research-only',
    producer:pack.producer.name,
    dataset_version:pack.dataset_version,
    publishable_rows:0,
    release_reviews:pack.exact_release_calibrations.map(row =>
      releaseReviewFromValidatedPack(pack,row.cuvee_id,row.vintage,null,row.format_ml)),
  };
}
async function main(args) {
  if (![1,2,3,4,5].includes(args.length) || (args.length===2 && args[1]!=='--review-all'))
    throw new Error('Usage: node producer_research_package.mjs FILE [--review-all | CUVEE_ID VINTAGE [CURRENT_FIRST,CURRENT_START,CURRENT_END] [FORMAT_ML]]');
  const pack=JSON.parse(await readFile(args[0],'utf8'));
  let output=validateProducerResearchPackage(pack);
  if(args[1]==='--review-all') output=producerResearchReviewManifest(pack);
  else if(args.length>=3) {
    const now=args[3] ? Object.fromEntries(['first_trial_year','best_start_year','best_end_year'].map((k,i)=>[k,Number(args[3].split(',')[i])])) : null;
    output=producerReleaseReview(pack,args[1],Number(args[2]),now,args[4] ? Number(args[4]) : 750);
  }
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2)).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
