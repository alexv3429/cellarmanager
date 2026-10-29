begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.gate1_rejects(command text, expected_state text)
returns boolean language plpgsql as $$
begin
    execute command;
    return false;
exception when others then
    return sqlstate = expected_state;
end;
$$;

select ok(not has_table_privilege('authenticated',
    'private.household_producer_window_rules', 'SELECT')
    and not has_function_privilege('anon',
        'public.set_household_producer_window_rule(uuid,text,integer,integer,integer,text)',
        'EXECUTE'),
    'Private producer rules are not a browser-readable shared table');

create temp table gate1_ids as
select v.id version_id, r.id row_id, r.producer_id, r.product_id,
    r.release_id, r.appellation_id, r.region_id
from public.drinking_window_reference_versions v
join public.drinking_window_reference_rows r on r.version_id = v.id
where v.id = private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2');

insert into auth.users(id, email)
values ('fc100000-0000-4000-8000-000000000003', 'gate1-member@example.test');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100',
    'fc100000-0000-4000-8000-000000000003', 'member');

update public.wines set producer = 'Jean-Marc Burgaud', cuvee = 'Côte du Py',
    vintage = 2022, color = 'red', area = 'Beaujolais', appellation = 'Morgon',
    format_ml = 750
where id = '00000000-0000-4000-8000-000000000110';
update public.wines set wine_reference_type = 'release',
    wine_reference_id = (select release_id from gate1_ids)
where id = '00000000-0000-4000-8000-000000000110';
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     format_ml, wine_reference_id, wine_reference_type)
select 'fc100000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000100', 'Jean-Marc Burgaud',
    'James', 2022, 'red', 'Morgon', 'Beaujolais', 750, release.id, 'release'
from public.wine_reference_releases release
join public.wine_reference_products product on product.id = release.product_id
where product.producer_id = (select producer_id from gate1_ids)
  and pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name),
      'james') > 0 and release.vintage_year = 2022
limit 1;
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     format_ml, wine_reference_id, wine_reference_type)
select 'fc100000-0000-4000-8000-000000000112',
    '00000000-0000-4000-8000-000000000200', 'Jean-Marc Burgaud',
    'Côte du Py', 2022, 'red', 'Morgon', 'Beaujolais', 750,
    release_id, 'release' from gate1_ids;
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     format_ml, wine_reference_id, wine_reference_type)
select 'fc100000-0000-4000-8000-000000000113',
    '00000000-0000-4000-8000-000000000100', 'Jean-Marc Burgaud',
    'Côte du Py', 2022, 'red', 'Morgon', 'Beaujolais', 1500,
    release_id, 'release' from gate1_ids;
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     format_ml, wine_reference_id, wine_reference_type)
select 'fc100000-0000-4000-8000-000000000114',
    '00000000-0000-4000-8000-000000000100', 'Jean-Marc Burgaud',
    'Côte du Py', 2023, 'red', 'Morgon', 'Beaujolais', 750,
    product_id, 'product' from gate1_ids;
insert into public.wines
    (id, household_id, producer, cuvee, vintage, color, appellation, area,
     format_ml, wine_reference_id, wine_reference_type)
select 'fc100000-0000-4000-8000-000000000115',
    '00000000-0000-4000-8000-000000000100', 'Jean-Marc Burgaud',
    'Côte du Py', 2022, 'white', 'Morgon', 'Beaujolais', 750,
    release_id, 'release' from gate1_ids;
select is((select count(*) from public.wines where id in
    ('fc100000-0000-4000-8000-000000000111',
     'fc100000-0000-4000-8000-000000000112',
     'fc100000-0000-4000-8000-000000000113',
     'fc100000-0000-4000-8000-000000000114',
     'fc100000-0000-4000-8000-000000000115')), 5::bigint,
    'The fixture includes another cuvée, household, size, vintage and colour');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select ok(pg_temp.gate1_rejects($q$select public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'product',
    2025, 2028, 2040, 'Other household must not edit')$q$, '42501'),
    'An owner cannot set dates in another cellar');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select ok(pg_temp.gate1_rejects($q$select public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'product',
    2025, 2028, 2040, '')$q$, '22023'),
    'A cellar rule needs an explicit reason');
select ok(pg_temp.gate1_rejects($q$select public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'product',
    2025, 2040, 2028, 'Invalid order')$q$, '22023'),
    'A cellar rule cannot mix unordered dates');
select set_config('test.gate1_product_rule', (public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'product',
    2026, 2030, 2041, 'My cuvée timing') ->> 'rule_id'), true);
select ok(current_setting('test.gate1_product_rule') <> '',
    'Owner sets an explicit cuvée/vintage rule');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'cellar_producer',
    'Cellar producer dates work before any shared publication');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{producer_rules,selected,best_end_year}', '2041',
    'All three cellar dates come from the selected private record');
set local request.jwt.claim.sub = 'fc100000-0000-4000-8000-000000000003';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'cellar_producer',
    'The owner’s producer rule applies to another member of the cellar');
select ok(pg_temp.gate1_rejects($q$select public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'product',
    2025, 2028, 2040, 'Member edit is forbidden')$q$, '42501'),
    'A cellar member cannot alter the owner’s producer rule');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.get_wine_maturity('fc100000-0000-4000-8000-000000000111')
    #>> '{producer_rules,selected,id}', null::text,
    'James does not silently inherit a Côte du Py cuvée rule');
select is(public.get_wine_maturity('fc100000-0000-4000-8000-000000000114')
    #>> '{producer_rules,selected,id}', null::text,
    'A 2022 cellar rule cannot silently cover the 2023 vintage');
select is(public.get_wine_maturity('fc100000-0000-4000-8000-000000000115')
    #>> '{producer_rules,selected,id}', null::text,
    'A red cellar rule cannot silently cover a white wine');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(public.get_wine_maturity('fc100000-0000-4000-8000-000000000112')
    #>> '{producer_rules,selected,id}', null::text,
    'Another household cannot inherit the private rule');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select set_config('test.gate1_app_rule', (public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'producer_appellation',
    2025, 2029, 2038, 'All Burgaud Morgon here') ->> 'rule_id'), true);
select ok(current_setting('test.gate1_app_rule') <> '',
    'Owner explicitly chooses a broader appellation scope');
select is(public.get_wine_maturity('fc100000-0000-4000-8000-000000000111')
    #>> '{producer_rules,selected,scope}', 'producer_appellation',
    'James gets only the expressly selected appellation rule');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{producer_rules,selected,scope}', 'product',
    'The more specific cellar rule wins without mixing dates');
select set_config('test.gate1_region_rule', (public.set_household_producer_window_rule(
    '00000000-0000-4000-8000-000000000110', 'producer_region',
    2024, 2027, 2035, 'All Burgaud Beaujolais here') ->> 'rule_id'), true);
select ok(current_setting('test.gate1_region_rule') <> '',
    'Owner may also state an explicit regional producer scope');
select is(public.get_wine_maturity('fc100000-0000-4000-8000-000000000111')
    #>> '{producer_rules,selected,scope}', 'producer_appellation',
    'Appellation rule outranks the broader producer-region rule');
select is(public.set_member_maturity_calibration(2) ->> 'year_shift', '2',
    'The account can retain a personal preference');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{calibration,active}', 'false',
    'Personal timing is not added to explicit cellar producer dates');
select is((select item ->> 'effective_source' from jsonb_array_elements(
    public.get_household_maturity_overview(
        '00000000-0000-4000-8000-000000000100')) item
    where item ->> 'wine_id' = '00000000-0000-4000-8000-000000000110'),
    'cellar_producer', 'Catalogue selection agrees with wine detail');
reset role;

-- A synthetic publication in this rollback-only suite tests reader selection,
-- not curator approval or actual live rollout.
select set_config('app.drinking_window_publication', 'on', true);
update public.drinking_window_reference_versions version
set status = 'active', published_at = now(),
    content_sha256 = public.drinking_window_draft_fingerprint(version.id)
where version.id = (select version_id from gate1_ids);
insert into private.drinking_window_publications
    (version_id, content_sha256, reviewed_household_count)
select id, content_sha256, 1 from public.drinking_window_reference_versions
where id = (select version_id from gate1_ids);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into private.drinking_window_household_rollouts
    (household_id, version_id, approved_report_id, enabled)
select '00000000-0000-4000-8000-000000000100',
    (select version_id from gate1_ids), report.report_id, true
from public.record_drinking_window_shadow_report(
    (select version_id from gate1_ids),
    '00000000-0000-4000-8000-000000000100') report;
update private.drinking_window_runtime_switch
set enabled = true, version_id = (select version_id from gate1_ids)
where singleton;
select is(private.drinking_window_active_match(
    '00000000-0000-4000-8000-000000000110') ->> 'reference_row_id',
    (select row_id::text from gate1_ids),
    '750 ml bottle receives the exact size-specific release');
select is(private.drinking_window_active_match(
    'fc100000-0000-4000-8000-000000000113') ->> 'status', 'no_match',
    'The 750 ml exact release is not applied to a 1500 ml bottle');

set local role authenticated;
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'cellar_producer',
    'Cellar producer rule stays ahead of the published exact release');
select is(public.clear_household_producer_window_rule(
    current_setting('test.gate1_product_rule')::uuid), true,
    'Owner removes the cuvée rule');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{producer_rules,selected,scope}', 'producer_appellation',
    'Removing the cuvée rule restores the next cellar rule');
select is(public.clear_household_producer_window_rule(
    current_setting('test.gate1_app_rule')::uuid), true,
    'Owner removes the appellation rule');
select is(public.clear_household_producer_window_rule(
    current_setting('test.gate1_region_rule')::uuid), true,
    'Owner removes the regional producer rule');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    ->> 'effective_source', 'reviewed_reference',
    'Removing private producer rules reveals the published exact release');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{reference,first_trial_year}', '2025',
    'The selected reference preserves its unshifted base date');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{reference,effective_first_trial_year}', '2027',
    'The account sees the first reviewed date shifted by two years');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{reference,effective_best_end_year}', '2042',
    'All three reviewed years shift together without mutating the reference');
set local request.jwt.claim.sub = 'fc100000-0000-4000-8000-000000000003';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{reference,effective_first_trial_year}', '2025',
    'The owner’s personal offset does not shift another member’s reference');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{calibration,active}', 'true',
    'Personal timing is active for a reviewed reference');
select is((select item ->> 'first_trial_year' from jsonb_array_elements(
    public.get_household_maturity_overview(
        '00000000-0000-4000-8000-000000000100')) item
    where item ->> 'wine_id' = '00000000-0000-4000-8000-000000000110'),
    '2027', 'Catalogue displays the same personalized reviewed year');
select is(public.set_wine_maturity_override(
    '00000000-0000-4000-8000-000000000110',
    2028, 2031, 2043, null, null, 'My exact wine dates') ->> 'effective_source',
    'manual', 'Wine-specific manual dates outrank reviewed dates');
select is(public.get_wine_maturity('00000000-0000-4000-8000-000000000110')
    #>> '{calibration,active}', 'false',
    'Personal timing is not applied a second time to manual dates');
select is(public.clear_wine_maturity_override(
    '00000000-0000-4000-8000-000000000110') ->> 'effective_source',
    'reviewed_reference', 'Clearing manual dates restores reviewed advice');
reset role;

select * from finish();
rollback;
