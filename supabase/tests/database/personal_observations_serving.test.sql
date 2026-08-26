begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table(
    'public',
    'wine_serving_overrides',
    'Serving adjustments are stored separately from shared knowledge'
);

select ok(
    (
        select relrowsecurity
        from pg_catalog.pg_class
        where oid = 'public.wine_serving_overrides'::regclass
    ),
    'Serving adjustments have RLS enabled'
);

select ok(
    has_table_privilege('authenticated', 'public.wine_serving_overrides', 'SELECT')
    and not has_table_privilege(
        'authenticated',
        'public.wine_serving_overrides',
        'INSERT, UPDATE, DELETE'
    ),
    'Browser roles can read permitted serving state but cannot write tables directly'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_publication_tables
        where pubname = 'powersync'
          and schemaname = 'public'
          and tablename in (
              'household_wine_observations',
              'wine_serving_overrides'
          )
    ),
    0::bigint,
    'Personal guidance stays outside the inventory synchronization boundary'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_wine_personal_guidance(uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.save_wine_observation(uuid,uuid,text,text,date,text,text,text,integer,integer,integer,integer,text)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.delete_wine_observation(uuid)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.set_wine_serving_override(uuid,numeric,numeric,integer,integer,text,text)',
        'EXECUTE'
    )
    and has_function_privilege(
        'authenticated',
        'public.clear_wine_serving_override(uuid)',
        'EXECUTE'
    ),
    'Authenticated members use narrow personal-guidance RPCs'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.calculate_wine_serving_guidance(text,jsonb,text,numeric,text,timestamptz)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'private.require_wine_member(uuid)',
        'EXECUTE'
    ),
    'Browser roles cannot call private serving or authorization helpers'
);

select is(
    private.calculate_wine_serving_guidance(
        'red',
        '{"body":4,"acidity":3.5,"tannin":4,"sweetness":0,"concentration":4}'::jsonb,
        'hold',
        0.8,
        'producer-era',
        '2026-08-26T08:00:00Z'
    ) #>> '{temperature_min_c}',
    '16',
    'A structured red receives a temperate serving range'
);

select is(
    private.calculate_wine_serving_guidance(
        'red',
        '{"body":4,"acidity":3.5,"tannin":4,"sweetness":0,"concentration":4}'::jsonb,
        'hold',
        0.8,
        'producer-era',
        '2026-08-26T08:00:00Z'
    ) #>> '{aeration_max_minutes}',
    '120',
    'A youthful structured red receives bounded extended aeration'
);

select ok(
    (
        select guidance #>> '{method}' = 'none'
           and guidance #>> '{aeration_max_minutes}' = '0'
        from (
            select private.calculate_wine_serving_guidance(
                'sparkling',
                '{"body":2,"acidity":4.5,"tannin":0,"sweetness":1,"concentration":2}'::jsonb,
                null,
                0.7,
                'place',
                '2026-08-26T08:00:00Z'
            ) as guidance
        ) result
    ),
    'Sparkling wine is never decanted by the derived rule'
);

select results_eq(
    $test$
        select
            color,
            private.calculate_wine_serving_guidance(
                color,
                traits,
                'ready',
                0.7,
                'place',
                '2026-08-26T08:00:00Z'
            ) #>> '{temperature_min_c}' as minimum_temperature
        from (
            values
                (
                    'fortified'::text,
                    '{"body":4,"acidity":3,"tannin":2,"sweetness":4,"concentration":4}'::jsonb
                ),
                (
                    'sweet'::text,
                    '{"body":3,"acidity":4,"tannin":0,"sweetness":5,"concentration":4}'::jsonb
                ),
                (
                    'white'::text,
                    '{"body":4,"acidity":4,"tannin":0,"sweetness":0,"concentration":4}'::jsonb
                )
        ) styles(color, traits)
        order by color
    $test$,
    $expected$
        values
            ('fortified'::text, '12'::text),
            ('sweet'::text, '8'::text),
            ('white'::text, '10'::text)
    $expected$,
    'White, sweet, and fortified styles receive distinct bounded temperatures'
);

select is(
    private.calculate_wine_serving_guidance(
        'red',
        '{"body":3,"acidity":3,"tannin":3,"sweetness":0,"concentration":3}'::jsonb,
        'priority',
        0.7,
        'place',
        '2026-08-26T08:00:00Z'
    ) #>> '{method}',
    'gentle-decant',
    'A mature priority bottle is protected from prolonged aeration'
);

select throws_ok(
    $test$
        select private.calculate_wine_serving_guidance(
            'red',
            '{"body":"strong"}'::jsonb,
            'ready',
            0.5,
            'place',
            now()
        )
    $test$,
    '22023',
    'Serving guidance requires numeric wine traits',
    'Malformed profile traits cannot become serving advice'
);

do $$
begin
    perform public.install_refined_pairing_knowledge();
end;
$$;

delete from public.wine_enrichment_projections
where wine_id = '00000000-0000-4000-8000-000000000110'
  and projection_type = 'pairing'
  and context_key = 'wine-profile';

insert into public.wine_enrichment_projections (
    household_id,
    wine_id,
    knowledge_version_id,
    projection_type,
    context_key,
    method,
    specificity,
    confidence,
    input_fingerprint,
    recommendation
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    (
        select id
        from public.enrichment_knowledge_versions
        where status = 'active'
    ),
    'pairing',
    'wine-profile',
    'curated-inference',
    'producer-era',
    0.8,
    repeat('a', 64),
    '{
        "schema_version": 1,
        "kind": "wine-profile",
        "wine_color": "red",
        "traits": {
            "body": 4,
            "acidity": 3.5,
            "tannin": 4,
            "sweetness": 0,
            "alcohol": 3,
            "freshness": 3.5,
            "savory": 3,
            "concentration": 4
        },
        "confidence_label": "high",
        "warnings": []
    }'::jsonb
);

insert into auth.users (id, email, raw_user_meta_data)
values (
    '00000000-0000-4000-8000-000000000003',
    'member-a@example.test',
    '{}'::jsonb
);

insert into public.household_members (household_id, user_id, role)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000003',
    'member'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_wine_personal_guidance(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{serving,model,method}',
    'decant',
    'A member receives serving guidance from the reviewed wine profile'
);

select is(
    jsonb_array_length(
        public.get_wine_personal_guidance(
            '00000000-0000-4000-8000-000000000110'
        ) -> 'observations'
    ),
    0,
    'A wine starts without invented household observations'
);

select is(
    jsonb_array_length(
        public.save_wine_observation(
            '00000000-0000-4000-8000-000000000110',
            null,
            'household',
            'tasting',
            current_date,
            'too-young',
            null,
            null,
            4,
            4,
            4,
            5,
            'Still closed after two hours.'
        ) -> 'observations'
    ),
    1,
    'A member can add a structured household tasting observation'
);

select is(
    public.get_wine_personal_guidance(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{observations,0,maturity_assessment}',
    'too-young',
    'Structured maturity feedback is retained with the note'
);

select is(
    public.save_wine_observation(
        '00000000-0000-4000-8000-000000000110',
        (
            select id
            from public.household_wine_observations
            where note = 'Still closed after two hours.'
        ),
        'household',
        'tasting',
        current_date,
        'youthful',
        null,
        null,
        4,
        4,
        3,
        5,
        'More expressive after two hours, but still youthful.'
    ) #>> '{observations,0,note}',
    'More expressive after two hours, but still youthful.',
    'The author can edit an existing observation without creating a duplicate'
);

select is(
    public.set_wine_serving_override(
        '00000000-0000-4000-8000-000000000110',
        14,
        16,
        30,
        45,
        'open-ahead',
        'Producer suggested a shorter opening.'
    ) #>> '{serving,override,method}',
    'open-ahead',
    'A member can save separate household serving guidance'
);

select is(
    public.get_wine_personal_guidance(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{serving,model,method}',
    'decant',
    'An owner adjustment does not rewrite the reviewed serving estimate'
);

select throws_ok(
    $test$
        select public.set_wine_serving_override(
            '00000000-0000-4000-8000-000000000110',
            18,
            14,
            0,
            30,
            'open-ahead',
            null
        )
    $test$,
    '22023',
    'Serving temperatures must form an ordered range between 0 and 30 °C',
    'Invalid serving ranges are rejected before storage'
);

select throws_ok(
    $test$
        select public.get_wine_personal_guidance(
            '00000000-0000-4000-8000-000000000210'
        )
    $test$,
    '42501',
    'Wine membership is required',
    'Another household guidance cannot be inspected'
);

select is(
    jsonb_array_length(
        public.save_wine_observation(
            '00000000-0000-4000-8000-000000000110',
            null,
            'personal',
            'producer-guidance',
            current_date,
            'youthful',
            null,
            null,
            null,
            null,
            null,
            null,
            'Producer recommended waiting another three years.'
        ) -> 'observations'
    ),
    2,
    'The author sees both household and personal observations'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000003';

select is(
    jsonb_array_length(
        public.get_wine_personal_guidance(
            '00000000-0000-4000-8000-000000000110'
        ) -> 'observations'
    ),
    1,
    'Another member sees household observations but not personal ones'
);

select throws_ok(
    format(
        'select public.save_wine_observation(%L,%L,%L,%L,current_date,%L,null,null,4,4,4,4,%L)',
        '00000000-0000-4000-8000-000000000110',
        (
            select id
            from public.household_wine_observations
            where note = 'More expressive after two hours, but still youthful.'
        ),
        'household',
        'tasting',
        'ready',
        'Member tried to edit another author note.'
    ),
    '42501',
    'Only the author can edit this observation',
    'Another member cannot edit a household-visible observation'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.clear_wine_serving_override(
        '00000000-0000-4000-8000-000000000110'
    ) #> '{serving,override}',
    'null'::jsonb,
    'Clearing an adjustment restores the reviewed estimate'
);

select is(
    jsonb_array_length(
        public.delete_wine_observation(
            (
                select id
                from public.household_wine_observations
                where recorded_by =
                    '00000000-0000-4000-8000-000000000001'
                  and visibility = 'personal'
            )
        ) -> 'observations'
    ),
    1,
    'An author can delete a personal observation without affecting household notes'
);

select throws_ok(
    $test$
        select public.save_wine_observation(
            '00000000-0000-4000-8000-000000000110',
            null,
            'household',
            'other',
            current_date + 1,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            'A future observation.'
        )
    $test$,
    '22023',
    'Observation date must be today or earlier',
    'Future observations are rejected'
);

select throws_ok(
    $test$
        insert into public.wine_serving_overrides (
            household_id,
            wine_id,
            updated_by,
            temperature_min_c,
            temperature_max_c,
            aeration_min_minutes,
            aeration_max_minutes,
            method
        )
        values (
            '00000000-0000-4000-8000-000000000100',
            '00000000-0000-4000-8000-000000000110',
            '00000000-0000-4000-8000-000000000001',
            14,
            16,
            0,
            15,
            'none'
        )
    $test$,
    '42501',
    'permission denied for table wine_serving_overrides',
    'Authenticated clients cannot bypass the serving RPC'
);

reset role;

select * from finish();

rollback;
