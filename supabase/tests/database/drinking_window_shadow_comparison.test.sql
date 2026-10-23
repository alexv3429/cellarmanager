begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.shadow_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select has_function('public', 'drinking_window_shadow_compare',
    array['uuid', 'uuid', 'uuid[]'], 'Private household shadow comparison exists');
select ok(
    has_function_privilege('service_role',
        'public.drinking_window_shadow_compare(uuid,uuid,uuid[])', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_shadow_compare(uuid,uuid,uuid[])', 'EXECUTE')
    and not has_function_privilege('powersync_role',
        'public.drinking_window_shadow_compare(uuid,uuid,uuid[])', 'EXECUTE'),
    'Only the service may compare private cellar state');

insert into public.enrichment_places (id, place_type, canonical_name)
values ('e5000000-0000-4000-8000-000000000001', 'region', 'Shadow Test Region');
insert into public.enrichment_places (id, parent_id, place_type, canonical_name)
values ('e5000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000001', 'appellation', 'Shadow Test Appellation');
insert into public.enrichment_place_aliases (place_id, alias_value)
values ('e5000000-0000-4000-8000-000000000002', 'Shadow App Alias');
insert into public.drinking_window_reference_versions (id, version_number)
values ('e5000000-0000-4000-8000-000000000003', 991311);
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     all_at_scope, first_trial_year, best_start_year, best_end_year, rationale)
values ('e5000000-0000-4000-8000-000000000004',
    'e5000000-0000-4000-8000-000000000003', 'region',
    'e5000000-0000-4000-8000-000000000001', 'red', 2022,
    true, 2024, 2026, 2032, 'Synthetic shadow candidate');

insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area)
values
    ('e5000000-0000-4000-8000-000000000010',
     '00000000-0000-4000-8000-000000000100', 'Shadow Producer',
     'Model Wine', 2022, 'rouge', 'Shadow App Alias', 'Shadow Test Region'),
    ('e5000000-0000-4000-8000-000000000011',
     '00000000-0000-4000-8000-000000000100', 'Shadow Producer',
     'Manual Wine', 2022, 'red', 'Shadow Test Appellation', 'Shadow Test Region'),
    ('e5000000-0000-4000-8000-000000000012',
     '00000000-0000-4000-8000-000000000100', 'Shadow Producer',
     'Other Colour', 2022, 'white', 'Shadow Test Appellation', 'Shadow Test Region'),
    ('e5000000-0000-4000-8000-000000000013',
     '00000000-0000-4000-8000-000000000100', 'Shadow Producer',
     'No Region', 2022, 'red', 'Shadow Test Appellation', 'Unmapped Region');

-- Fresh databases intentionally have no active legacy maturity knowledge.
-- Publish the existing test baseline so this comparison has a real model
-- projection rather than silently exercising only the no-baseline path.
do $$ begin perform public.install_initial_maturity_knowledge(); end $$;

insert into public.wine_enrichment_projections
    (household_id, wine_id, knowledge_version_id, projection_type, method,
     specificity, confidence, input_fingerprint, recommendation)
select '00000000-0000-4000-8000-000000000100',
    'e5000000-0000-4000-8000-000000000010', v.id,
    'maturity', 'curated-inference', 'regional-style', 0.5,
    repeat('a', 64),
    '{"schema_version":"1","state":"ready","urgency":"ready", "warnings":[],"reasons":[],"first_trial_year":2023,"best_start_year":2025,"best_end_year":2030,"drink_by_year":2035}'::jsonb
from public.enrichment_knowledge_versions v where v.status = 'active';

select is((select count(*) from public.wine_enrichment_projections
    where wine_id = 'e5000000-0000-4000-8000-000000000010'
      and projection_type = 'maturity' and status = 'current'),
    1::bigint, 'The synthetic model baseline exists before comparison');

insert into public.wine_maturity_overrides
    (household_id, wine_id, first_trial_year, best_start_year,
     best_end_year, drink_by_year, created_by)
values ('00000000-0000-4000-8000-000000000100',
    'e5000000-0000-4000-8000-000000000011',
    2023, 2027, 2031, 2035, '00000000-0000-4000-8000-000000000001');

create function pg_temp.shadow_ids() returns uuid[] language sql immutable as $$
    select array[
        'e5000000-0000-4000-8000-000000000010'::uuid,
        'e5000000-0000-4000-8000-000000000011'::uuid,
        'e5000000-0000-4000-8000-000000000012'::uuid,
        'e5000000-0000-4000-8000-000000000013'::uuid
    ];
$$;

select is((select count(*) from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())),
    4::bigint, 'One report row is returned for every requested household wine');
select is((select comparison_status from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    'changed', 'A three-date model difference is reported');
select is((select first_trial_delta::text || '/' || best_start_delta || '/' || best_end_delta
    from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    '1/1/2', 'All three milestone differences are visible');
select is((select identity_status from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    'wine_reference_unlinked', 'Exact place alias does not invent a producer link');
select is((select comparison_status from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000011'),
    'manual_preserved', 'A personal manual window is never treated as an overwrite');
select is((select current_first_trial_year::text || '/' || current_best_start_year
    || '/' || current_best_end_year from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000011'),
    '2023/2027/2031', 'The report shows the effective manual window');
select is((select comparison_status from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000012'),
    'no_match', 'A red reference is not borrowed for white wine');
select is((select identity_status from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000013'),
    'region_unresolved', 'Unknown region is reported, not inferred from appellation');
select is((select comparison_status from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000013'),
    'missing_key', 'Unknown region produces no suggestion');
select ok((select length(draft_sha256) = 64 and draft_issue_count > 0
    from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    limit 1), 'Comparison is fingerprinted and unreviewed draft issues remain visible');
select ok(pg_temp.shadow_rejects($test$
    select * from public.drinking_window_shadow_compare(
        'e5000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000200',
        array['e5000000-0000-4000-8000-000000000010'::uuid])
$test$, '22023'), 'Cross-household wine IDs are rejected');
select ok(pg_temp.shadow_rejects($test$
    select * from public.drinking_window_shadow_compare(
        'e5000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000100',
        array['e5000000-0000-4000-8000-000000000010'::uuid,
              'e5000000-0000-4000-8000-000000000010'::uuid])
$test$, '22023'), 'Duplicate wine IDs are rejected');
select ok(pg_temp.shadow_rejects($test$
    select * from public.drinking_window_shadow_compare(
        'e5000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000100',
        array[]::uuid[])
$test$, '22023'), 'Empty batches are rejected');
select is((select status from public.drinking_window_reference_versions
    where id = 'e5000000-0000-4000-8000-000000000003'),
    'draft', 'Shadow comparison never publishes the reference');
select is((select first_trial_year from public.wine_maturity_overrides
    where wine_id = 'e5000000-0000-4000-8000-000000000011'),
    2023, 'Shadow comparison leaves manual advice unchanged');

select set_config('request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000001', true);
insert into private.member_maturity_calibrations (user_id, year_shift)
values ('00000000-0000-4000-8000-000000000001', 1)
on conflict (user_id) do update set year_shift = excluded.year_shift;
select is((select current_source from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    'personalized_model', 'The baseline identifies the owner-adjusted model');
select is((select current_first_trial_year::text || '/' || current_best_start_year
    || '/' || current_best_end_year
    from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    '2024/2026/2031', 'Current comparison dates include personal timing');
select is((select first_trial_delta::text || '/' || best_start_delta
    || '/' || best_end_delta
    from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    '0/0/1', 'Comparison differences use visible, not raw model dates');
select is((select current_first_trial_year::text || '/' || current_best_start_year
    || '/' || current_best_end_year
    from public.drinking_window_shadow_compare(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000011'),
    '2023/2027/2031', 'Personal timing does not shift manual dates');
select set_config('test.shadow_hash_before',
    private.drinking_window_shadow_snapshot(
        'e5000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000100') ->> 'content_sha256',
    true);
update private.member_maturity_calibrations set year_shift = 2
where user_id = '00000000-0000-4000-8000-000000000001';
select isnt(private.drinking_window_shadow_snapshot(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100') ->> 'content_sha256',
    current_setting('test.shadow_hash_before'),
    'Changing owner timing invalidates the reviewed snapshot hash');
select ok((select report_id is not null
    from public.record_drinking_window_shadow_report(
        'e5000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000100')),
    'The personalized full-cellar report is recorded for the owner');
select set_config('request.jwt.claim.sub', '', true);
select is((select current_first_trial_year from
    public.drinking_window_shadow_compare(
        'e5000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000100', pg_temp.shadow_ids())
    where wine_id = 'e5000000-0000-4000-8000-000000000010'),
    2025, 'Service-side replay uses the bound owner timing');
select is(private.drinking_window_shadow_snapshot(
    'e5000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000100') ->> 'content_sha256',
    (select content_sha256 from private.drinking_window_shadow_reports
     where version_id = 'e5000000-0000-4000-8000-000000000003'
     order by report_sequence desc limit 1),
    'Service-side publication replays the owner-bound report hash');

select * from finish();
rollback;
