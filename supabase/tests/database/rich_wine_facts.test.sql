begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

select has_column('public', 'wines', 'country', 'Wines store country');
select has_column('public', 'wines', 'classification', 'Wines store classification');
select has_column('public', 'wines', 'vineyard', 'Wines store vineyard or site');
select has_column('public', 'wines', 'grape_composition', 'Wines store grape composition');
select has_column('public', 'wines', 'sweetness_category', 'Wines store normalized sweetness');
select has_column('public', 'wines', 'alcohol_percent', 'Wines store label alcohol');
select has_column('public', 'wines', 'certifications', 'Wines store certification labels');

select ok(
    has_function_privilege(
        'authenticated',
        'public.update_wine_facts(uuid,text,text,text,text,jsonb,text,numeric,jsonb)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.update_wine_facts(uuid,text,text,text,text,jsonb,text,numeric,jsonb)',
        'EXECUTE'
    ),
    'Only authenticated users may call the facts mutation RPC'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.get_wine_fact_suggestions(uuid)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.get_wine_fact_suggestions(uuid)',
        'EXECUTE'
    ),
    'Reviewed fact suggestions use a narrow authenticated read RPC'
);

select ok(
    not has_function_privilege(
        'authenticated',
        'private.valid_wine_grape_composition(jsonb)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'private.valid_wine_certifications(jsonb)',
        'EXECUTE'
    ),
    'Browser roles cannot call private fact validators'
);

select is(
    (
        select grape_composition
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    '[]'::jsonb,
    'Existing wines receive an empty composition without guessed grapes'
);

select is(
    (
        select certifications
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    '[]'::jsonb,
    'Existing wines receive no guessed certifications'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_wine_fact_suggestions(
        '00000000-0000-4000-8000-000000000110'
    ) ->> 'status',
    'unavailable',
    'An unlinked wine receives no invented reference suggestions'
);

select is(
    public.update_wine_facts(
        '00000000-0000-4000-8000-000000000110',
        '  France  ',
        '  Bourgogne  ',
        '  Premier   Cru ',
        ' Les   Evocelles ',
        '[
          {"name":" Pinot   Noir ","percentage":100}
        ]'::jsonb,
        'dry',
        13.5,
        '[" Organic ","HVE"]'::jsonb
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'The household owner can save rich wine facts'
);

select is(
    (
        select pg_catalog.concat_ws(
            '|',
            country,
            area,
            classification,
            vineyard,
            sweetness_category,
            alcohol_percent::text
        )
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    'France|Bourgogne|Premier Cru|Les Evocelles|dry|13.50',
    'Scalar facts are normalized and stored'
);

select is(
    (
        select grape_composition
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    '[{"name":"Pinot Noir","percentage":100}]'::jsonb,
    'Grape names and percentages are normalized'
);

select is(
    (
        select certifications
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    '["Organic","HVE"]'::jsonb,
    'Certification labels are normalized without being inferred'
);

select is(
    (
        select producer || '|' || cuvee || '|' || vintage::text
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    'Domaine Test|Cuvée Offline|2020',
    'Editing facts does not alter wine identity'
);

select is(
    (
        select count(*)
        from public.holdings
        where wine_id = '00000000-0000-4000-8000-000000000110'
    ),
    1::bigint,
    'Editing facts leaves stock attached to the same wine'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000210',
            'Italy', null, null, null, '[]'::jsonb, 'dry', 14, '[]'::jsonb
        )
    $test$,
    '42501',
    'Only household owners can edit wine facts',
    'An owner cannot edit another household wine'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000110',
            null, null, null, null,
            '[{"name":"Syrah","percentage":60},{"name":"Grenache","percentage":50}]'::jsonb,
            null, null, '[]'::jsonb
        )
    $test$,
    '22023',
    'Grape composition is invalid',
    'Known grape percentages cannot total more than 100'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000110',
            null, null, null, null,
            '[{"name":"Syrah"},{"name":"syrah"}]'::jsonb,
            null, null, '[]'::jsonb
        )
    $test$,
    '22023',
    'Grape composition is invalid',
    'Duplicate grape names are rejected'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000110',
            null, null, null, null,
            '[{"name":"Syrah","source":"guess"}]'::jsonb,
            null, null, '[]'::jsonb
        )
    $test$,
    '22023',
    'Grape composition is invalid',
    'Unexpected grape payload fields are rejected'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000110',
            null, null, null, null, '[]'::jsonb,
            'brut', null, '[]'::jsonb
        )
    $test$,
    '22023',
    'Sweetness category is invalid',
    'Free-form sweetness cannot bypass the normalized categories'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000110',
            null, null, null, null, '[]'::jsonb,
            null, 31, '[]'::jsonb
        )
    $test$,
    '22023',
    'Alcohol percentage must be greater than 0 and at most 30',
    'Impossible label alcohol is rejected'
);

select throws_ok(
    $test$
        select public.update_wine_facts(
            '00000000-0000-4000-8000-000000000110',
            null, null, null, null, '[]'::jsonb,
            null, null, '["Organic","organic"]'::jsonb
        )
    $test$,
    '22023',
    'Certifications are invalid',
    'Duplicate certification labels are rejected'
);

select throws_ok(
    $test$
        update public.wines
        set country = 'Italy'
        where id = '00000000-0000-4000-8000-000000000110'
    $test$,
    '42501',
    null,
    'Authenticated browser users cannot bypass the RPC with a direct update'
);

select is(
    public.update_wine_facts(
        '00000000-0000-4000-8000-000000000110',
        null, null, null, null, null, null, null, null
    ),
    '00000000-0000-4000-8000-000000000110'::uuid,
    'The owner can explicitly clear all optional facts'
);

select is(
    (
        select pg_catalog.jsonb_build_object(
            'country', country,
            'region', area,
            'classification', classification,
            'vineyard', vineyard,
            'grapes', grape_composition,
            'sweetness', sweetness_category,
            'alcohol', alcohol_percent,
            'certifications', certifications
        )
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    '{
      "country":null,
      "region":null,
      "classification":null,
      "vineyard":null,
      "grapes":[],
      "sweetness":null,
      "alcohol":null,
      "certifications":[]
    }'::jsonb,
    'Clearing facts restores explicit empty values without deleting the wine'
);

reset role;

update public.wines
set appellation = 'Puligny-Montrachet',
    color = 'white'
where id = '00000000-0000-4000-8000-000000000110';

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_wine_fact_suggestions(
        '00000000-0000-4000-8000-000000000110'
    ) ->> 'status',
    'available',
    'Reviewed appellation facts do not require an LWIN match'
);

select is(
    public.get_wine_fact_suggestions(
        '00000000-0000-4000-8000-000000000110'
    ) #> '{values,grape_composition}',
    '[{"name":"Chardonnay","percentage":null}]'::jsonb,
    'A white Puligny receives the reviewed typical Chardonnay suggestion'
);

select is(
    public.get_wine_fact_suggestions(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{sources,0,url}',
    'https://www.inao.gouv.fr/produit/puligny-montrachet-premier-cru-la-garenne-blanc-8100',
    'The appellation suggestion retains its official web provenance'
);

select is(
    (
        select grape_composition
        from public.wines
        where id = '00000000-0000-4000-8000-000000000110'
    ),
    '[]'::jsonb,
    'Reading a reviewed suggestion never writes it into the household wine'
);

reset role;

insert into public.wine_reference_entities (id, entity_type)
values
    ('00000000-0000-4000-8000-000000000910', 'producer'),
    ('00000000-0000-4000-8000-000000000911', 'product');

insert into public.wine_reference_producers (id, canonical_name)
values (
    '00000000-0000-4000-8000-000000000910',
    'Reviewed Domaine'
);

insert into public.wine_reference_products (
    id,
    producer_id,
    canonical_name
)
values (
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000910',
    'Reviewed Cuvée'
);

update public.wines
set wine_reference_id = '00000000-0000-4000-8000-000000000911',
    wine_reference_type = 'product'
where id = '00000000-0000-4000-8000-000000000110';

insert into public.wine_reference_match_decisions (
    household_id,
    wine_id,
    source_fingerprint,
    source_snapshot,
    source_key,
    identifier_scheme,
    identifier_value,
    decision,
    reference_id,
    reference_type,
    candidate_snapshot,
    decided_by
)
values (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000110',
    '0123456789abcdef0123456789abcdef',
    '{}'::jsonb,
    'liv-ex-lwin',
    'LWIN7',
    '1234567',
    'confirmed',
    '00000000-0000-4000-8000-000000000911',
    'product',
    '{
      "country":"France",
      "region":"Burgundy",
      "sub_region":"Côte de Nuits",
      "classification":"Premier Cru",
      "site":"Les Evocelles",
      "parcel":null
    }'::jsonb,
    '00000000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000001';

select is(
    public.get_wine_fact_suggestions(
        '00000000-0000-4000-8000-000000000110'
    ) ->> 'status',
    'available',
    'A confirmed reference exposes reviewed origin suggestions'
);

select is(
    public.get_wine_fact_suggestions(
        '00000000-0000-4000-8000-000000000110'
    ) #>> '{sources,0,identifier_value}',
    '1234567',
    'Suggestion provenance retains the confirmed LWIN7'
);

select is(
    (
        public.get_wine_fact_suggestions(
            '00000000-0000-4000-8000-000000000110'
        ) -> 'values'
    ) - 'grape_composition'::text - 'grape_note'::text,
    '{
      "country":"France",
      "region":"Burgundy",
      "subregion":"Côte de Nuits",
      "classification":"Premier Cru",
      "vineyard":"Les Evocelles"
    }'::jsonb,
    'Only reviewed origin values are suggested'
);

select is(
    pg_catalog.jsonb_array_length(
        public.get_wine_fact_suggestions(
            '00000000-0000-4000-8000-000000000110'
        ) -> 'sources'
    ),
    2,
    'Reference and reviewed web evidence remain separately attributed'
);

set local request.jwt.claim.sub =
    '00000000-0000-4000-8000-000000000002';

select throws_ok(
    $test$
        select public.get_wine_fact_suggestions(
            '00000000-0000-4000-8000-000000000110'
        )
    $test$,
    '42501',
    'Wine does not belong to this household',
    'Reviewed suggestions do not cross the household boundary'
);

reset role;

select ok(
    private.valid_wine_grape_composition(
        '[{"name":"Grenache","percentage":60},{"name":"Syrah"}]'::jsonb
    ),
    'Unknown grape percentages are allowed alongside known partial composition'
);

select ok(
    not private.valid_wine_certifications(
        '["Organic",42]'::jsonb
    ),
    'Certification values must be labels'
);

select * from finish();

rollback;
