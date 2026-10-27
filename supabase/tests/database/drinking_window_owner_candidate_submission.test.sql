begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.submit_drinking_window_candidate_for_wine(uuid,integer,integer,integer,text,text[])', 'execute'),
    'Anonymous users cannot submit shared-date candidates');
select ok(not has_function_privilege('anon',
    'public.get_my_drinking_window_candidates_for_wine(uuid)', 'execute'),
    'Anonymous users cannot read candidate status');
select ok(not has_function_privilege('anon',
    'public.get_drinking_window_review_workspace()', 'execute'),
    'Anonymous users cannot read the curator queue');
select ok(not has_table_privilege('authenticated',
    'public.drinking_window_candidates', 'insert'),
    'Browser clients cannot bypass the owner-scoped submission RPC');

insert into auth.users (id, email) values
    ('f9300000-0000-4000-8000-000000000001', 'candidate-member@example.test');
insert into public.household_members (household_id, user_id, role) values
    ('00000000-0000-4000-8000-000000000100',
     'f9300000-0000-4000-8000-000000000001', 'member');
insert into public.wine_reference_entities (id, entity_type) values
    ('f9300000-0000-4000-8000-000000000011', 'producer'),
    ('f9300000-0000-4000-8000-000000000012', 'product'),
    ('f9300000-0000-4000-8000-000000000013', 'release');
insert into public.wine_reference_producers (id, canonical_name)
values ('f9300000-0000-4000-8000-000000000011', 'Synthetic Burgaud');
insert into public.wine_reference_products (id, producer_id, canonical_name)
values ('f9300000-0000-4000-8000-000000000012',
    'f9300000-0000-4000-8000-000000000011', 'Côte du Py');
insert into public.wine_reference_releases (id, product_id, vintage_year)
values ('f9300000-0000-4000-8000-000000000013',
    'f9300000-0000-4000-8000-000000000012', 2023);
insert into public.wines (id, household_id, producer, cuvee, vintage, color,
    appellation, area, format_ml, wine_reference_id, wine_reference_type) values
    ('f9300000-0000-4000-8000-000000000021',
     '00000000-0000-4000-8000-000000000100',
     'Burgaud', 'Côte du Py', 2023, 'red', 'Morgon', 'Beaujolais', 750,
     'f9300000-0000-4000-8000-000000000013', 'release'),
    ('f9300000-0000-4000-8000-000000000022',
     '00000000-0000-4000-8000-000000000200',
     'Burgaud', 'Côte du Py', 2023, 'red', 'Morgon', 'Beaujolais', 750,
     'f9300000-0000-4000-8000-000000000013', 'release'),
    ('f9300000-0000-4000-8000-000000000023',
     '00000000-0000-4000-8000-000000000100',
     'Burgaud', 'Unknown', 2023, 'red', 'Morgon', 'Beaujolais', 750,
     null, null);

-- A long historical backlog must not hide a newer owner submission from
-- the existing 100-item curator workspace.
insert into public.drinking_window_candidates (
    id, source_sha256, source_locator, candidate_scope, source_identity,
    wine_color, vintage_year, created_at
)
select gen_random_uuid(), md5(item::text) || md5(item::text),
    'synthetic-backlog:' || item, 'region', '{"region":"Synthetic"}'::jsonb,
    'red', 2020, '2020-01-01'::timestamptz
from generate_series(1, 110) as item;

set local role authenticated;
set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000001';
select throws_ok($test$
    select public.submit_drinking_window_candidate_for_wine(
        'f9300000-0000-4000-8000-000000000021', 2026, 2029, 2040,
        'A carefully reasoned release-specific estimate.', array[]::text[])
$test$, '42501'::char(5), 'Only a current cellar owner may suggest dates for this wine',
    'A household member cannot submit a shared proposal from another role');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select throws_ok($test$
    select public.submit_drinking_window_candidate_for_wine(
        'f9300000-0000-4000-8000-000000000022', 2026, 2029, 2040,
        'A carefully reasoned release-specific estimate.', array[]::text[])
$test$, '42501'::char(5), 'Only a current cellar owner may suggest dates for this wine',
    'An owner cannot submit from another household wine');
select throws_ok($test$
    select public.submit_drinking_window_candidate_for_wine(
        'f9300000-0000-4000-8000-000000000023', 2026, 2029, 2040,
        'A carefully reasoned release-specific estimate.', array[]::text[])
$test$, '22023'::char(5), 'Confirm an exact release, vintage, color and bottle size first',
    'Unlinked wine identities cannot become exact-release candidates');
select throws_ok($test$
    select public.submit_drinking_window_candidate_for_wine(
        'f9300000-0000-4000-8000-000000000021', 2026, 2041, 2040,
        'A carefully reasoned release-specific estimate.', array[]::text[])
$test$, '22023'::char(5), 'Provide three ordered years, a reason and valid HTTPS evidence links',
    'Inverted milestones are rejected');
select throws_ok($test$
    select public.submit_drinking_window_candidate_for_wine(
        'f9300000-0000-4000-8000-000000000021', 2026, 2029, 2040,
        'A carefully reasoned release-specific estimate.', array['http://example.test'])
$test$, '22023'::char(5), 'Provide three ordered years, a reason and valid HTTPS evidence links',
    'Non-HTTPS evidence links are rejected');

create temp table submitted_candidate as
select public.submit_drinking_window_candidate_for_wine(
    'f9300000-0000-4000-8000-000000000021', 2026, 2029, 2040,
    'A carefully reasoned release-specific estimate.',
    array['https://example.test/cote-du-py-2023']) as id;
select is(public.submit_drinking_window_candidate_for_wine(
    'f9300000-0000-4000-8000-000000000021', 2026, 2029, 2040,
    'A carefully reasoned release-specific estimate.',
    array['https://example.test/cote-du-py-2023']),
    (select id from submitted_candidate), 'Retrying the same submission is idempotent');
reset role;
select is((select count(*) from public.drinking_window_candidates
    where id = (select id from submitted_candidate)), 1::bigint,
    'Exactly one inert candidate was staged');
select is((select source_identity ->> 'release_id'
    from public.drinking_window_candidates where id = (select id from submitted_candidate)),
    'f9300000-0000-4000-8000-000000000013',
    'Candidate names the confirmed canonical release');
select is((select source_identity ? 'household_id'
    from public.drinking_window_candidates where id = (select id from submitted_candidate)),
    false, 'Candidate carries no household identifier in its review payload');
set local role authenticated;
select is(jsonb_array_length(public.get_my_drinking_window_candidates_for_wine(
    'f9300000-0000-4000-8000-000000000021')), 1,
    'The contributing owner can see a pending suggestion');
select throws_ok($test$
    select public.get_my_drinking_window_candidates_for_wine(
        'f9300000-0000-4000-8000-000000000022')
$test$, '42501'::char(5), 'Only a current cellar owner may see their suggestions',
    'The owner cannot read another household candidate status');

reset role;
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9300000-0000-4000-8000-000000000001',
    'Candidate Reviewer', array['drinking-window'],
    'Synthetic curator grant for this test.', 'database-test');
set local role authenticated;
set local request.jwt.claim.sub = 'f9300000-0000-4000-8000-000000000001';
select ok((select count(*) from jsonb_array_elements(
    public.get_drinking_window_review_workspace() -> 'candidates') candidate
    where candidate ->> 'id' = (select id::text from submitted_candidate)) = 1,
    'The curator workspace prioritizes the owner suggestion over its 100-item backlog');

select * from finish();
rollback;
