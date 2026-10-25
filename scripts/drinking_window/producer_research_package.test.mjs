import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateProducerResearchPackage, producerReleaseReview, producerResearchReviewManifest } from './producer_research_package.mjs';
const source={id:'estate',title:'Estate',url:'https://example.org/wines',type:'producer',checked_on:'2026-10-25',
  reuse:{status:'rights_not_reviewed',store_raw_content:false,normalized_claim_publication:'requires_review',pointer_candidate_only:true}};
const sample={
 format:'cellarmanager.producer_research',schema_version:'1.1.0',dataset_version:'1.0.0',generated_on:'2026-10-25',
 language:'en',status:'draft_for_curator_review',scope:'producer_independent_of_any_household',
 producer:{id:'estate',name:'Example Estate',aliases:[],country:'France',region:'Beaujolais',source_ids:['estate']},
 sources:[source],
 cuvees:[{id:'wine',name:'Example Wine',aliases:[],appellation:'Morgon',region:'Beaujolais',color:'red',
   identity_status:'source_supported',name_history:[],source_ids:['estate'],
   vintage_existence_policy:'never_infer_from_vintage_effect_or_name_history'}],
 vintage_effects:[{vintage:2022,color:'red',applies_to_cuvee_ids:['wine'],tag:'balanced',
   producer_specific_observation:'Example',maturity_direction:'longer_possible',confidence:'low',source_ids:['estate']}],
 exact_release_calibrations:[{cuvee_id:'wine',vintage:2022,format_ml:750,
   release_existence:{status:'confirmed_by_named_vintage_source',source_ids:['estate'],source_urls:[source.url]},
   proposal:{first_trial_year:2026,best_start_year:2030,best_end_year:2038,date_origin:'curator_model_estimate_not_source_fact',
     confidence:'low',rationale:'Hypothesis',supporting_source_ids:['estate'],supporting_source_urls:[source.url],
     milestone_support:{first_trial_year:'modeled',best_start_year:'modeled',best_end_year:'modeled'},review_status:'candidate_not_approved'}}],
 pairing_profiles:[{cuvee_id:'wine',scope:'general_cuvee_not_release',
   pairings:[{dish_key:'grilled_meat',strength:'medium',rationale:'structural inference',source_ids:['estate'],
     evidence_basis:'structural_inference_not_directly_tasted'}],
   cautions:[],service:{},confidence:'low',status:'structural_hypothesis_not_tasted_pairing',
   source_ids:['estate'],hypothesis_basis:'structural_inference_not_directly_tasted'}],
 import_policy:{canonical_source_of_truth:'this_JSON_only',review_required:true,no_direct_household_inventory_write:true,
   no_direct_production_publication:true,release_existence:'never_generate_releases_by_cartesian_product_of_cuvees_and_vintages',
   unknown_dates:'omit_dates_entirely_rather_than_synthesize_when_uncorroborated'}
};
const cp=()=>structuredClone(sample);
test('v1.1 research accepted but publishable rows remain zero',()=>{
 const result=validateProducerResearchPackage(sample);assert.equal(result.publishable_rows,0);assert.equal(result.exact_calibration_count,1);
});
test('exact release review respects bottle size and conflicts',()=>{
 const v=producerReleaseReview(sample,'wine',2022,{first_trial_year:2025,best_start_year:2028,best_end_year:2035},750);
 assert.equal(v.date_conflict,true);assert.equal(v.publication_allowed,false);assert.equal(v.format_ml,750);
 assert.throws(()=>producerReleaseReview(sample,'wine',2022,null,1500),/no exact cuvee\/vintage\/format/);
});
test('batch review keeps same-size observations separate and never approves proposals',()=>{
 const x=cp();
 x.external_drinking_observations=[
   {cuvee_id:'wine',vintage:2022,format_ml:750,source_id:'estate',source_url:source.url,original_claim_type:'drink_by',end_year:2036},
   {cuvee_id:'wine',vintage:2022,format_ml:1500,source_id:'estate',source_url:source.url,original_claim_type:'optimum',best_start_year:2027,best_end_year:2042},
 ];
 const manifest=producerResearchReviewManifest(x);
 assert.equal(manifest.publishable_rows,0);
 assert.equal(manifest.release_reviews.length,1);
 assert.equal(manifest.release_reviews[0].publication_allowed,false);
 assert.deepEqual(manifest.release_reviews[0].proposed_years,[2026,2030,2038]);
 assert.equal(manifest.release_reviews[0].same_format_observations.length,1);
 assert.equal(manifest.release_reviews[0].same_format_observations[0].format_ml,750);
 assert.equal(manifest.release_reviews[0].other_format_observation_count,1);
 assert.deepEqual(manifest.release_reviews[0].release_existence_pointers,[{id:'estate',url:source.url}]);
});
test('reject missing format, pairing provenance and inverted dates',()=>{
 let x=cp();delete x.exact_release_calibrations[0].format_ml;assert.throws(()=>validateProducerResearchPackage(x),/format_ml/);
 x=cp();delete x.pairing_profiles[0].pairings[0].source_ids;assert.throws(()=>validateProducerResearchPackage(x),/source_ids/);
 x=cp();x.exact_release_calibrations[0].proposal.best_start_year=2045;assert.throws(()=>validateProducerResearchPackage(x),/milestones must be ordered/);
});
test('reject invented release and source claims',()=>{
 let x=cp();x.exact_release_calibrations[0].cuvee_id='invented';assert.throws(()=>validateProducerResearchPackage(x),/unknown cuvee_id/);
 x=cp();x.exact_release_calibrations[0].proposal.supporting_source_ids=['made_up'];assert.throws(()=>validateProducerResearchPackage(x),/unknown source pointer/);
 x=cp();x.status='published';assert.throws(()=>validateProducerResearchPackage(x),/\/status: must be equal to constant/);
});
test('validator enforces the full exchange schema, not just release semantics',()=>{
 let x=cp();delete x.producer.name;assert.throws(()=>validateProducerResearchPackage(x),/\/producer\/name: must have required property/);
 x=cp();x.producer.household_id='private';assert.throws(()=>validateProducerResearchPackage(x),/\/producer\/household_id: must NOT have additional properties/);
 x=cp();x.sources[0].checked_on='2026-02-30';assert.throws(()=>validateProducerResearchPackage(x),/\/sources\/0\/checked_on: must match format/);
 x=cp();delete x.exact_release_calibrations[0].proposal.rationale;
 assert.throws(()=>validateProducerResearchPackage(x),/\/exact_release_calibrations\/0\/proposal\/rationale: must have required property/);
});
test('vintage effects cannot create release calibrations',()=>{
 const x=cp();x.exact_release_calibrations=[];assert.equal(validateProducerResearchPackage(x).exact_calibration_count,0);
 assert.throws(()=>producerReleaseReview(x,'wine',2022),/no exact cuvee\/vintage\/format/);
});
test('copyable producer template is a valid, non-publishable empty draft',()=>{
 const template=JSON.parse(readFileSync(new URL('../../docs/examples/producer-research-template.json',import.meta.url),'utf8'));
 const result=validateProducerResearchPackage(template);
 assert.equal(result.exact_calibration_count,0);
 assert.equal(result.publishable_rows,0);
});
