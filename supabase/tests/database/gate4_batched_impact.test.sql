begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users (id, email)
values ('f7000000-0000-4000-8000-000000000001', 'batch-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id, display_name, profile_scopes, rationale, granted_by)
values ('f7000000-0000-4000-8000-000000000001', 'Synthetic batch curator',
        array['drinking-window'], 'Synthetic test.', 'database-test');
insert into public.wines (household_id, producer, cuvee, vintage, color)
select (select id from public.households order by id limit 1), 'Batch producer',
       'Synthetic wine ' || n::text, 2020, 'white'
from generate_series(1,85) n;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
select set_config('app.test_version',private.enrichment_seed_uuid(
    'drinking-window:burgaud-cote-du-py-2022-750:v2')::text,true);
select set_config('app.test_row',(select id::text from public.drinking_window_reference_rows
    where version_id=current_setting('app.test_version')::uuid order by id limit 1),true);
select public.record_drinking_window_reference_review(
    current_setting('app.test_version')::uuid, 'row', current_setting('app.test_row')::uuid,
    private.drinking_window_review_subject_hash(current_setting('app.test_version')::uuid,
        'row',current_setting('app.test_row')::uuid),
    'approve','Synthetic review of these exact dates and evidence.');

select ok(has_function_privilege('authenticated','public.start_drinking_window_impact_preview(uuid)','execute')
  and not has_function_privilege('anon','public.start_drinking_window_impact_preview(uuid)','execute')
  and not has_table_privilege('authenticated','private.drinking_window_impact_jobs','select'),
  'Only authenticated RPC access is exposed; cursors and household IDs stay private');
select set_config('app.test_original',public.preview_drinking_window_publication_impact(
    current_setting('app.test_version')::uuid)::text,true);
select set_config('app.test_job',public.start_drinking_window_impact_preview(
    current_setting('app.test_version')::uuid)::text,true);
select set_config('app.test_first',public.continue_drinking_window_impact_preview(
    current_setting('app.test_job')::uuid)::text,true);
select is((current_setting('app.test_first')::jsonb ->> 'wine_count')::integer,40,
  'The first request examines at most 40 wines');
select is((current_setting('app.test_first')::jsonb ->> 'completed')::boolean,false,
  'A large preview continues in a later request');
do $$ declare v_result jsonb; begin
  loop
    v_result := public.continue_drinking_window_impact_preview(current_setting('app.test_job')::uuid);
    exit when (v_result ->> 'completed')::boolean;
  end loop;
  perform set_config('app.test_batched',v_result::text,true);
end $$;
select is(current_setting('app.test_batched')::jsonb - 'completed',
  current_setting('app.test_original')::jsonb,
  'The completed aggregate matches the previous implementation exactly');
select is(public.continue_drinking_window_impact_preview(current_setting('app.test_job')::uuid),
  current_setting('app.test_batched')::jsonb,'A completed request can safely be retried');
select is((select count(*) from private.drinking_window_publication_impact_previews
  where version_id=current_setting('app.test_version')::uuid
    and curator_id=auth.uid()),2::bigint,
  'Retrying completion does not insert a second batched preview');

insert into auth.users (id,email)
values ('f7000000-0000-4000-8000-000000000002','another-curator@example.test');
insert into public.enrichment_curator_eligibilities
    (user_id,display_name,profile_scopes,rationale,granted_by)
values ('f7000000-0000-4000-8000-000000000002','Other synthetic curator',
    array['drinking-window'],'Synthetic test.','database-test');
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
select throws_ok(format('select public.continue_drinking_window_impact_preview(%L::uuid)',
  current_setting('app.test_job')),'22023','Unknown impact preview',
  'Another curator cannot read or advance a job they did not start');
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
select set_config('app.test_stale_job',public.start_drinking_window_impact_preview(
    current_setting('app.test_version')::uuid)::text,true);
update private.drinking_window_impact_jobs set created_at=now()-interval '31 minutes'
where id=current_setting('app.test_stale_job')::uuid;
select throws_ok(format('select public.continue_drinking_window_impact_preview(%L::uuid)',
  current_setting('app.test_stale_job')),'22023','Impact preview expired; start again',
  'An old unfinished job expires');
select set_config('app.test_stale_job',public.start_drinking_window_impact_preview(
    current_setting('app.test_version')::uuid)::text,true);
update public.drinking_window_reference_rows set rationale=rationale || ' Changed.'
where id=current_setting('app.test_row')::uuid;
select throws_ok(format('select public.continue_drinking_window_impact_preview(%L::uuid)',
  current_setting('app.test_stale_job')),'40001','Draft changed during impact preview',
  'Changing the draft invalidates an unfinished preview');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select throws_ok(format('select public.continue_drinking_window_impact_preview(%L::uuid)',
  current_setting('app.test_job')),'42501',null,
  'A non-curator cannot read or advance a preview');
select * from finish();
rollback;
