begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon',
    'public.get_drinking_window_reference_drafts()', 'execute'),
    'Anonymous users cannot inspect unpublished references');
select ok(not has_function_privilege('anon',
    'public.record_drinking_window_reference_review(uuid,text,uuid,text,text,text)', 'execute'),
    'Anonymous users cannot record curator decisions');
select ok(not has_table_privilege('authenticated',
    'public.drinking_window_reference_reviews', 'insert'),
    'Browser clients cannot forge review rows directly');

insert into auth.users(id, email)
values ('f9100000-0000-4000-8000-000000000001', 'reference-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f9100000-0000-4000-8000-000000000001', 'Reference Curator',
    array['place'], 'Synthetic reference curator for this test.', 'database-test');

set local role authenticated;
set local request.jwt.claim.sub = 'f9100000-0000-4000-8000-000000000001';
select is((public.get_drinking_window_reference_drafts()->>'eligible')::boolean,
    false, 'A curator for another profile type does not see reference drafts');
select is(jsonb_array_length(public.get_drinking_window_reference_drafts()->'drafts'),
    0, 'Ineligible curator receives no draft contents');
select throws_ok($test$
    select public.record_drinking_window_reference_review(
        'f9100000-0000-4000-8000-000000000002', 'row',
        'f9100000-0000-4000-8000-000000000003', repeat('a',64),
        'approve', 'This is a forbidden review attempt.')
$test$, '42501', 'An active curator grant for this profile type is required',
    'A profile curator cannot approve drinking-window references');

reset role;
update public.enrichment_curator_eligibilities
set profile_scopes = array['place', 'drinking-window']
where user_id = 'f9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.get_drinking_window_reference_drafts()->>'eligible')::boolean,
    true, 'An explicit drinking-window grant opens the draft view');
select is(jsonb_array_length(public.get_drinking_window_reference_drafts()->'drafts'),
    1, 'The first unpublished reference version is visible to the curator');
select is(jsonb_array_length(public.get_drinking_window_reference_drafts()
    ->'drafts'->0->'subjects'), 1,
    'The replacement draft asks the curator to review one exact-release row');
select is((select count(*) from jsonb_array_elements(
    public.get_drinking_window_reference_drafts()->'drafts'->0->'subjects') subject
    where subject->>'kind' = 'row'
      and (subject->'details'->>'first_trial_year')::integer = 2025
      and (subject->'details'->>'best_start_year')::integer = 2028
      and (subject->'details'->>'best_end_year')::integer = 2040
      and (subject->'details'->>'format_ml')::integer = 750),
    1::bigint, 'The three proposed dates are shown together');
select is((select count(*) from jsonb_array_elements(
    public.get_drinking_window_reference_drafts()->'drafts'->0->'subjects') subject
    where subject->>'kind' = 'row'
      and jsonb_array_length(subject->'evidence') = 2),
    1::bigint, 'The exact-release row shows both owner evidence links');

do $$
declare
    v_workspace jsonb := public.get_drinking_window_reference_drafts();
    v_subject jsonb;
begin
    perform set_config('test.reference_version',
        v_workspace->'drafts'->0->>'version_id', true);
    select value into v_subject
    from jsonb_array_elements(v_workspace->'drafts'->0->'subjects')
    where value->>'kind' = 'row';
    perform set_config('test.reference_row', v_subject->>'id', true);
    perform set_config('test.reference_row_hash', v_subject->>'hash', true);
end;
$$;

select throws_ok(format(
    'select public.record_drinking_window_reference_review(%L::uuid,%L,%L::uuid,%L,%L,%L)',
    current_setting('test.reference_version'), 'row',
    current_setting('test.reference_row'), repeat('a',64), 'approve',
    'I checked this specific 2022 window and the linked evidence.'),
    '40001', 'Reference changed; refresh before reviewing',
    'An obsolete or invented draft hash cannot be approved');
select throws_ok(format(
    'select public.record_drinking_window_reference_review(%L::uuid,%L,%L::uuid,%L,%L,%L)',
    current_setting('test.reference_version'), 'row',
    current_setting('test.reference_row'), current_setting('test.reference_row_hash'),
    'approve', 'short'),
    '22023', 'Reference review is invalid',
    'A reasoned curator decision is required');

do $$
declare
    v_workspace jsonb := public.get_drinking_window_reference_drafts();
    v_subject jsonb;
begin
    for v_subject in select value
        from jsonb_array_elements(v_workspace->'drafts'->0->'subjects')
    loop
        perform public.record_drinking_window_reference_review(
            (v_workspace->'drafts'->0->>'version_id')::uuid,
            v_subject->>'kind', (v_subject->>'id')::uuid,
            v_subject->>'hash', 'approve',
            'Synthetic curator checked this exact subject and its evidence.'
        );
    end loop;
end;
$$;
reset role;
select is((select count(*) from public.drinking_window_review_issues(
    current_setting('test.reference_version')::uuid)), 0::bigint,
    'A genuine current approval clears the exact-release review issue');
select is((select status from public.drinking_window_reference_versions
    where id = current_setting('test.reference_version')::uuid),
    'draft', 'Curator review does not publish the reference');

set local role authenticated;
select lives_ok(format(
    'select public.record_drinking_window_reference_review(%L::uuid,%L,%L::uuid,%L,%L,%L)',
    current_setting('test.reference_version'), 'row',
    current_setting('test.reference_row'), current_setting('test.reference_row_hash'),
    'disagree', 'The proposed dates need a further source check.'),
    'A curator can explicitly dispute an approved subject');
reset role;
select is((select count(*) from public.drinking_window_review_issues(
    current_setting('test.reference_version')::uuid)
    where issue_code = 'disputed_review'), 1::bigint,
    'A current disagreement blocks the reference');

update public.drinking_window_reference_rows
set rationale = rationale || ' Later edit.'
where id = current_setting('test.reference_row')::uuid;
select is((select count(*) from public.drinking_window_review_issues(
    current_setting('test.reference_version')::uuid)
    where issue_code = 'stale_review'), 1::bigint,
    'Editing a reviewed reference invalidates its old review snapshot');
set local role authenticated;
select throws_ok(format(
    'select public.record_drinking_window_reference_review(%L::uuid,%L,%L::uuid,%L,%L,%L)',
    current_setting('test.reference_version'), 'row',
    current_setting('test.reference_row'), current_setting('test.reference_row_hash'),
    'approve', 'I checked the formerly approved version of this row.'),
    '40001', 'Reference changed; refresh before reviewing',
    'A stale browser cannot approve the edited reference');

select * from finish();
rollback;
