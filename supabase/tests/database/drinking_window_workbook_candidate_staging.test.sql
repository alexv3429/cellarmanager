begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.workbook_candidate(
    p_locator text,
    p_hash text default repeat('a', 64),
    p_status text default 'staged'
) returns jsonb language sql as $$
    select jsonb_build_object(
        'source_sha256', p_hash,
        'source_locator', p_locator,
        'candidate_scope', case when p_status = 'staged' then 'region' else 'quarantine' end,
        'source_identity', jsonb_build_object(
            'region', 'Synthetic region', 'color', 'blanc',
            'historical_bin', 'standard',
            'source_cells', jsonb_build_object(
                'region', 'Millesimes!A3', 'color', 'Millesimes!C3',
                'vintage', 'Millesimes!D3',
                'best_start_offset', 'Millesimes!L3',
                'best_end_offset', 'Millesimes!M3'
            )
        ),
        'wine_color', 'white', 'vintage_year', 2022,
        'first_trial_year', null,
        'best_start_year', case when p_status = 'staged' then 2025 end,
        'best_end_year', case when p_status = 'staged' then 2030 end,
        'review_status', p_status,
        'review_reason', case when p_status = 'needs-review' then 'incomplete_pair' end
    );
$$;

select has_column('public', 'drinking_window_candidates', 'review_reason',
    'Quarantine reason survives database staging');
select ok(
    has_function_privilege('service_role',
        'public.drinking_window_stage_workbook_candidates(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated',
        'public.drinking_window_stage_workbook_candidates(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon',
        'public.drinking_window_stage_workbook_candidates(jsonb)', 'EXECUTE'),
    'Only service role may invoke workbook staging'
);
select is(
    (select inserted_count from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Millesimes!L3:M3')))),
    1, 'Complete optimum pair is staged once'
);
select is(
    (select unchanged_count from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Millesimes!L3:M3')))),
    1, 'Exact replay is idempotent'
);
select is(
    (select inserted_count from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Millesimes!L4:M4', repeat('a', 64), 'needs-review')))),
    1, 'Incomplete pair remains quarantined'
);
select is(
    (select review_reason from public.drinking_window_candidates
     where source_locator = 'Millesimes!L4:M4'),
    'incomplete_pair', 'Review reason is retained'
);
select throws_ok(
    $test$select * from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Cave!L3:M3')))$test$,
    '22023', 'Candidate source hash or reference-sheet locator is invalid',
    'Private cellar sheet cannot be staged'
);
select throws_ok(
    $test$select * from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Millesimes!L5:M5') ||
            '{"bottle_count": 12}'::jsonb))$test$,
    '22023', 'Only workbook candidate fields are accepted',
    'Household fields cannot be staged'
);
select throws_ok(
    $test$select * from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Millesimes!L6:M6') ||
            '{"first_trial_year": 2024}'::jsonb))$test$,
    '22023', 'Workbook candidates do not supply a first-trial year',
    'The absent first milestone cannot be fabricated during import'
);
select throws_ok(
    $test$select * from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(
            pg_temp.workbook_candidate('Millesimes!L7:M7'),
            pg_temp.workbook_candidate('Millesimes!L8:M8', repeat('b', 64))
        ))$test$,
    '22023', 'One batch must come from one workbook hash',
    'Mixed source snapshots are refused atomically'
);
select is(
    (select count(*) from public.drinking_window_candidates
     where source_locator = 'Millesimes!L7:M7'),
    0::bigint, 'A failed batch writes no partial candidate'
);
select throws_ok(
    $test$select * from public.drinking_window_stage_workbook_candidates(
        jsonb_build_array(pg_temp.workbook_candidate('Millesimes!L3:M3') ||
            '{"best_end_year": 2031}'::jsonb))$test$,
    '23505', 'Existing candidate differs; review it instead of overwriting',
    'Re-import never overwrites prior source or curator work'
);

select * from finish();
rollback;
