begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.ageing_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select set_config('test.ageing_version',
    private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:version')::text,
    true);
select set_config('test.ageing_long_group',
    private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:group')::text,
    true);
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     wine_reference_id, wine_reference_type)
select 'f7000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000100',
    'Jean-Marc Burgaud', 'Côte du Py', 2022, 'red', 'Morgon', 'Beaujolais',
    release.id, 'release'
from public.wine_reference_releases release
join public.wine_reference_products product on product.id = release.product_id
where product.canonical_name = 'Jean-Marc Burgaud, Côte du Py, Morgon'
  and release.vintage_year = 2022;
select is((select count(*) from public.wines
    where id = 'f7000000-0000-4000-8000-000000000001'),
    1::bigint, 'Fixture links one exact 2022 release');
select is(private.drinking_window_wine_context(
    'f7000000-0000-4000-8000-000000000001') ->> 'status',
    'ready', 'Private choice requires a confirmed canonical identity');

insert into public.drinking_window_ageing_groups
    (id, version_id, scope, region_id, wine_color, group_key, definition)
select 'f7000000-0000-4000-8000-000000000002',
    current_setting('test.ageing_version')::uuid, 'region', g.region_id,
    'red', 'owner-local-early', 'Synthetic early-drinking group for testing'
from public.drinking_window_ageing_groups g
where g.id = current_setting('test.ageing_long_group')::uuid;
insert into public.drinking_window_reference_rows
    (id, version_id, scope, region_id, wine_color, vintage_year,
     ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale)
select 'f7000000-0000-4000-8000-000000000003',
    current_setting('test.ageing_version')::uuid, 'region', g.region_id,
    'red', 2022, g.id, 2023, 2024, 2028,
    'Synthetic earlier dates to verify a private local group choice'
from public.drinking_window_ageing_groups g
where g.id = 'f7000000-0000-4000-8000-000000000002';

create function pg_temp.ageing_match()
returns uuid language sql stable as $$
    with context as (
        select private.drinking_window_wine_context(
            'f7000000-0000-4000-8000-000000000001') as value
    )
    select match.reference_row_id
    from context, lateral private.drinking_window_preview_draft_match_for_wine(
        'f7000000-0000-4000-8000-000000000001',
        current_setting('test.ageing_version')::uuid,
        (context.value ->> 'producer_id')::uuid,
        (context.value ->> 'product_id')::uuid,
        (context.value ->> 'release_id')::uuid,
        (context.value ->> 'appellation_id')::uuid,
        (context.value ->> 'region_id')::uuid,
        context.value ->> 'wine_color',
        (context.value ->> 'vintage_year')::integer
    ) match;
$$;
select is(pg_temp.ageing_match(),
    private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:row'),
    'Without a local choice, reviewed shared membership wins');

select ok(not has_table_privilege('authenticated',
    'private.household_wine_ageing_choices', 'SELECT')
    and not has_function_privilege('authenticated',
    'private.drinking_window_group_eligible(uuid,uuid,uuid,boolean)', 'EXECUTE'),
    'Browser roles cannot read private choices or call the eligibility helper');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(pg_temp.ageing_rejects(
    $$select public.get_household_wine_ageing_choices('f7000000-0000-4000-8000-000000000001')$$,
    '42501'), 'Another household owner cannot inspect this wine');
reset role;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.get_household_wine_ageing_choices(
    'f7000000-0000-4000-8000-000000000001') ->> 'context_status'),
    'ready', 'The owner can inspect applicable local options');
select is(jsonb_array_length(public.get_household_wine_ageing_choices(
    'f7000000-0000-4000-8000-000000000001') -> 'versions' -> 0 -> 'groups'),
    2, 'The owner sees both groups at the same vintage and colour');
select set_config('test.ageing_fingerprint',
    public.get_household_wine_ageing_choices(
        'f7000000-0000-4000-8000-000000000001') ->> 'source_fingerprint', true);
select is(public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'select',
    'f7000000-0000-4000-8000-000000000002',
    current_setting('test.ageing_fingerprint'), null) ->> 'group_id',
    'f7000000-0000-4000-8000-000000000002',
    'Owner can explicitly select a different group only for this wine');
reset role;

select is(pg_temp.ageing_match(),
    'f7000000-0000-4000-8000-000000000003'::uuid,
    'A current private choice replaces reviewed membership for this wine');
select is((select count(*) from public.drinking_window_ageing_group_memberships
    where group_id = 'f7000000-0000-4000-8000-000000000002'),
    0::bigint, 'The private choice did not create a shared membership');

set local role authenticated;
select ok(pg_temp.ageing_rejects(format(
    'select public.manage_household_wine_ageing_choice(%L::uuid,%L::uuid,%L,%L,%L::uuid,%L,%L::uuid)',
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version'), 'region', 'select',
    current_setting('test.ageing_long_group'),
    current_setting('test.ageing_fingerprint'), null), '40001'),
    'A concurrent or stale revision cannot replace the owner choice');
select ok(pg_temp.ageing_rejects(format(
    'select public.manage_household_wine_ageing_choice(%L::uuid,%L::uuid,%L,%L,%L::uuid,%L,%L::uuid)',
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version'), 'region', 'select',
    'f7000000-0000-4000-8000-000000000099',
    current_setting('test.ageing_fingerprint'),
    (public.get_household_wine_ageing_choices(
        'f7000000-0000-4000-8000-000000000001') -> 'versions' -> 0 -> 'choices' -> 0 ->> 'choice_revision')),
    '22023'), 'An unrelated or unknown group cannot be assigned');
select set_config('test.ageing_revision',
    public.get_household_wine_ageing_choices(
        'f7000000-0000-4000-8000-000000000001') -> 'versions' -> 0 -> 'choices' -> 0 ->> 'choice_revision', true);
select is(public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'unclassified',
    null, current_setting('test.ageing_fingerprint'),
    current_setting('test.ageing_revision')::uuid) ->> 'group_id',
    null, 'Owner can explicitly leave a wine unclassified at this scope');
reset role;

select is(pg_temp.ageing_match(), null::uuid,
    'An unclassified local choice suppresses the broad shared group');
set local role authenticated;
select set_config('test.ageing_revision',
    public.get_household_wine_ageing_choices(
        'f7000000-0000-4000-8000-000000000001') -> 'versions' -> 0 -> 'choices' -> 0 ->> 'choice_revision', true);
select is(public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'clear',
    null, current_setting('test.ageing_fingerprint'),
    current_setting('test.ageing_revision')::uuid) ->> 'choice_revision',
    null, 'Owner can restore reviewed shared membership');
reset role;
select is(pg_temp.ageing_match(),
    private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:row'),
    'Clearing the local choice restores reviewed membership');

select set_config('test.choice_hash_before',
    private.drinking_window_shadow_snapshot(
        current_setting('test.ageing_version')::uuid,
        '00000000-0000-4000-8000-000000000100') ->> 'content_sha256', true);
set local role authenticated;
select public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'select',
    'f7000000-0000-4000-8000-000000000002',
    current_setting('test.ageing_fingerprint'), null);
reset role;
select isnt(private.drinking_window_shadow_snapshot(
    current_setting('test.ageing_version')::uuid,
    '00000000-0000-4000-8000-000000000100') ->> 'content_sha256',
    current_setting('test.choice_hash_before'),
    'A private choice change invalidates an earlier owner comparison');

-- Isolated matcher fixture: bypass the publication workflow only inside this
-- rollback-only test, so the active reader can be checked against both a
-- selected and an unselected household. This does not approve the draft.
select set_config('app.drinking_window_publication', 'on', true);
update public.drinking_window_reference_versions version
set status = 'active', published_at = now(),
    content_sha256 = public.drinking_window_draft_fingerprint(version.id)
where version.id = current_setting('test.ageing_version')::uuid;
insert into private.drinking_window_publications
    (version_id, content_sha256, reviewed_household_count)
select id, content_sha256, 1 from public.drinking_window_reference_versions
where id = current_setting('test.ageing_version')::uuid;
insert into private.drinking_window_household_rollouts
    (household_id, version_id, approved_report_id, enabled)
select '00000000-0000-4000-8000-000000000100',
    current_setting('test.ageing_version')::uuid, report.report_id, true
from public.record_drinking_window_shadow_report(
    current_setting('test.ageing_version')::uuid,
    '00000000-0000-4000-8000-000000000100') report;
update private.drinking_window_runtime_switch
set enabled = true, version_id = current_setting('test.ageing_version')::uuid
where singleton;
select is(private.drinking_window_active_match(
    'f7000000-0000-4000-8000-000000000001') ->> 'reference_row_id',
    'f7000000-0000-4000-8000-000000000003',
    'Opted-in active advice follows the explicit local group');

set local role authenticated;
select set_config('test.ageing_revision',
    public.get_household_wine_ageing_choices(
        'f7000000-0000-4000-8000-000000000001') -> 'versions' -> 0 -> 'choices' -> 0 ->> 'choice_revision', true);
select public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'clear',
    null, current_setting('test.ageing_fingerprint'),
    current_setting('test.ageing_revision')::uuid);
reset role;
select is(private.drinking_window_active_match(
    'f7000000-0000-4000-8000-000000000001') ->> 'reference_row_id',
    private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:row')::text,
    'Active advice returns to reviewed membership when local choice is cleared');

update public.drinking_window_reference_versions
set status = 'superseded'
where id = current_setting('test.ageing_version')::uuid;
set local role authenticated;
select is(jsonb_array_length(public.get_household_wine_ageing_choices(
    'f7000000-0000-4000-8000-000000000001') -> 'versions'),
    1, 'Owner still sees their cellar’s pinned superseded version');
select is(public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'select',
    'f7000000-0000-4000-8000-000000000002',
    current_setting('test.ageing_fingerprint'), null) ->> 'group_id',
    'f7000000-0000-4000-8000-000000000002',
    'Owner can adjust a choice on their pinned superseded version');
reset role;
select is(private.drinking_window_active_match(
    'f7000000-0000-4000-8000-000000000001') ->> 'reference_row_id',
    'f7000000-0000-4000-8000-000000000003',
    'The pinned version uses that owner choice without changing publication');
set local role authenticated;
select set_config('test.ageing_revision',
    public.get_household_wine_ageing_choices(
        'f7000000-0000-4000-8000-000000000001') -> 'versions' -> 0 -> 'choices' -> 0 ->> 'choice_revision', true);
select public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'clear',
    null, current_setting('test.ageing_fingerprint'),
    current_setting('test.ageing_revision')::uuid);
reset role;

set local role authenticated;
select public.manage_household_wine_ageing_choice(
    'f7000000-0000-4000-8000-000000000001',
    current_setting('test.ageing_version')::uuid, 'region', 'unclassified',
    null, current_setting('test.ageing_fingerprint'), null);
reset role;
select is(private.drinking_window_active_match(
    'f7000000-0000-4000-8000-000000000001') ->> 'status',
    'no_match', 'Explicitly unclassified wine has no group-specific active row');
update public.wines set cuvee = 'Côte du Py corrected'
where id = 'f7000000-0000-4000-8000-000000000001';
select is((select wine_reference_id from public.wines
    where id = 'f7000000-0000-4000-8000-000000000001'),
    null::uuid, 'Changing wine text invalidates its old canonical release link');
select is(private.drinking_window_active_match(
    'f7000000-0000-4000-8000-000000000001') ->> 'status',
    'no_match', 'The old local choice cannot restore a group after identity changes');

insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     wine_reference_id, wine_reference_type)
select 'f7000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000200',
    'Jean-Marc Burgaud', 'Côte du Py', 2022, 'red', 'Morgon', 'Beaujolais',
    release.id, 'release'
from public.wine_reference_releases release
join public.wine_reference_products product on product.id = release.product_id
where product.canonical_name = 'Jean-Marc Burgaud, Côte du Py, Morgon'
  and release.vintage_year = 2022;
select is(private.drinking_window_active_match(
    'f7000000-0000-4000-8000-000000000004') ->> 'status',
    'unpublished', 'Another household is unchanged without its own opt-in');

select * from finish();
rollback;
