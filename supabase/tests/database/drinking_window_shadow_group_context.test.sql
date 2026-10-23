begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
    not has_function_privilege('authenticated',
        'private.drinking_window_shadow_snapshot(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'private.drinking_window_shadow_snapshot_before_group_context(uuid,uuid)',
        'EXECUTE'),
    'Neither the new snapshot nor its predecessor is directly callable by members');

insert into public.enrichment_places (id, place_type, canonical_name)
values ('f6000000-0000-4000-8000-000000000001', 'region',
    'Synthetic Group Context Region');
insert into public.drinking_window_reference_versions (id, version_number)
values ('f6000000-0000-4000-8000-000000000002', 991813);
insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
values ('f6000000-0000-4000-8000-000000000003',
    'f6000000-0000-4000-8000-000000000002', 'region',
    'f6000000-0000-4000-8000-000000000001', 'white',
    'reviewed-long-ageing', 'Only individually reviewed long-ageing wines');
insert into public.drinking_window_ageing_group_memberships
    (version_id, group_id, member_kind, member_place_id, rationale)
values ('f6000000-0000-4000-8000-000000000002',
    'f6000000-0000-4000-8000-000000000003', 'place',
    'f6000000-0000-4000-8000-000000000001',
    'Synthetic reviewed regional membership');
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year,
     rationale)
values ('f6000000-0000-4000-8000-000000000004',
    'f6000000-0000-4000-8000-000000000002', 'region',
    'f6000000-0000-4000-8000-000000000001', 'white', 2022,
    'f6000000-0000-4000-8000-000000000003', 2024, 2026, 2031,
    'Synthetic owner-reviewed estimate');
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, area)
values ('f6000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000100',
    'Synthetic Producer', 'Group Wine', 2022, 'white',
    'Synthetic Group Context Region');

select is((select item.value ->> 'draft_status'
    from jsonb_array_elements(private.drinking_window_shadow_snapshot(
        'f6000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100') -> 'rows') item(value)
    where item.value ->> 'wine_id' = 'f6000000-0000-4000-8000-000000000005'),
    'draft_match', 'The synthetic wine matches the reviewed group');
select is((select item.value ->> 'proposed_group_key'
    from jsonb_array_elements(private.drinking_window_shadow_snapshot(
        'f6000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100') -> 'rows') item(value)
    where item.value ->> 'wine_id' = 'f6000000-0000-4000-8000-000000000005'),
    'reviewed-long-ageing', 'The report carries the proposed group identity');
select is((select item.value ->> 'proposed_group_definition'
    from jsonb_array_elements(private.drinking_window_shadow_snapshot(
        'f6000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100') -> 'rows') item(value)
    where item.value ->> 'wine_id' = 'f6000000-0000-4000-8000-000000000005'),
    'Only individually reviewed long-ageing wines',
    'The report explains the group behind the proposed dates');
select is((select item.value ->> 'proposed_reference_rationale'
    from jsonb_array_elements(private.drinking_window_shadow_snapshot(
        'f6000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100') -> 'rows') item(value)
    where item.value ->> 'wine_id' = 'f6000000-0000-4000-8000-000000000005'),
    'Synthetic owner-reviewed estimate',
    'The report explains the reference row rationale');

select set_config('test.group_context_hash',
    private.drinking_window_shadow_snapshot(
        'f6000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000100') ->> 'content_sha256', true);
update public.drinking_window_ageing_groups
set definition = 'Revised individually reviewed long-ageing wines'
where id = 'f6000000-0000-4000-8000-000000000003';
select isnt(private.drinking_window_shadow_snapshot(
    'f6000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000100') ->> 'content_sha256',
    current_setting('test.group_context_hash'),
    'A changed group definition invalidates the owner report hash');

select * from finish();
rollback;
