begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table pilot_ids as
select version.id version_id, row.id row_id, row.producer_id,
    row.product_id cote_product_id, row.release_id cote_release_id,
    row.appellation_id, row.region_id
from public.drinking_window_reference_versions version
join public.drinking_window_reference_rows row on row.version_id = version.id
where version.id = private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2');

select is((select status from public.drinking_window_reference_versions
    where id = private.enrichment_seed_uuid(
        'drinking-window:first-shared:burgaud-2022:version')),
    'withdrawn', 'Old regional draft is retired, not deleted or publishable');
select is((select count(*) from public.drinking_window_ageing_groups
    where version_id = private.enrichment_seed_uuid(
        'drinking-window:first-shared:burgaud-2022:version')),
    1::bigint, 'Historical group and private-choice foreign keys are preserved');
select is((select count(*) from pilot_ids), 1::bigint,
    'Replacement draft has one exact Côte du Py release');
select is((select status from public.drinking_window_reference_versions
    where id = (select version_id from pilot_ids)), 'draft',
    'Replacement remains unpublished');
select is((select count(*) from public.drinking_window_reference_rows
    where version_id = (select version_id from pilot_ids)), 1::bigint,
    'Only one release-specific row is drafted');
select is((select count(*) from public.drinking_window_ageing_groups
    where version_id = (select version_id from pilot_ids)), 0::bigint,
    'No generic group is carried into the replacement');
select is((select scope || '/' || format_ml::text || '/' ||
    first_trial_year::text || '/' || best_start_year::text || '/' ||
    best_end_year::text from public.drinking_window_reference_rows
    where id = (select row_id from pilot_ids)),
    'release/750/2025/2028/2040',
    'The owner-selected dates are restricted to the 750 ml exact release');

create temp table test_releases as
select product.id product_id, release.id release_id,
    product.canonical_name
from public.wine_reference_products product
join public.wine_reference_releases release on release.product_id = product.id
where product.producer_id = (select producer_id from pilot_ids)
  and release.vintage_year = 2022;

select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.cote_product_id, i.cote_release_id,
        i.appellation_id, i.region_id, 'red', 2022, null::uuid, 750) result),
    'draft_match', 'Côte du Py 2022 750 ml matches');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.cote_product_id, i.cote_release_id,
        i.appellation_id, i.region_id, 'red', 2022, null::uuid, 1500) result),
    'no_match', 'The same release in 1500 ml does not inherit 750 ml dates');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.cote_product_id, i.cote_release_id,
        i.appellation_id, i.region_id, 'red', 2022) result),
    'no_match', 'An unqualified preview cannot bypass size');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_batch(i.version_id,
        jsonb_build_array(jsonb_build_object(
            'producer_id', i.producer_id,
            'product_id', i.cote_product_id,
            'release_id', i.cote_release_id,
            'appellation_id', i.appellation_id,
            'region_id', i.region_id,
            'wine_color', 'red', 'vintage_year', 2022,
            'format_ml', 750))) result), 'draft_match',
    'Batch coverage can preview a verified 750 ml release');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_batch(i.version_id,
        jsonb_build_array(jsonb_build_object(
            'producer_id', i.producer_id,
            'product_id', i.cote_product_id,
            'release_id', i.cote_release_id,
            'appellation_id', i.appellation_id,
            'region_id', i.region_id,
            'wine_color', 'red', 'vintage_year', 2022,
            'format_ml', 1500))) result), 'no_match',
    'Batch coverage excludes an unreviewed magnum');
select is((select status from pilot_ids i,
    test_releases release,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, release.product_id, release.release_id,
        i.appellation_id, i.region_id, 'red', 2022, null::uuid, 750) result
    where pg_catalog.strpos(private.normalize_wine_reference_text(
        release.canonical_name), 'james') > 0),
    'no_match', 'James has no silently inherited Côte du Py dates');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.cote_product_id, null,
        i.appellation_id, i.region_id, 'red', 2022, null::uuid, 750) result),
    'no_match', 'A product name without a release link is insufficient');

insert into public.wines (
    id, household_id, producer, cuvee, vintage, color, appellation, area,
    format_ml, wine_reference_id, wine_reference_type
) select 'f7100000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000100', 'Jean-Marc Burgaud',
    'Côte du Py', 2022, 'red', 'Morgon', 'Beaujolais', 750,
    i.cote_release_id, 'release' from pilot_ids i;
insert into public.wines (
    id, household_id, producer, cuvee, vintage, color, appellation, area,
    format_ml, wine_reference_id, wine_reference_type
) select 'f7100000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000100', 'Jean-Marc Burgaud',
    'Côte du Py', 2022, 'red', 'Morgon', 'Beaujolais', 1500,
    i.cote_release_id, 'release' from pilot_ids i;

select is((select status from pilot_ids i,
    private.drinking_window_preview_draft_match_for_wine(
        'f7100000-0000-4000-8000-000000000001',
        i.version_id, i.producer_id, i.cote_product_id, i.cote_release_id,
        i.appellation_id, i.region_id, 'red', 2022) match),
    'draft_match', 'The owner-bound draft selector matches the 750 ml wine');
select is((select status from pilot_ids i,
    private.drinking_window_preview_draft_match_for_wine(
        'f7100000-0000-4000-8000-000000000002',
        i.version_id, i.producer_id, i.cote_product_id, i.cote_release_id,
        i.appellation_id, i.region_id, 'red', 2022) match),
    'no_match', 'The owner-bound draft selector excludes the magnum');

select is((select count(*) from pilot_ids i,
    public.drinking_window_draft_issues(i.version_id)), 0::bigint,
    'Owner evidence, provenance rights, and draft shape pass diagnostics');
select is((select count(*) from pilot_ids i,
    public.drinking_window_eligibility_issues(i.version_id)), 0::bigint,
    'The exact release and place identity pass eligibility');
select is((select count(*) from pilot_ids i,
    public.drinking_window_evidence_fit_issues(i.version_id)), 0::bigint,
    'Owner evidence fits the exact release');
select is((select count(*) from pilot_ids i,
    public.drinking_window_review_issues(i.version_id)
    where issue_code = 'missing_current_approval'), 1::bigint,
    'Curator approval is still genuinely missing');

select is((select draft_status from pilot_ids i,
    public.drinking_window_shadow_compare(i.version_id,
        '00000000-0000-4000-8000-000000000100',
        array['f7100000-0000-4000-8000-000000000001'::uuid]) comparison),
    'draft_match', 'Owner comparison includes the 750 ml candidate');
select is((select draft_status from pilot_ids i,
    public.drinking_window_shadow_compare(i.version_id,
        '00000000-0000-4000-8000-000000000100',
        array['f7100000-0000-4000-8000-000000000002'::uuid]) comparison),
    'no_match', 'Owner comparison excludes the magnum');

-- Rollback-only matcher fixture: publication is simulated here solely to
-- prove that a future opt-in cannot leak 750 ml advice to a magnum.
select set_config('app.drinking_window_publication', 'on', true);
update public.drinking_window_reference_versions version
set status = 'active', published_at = now(),
    content_sha256 = public.drinking_window_draft_fingerprint(version.id)
where version.id = (select version_id from pilot_ids);
insert into private.drinking_window_publications
    (version_id, content_sha256, reviewed_household_count)
select id, content_sha256, 1
from public.drinking_window_reference_versions
where id = (select version_id from pilot_ids);
insert into private.drinking_window_household_rollouts
    (household_id, version_id, approved_report_id, enabled)
select '00000000-0000-4000-8000-000000000100',
    (select version_id from pilot_ids), report.report_id, true
from public.record_drinking_window_shadow_report(
    (select version_id from pilot_ids),
    '00000000-0000-4000-8000-000000000100') report;
update private.drinking_window_runtime_switch
set enabled = true, version_id = (select version_id from pilot_ids)
where singleton;
select is(private.drinking_window_active_match(
    'f7100000-0000-4000-8000-000000000001') ->> 'reference_row_id',
    (select row_id::text from pilot_ids),
    'An opted-in 750 ml wine receives the exact release row');
select is(private.drinking_window_active_match(
    'f7100000-0000-4000-8000-000000000002') ->> 'status',
    'no_match', 'An opted-in magnum does not receive the 750 ml row');

select * from finish();
rollback;
