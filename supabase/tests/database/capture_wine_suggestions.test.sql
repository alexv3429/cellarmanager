begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.list_capture_wine_suggestion(uuid)', 'execute'), 'Anonymous users cannot read wine suggestions');
select ok(has_function_privilege('authenticated', 'public.list_capture_wine_suggestion(uuid)', 'execute'), 'Authenticated owners can read their private suggestion');
select ok(has_function_privilege('authenticated', 'public.complete_capture_wine_suggestion(uuid,text,jsonb)', 'execute'), 'Authenticated owners can save a suggestion for their own capture');
select ok(not has_function_privilege('anon', 'public.complete_capture_wine_suggestion(uuid,text,jsonb)', 'execute'), 'Anonymous users cannot save wine suggestions');
select ok(not has_table_privilege('authenticated', 'private.capture_wine_suggestions', 'select'), 'Suggestions cannot be read directly from the private table');
select ok(not has_table_privilege('service_role', 'private.capture_wine_suggestions', 'select'), 'Service workers cannot read private wine suggestions');

insert into auth.users(id, email, raw_user_meta_data)
values
    ('00000000-0000-4000-8000-000000009981', 'capture-suggestion-owner@example.test', '{}'),
    ('00000000-0000-4000-8000-000000009984', 'capture-suggestion-member@example.test', '{}');
insert into public.households(id, name)
values ('00000000-0000-4000-8000-000000009980', 'Capture suggestion test');
insert into public.household_members(household_id, user_id, role)
values
    ('00000000-0000-4000-8000-000000009980', '00000000-0000-4000-8000-000000009981', 'owner'),
    ('00000000-0000-4000-8000-000000009980', '00000000-0000-4000-8000-000000009984', 'member');

insert into private.capture_sessions(id, household_id, initiating_user_id, state, expires_at, reserved_bytes)
values
    ('00000000-0000-4000-8000-000000009983', '00000000-0000-4000-8000-000000009980', '00000000-0000-4000-8000-000000009981', 'recognized', now() + interval '1 hour', 1),
    ('00000000-0000-4000-8000-000000009985', '00000000-0000-4000-8000-000000009980', '00000000-0000-4000-8000-000000009981', 'recognized', now() + interval '1 hour', 1),
    ('00000000-0000-4000-8000-000000009982', '00000000-0000-4000-8000-000000009980', '00000000-0000-4000-8000-000000009981', 'recognized', now() - interval '1 second', 1);
insert into private.capture_ocr_results(session_id, language_code, engine_version, recognized_pages)
values
    ('00000000-0000-4000-8000-000000009983', 'fra+eng', '7.0.0', '[{"text":"JEAN-MARC BURGAUD\nMORGON CÔTE DU PY\nAPPELLATION MORGON PROTÉGÉE\n2011","confidence":0}]'::jsonb),
    ('00000000-0000-4000-8000-000000009985', 'fra+eng', '7.0.0', '[{"text":"PURPLE ROSE\n2024\nTOSCANA\nCASTELLO DI AMA","confidence":0},{"text":"PURPLE ROSE\n2024\n13,5% Vol e 750 ml\n100 ml: E=308 kJ / 74 kcal","confidence":0}]'::jsonb),
    ('00000000-0000-4000-8000-000000009982', 'fra+eng', '7.0.0', '[{"text":"Domaine Test\nCuvée Test\n2020","confidence":0}]'::jsonb);

create temporary table wine_suggestion_results(result jsonb);
grant select, insert on wine_suggestion_results to authenticated;
create temporary table cellar_write_baseline as
select (select count(*) from public.wines) as wine_count,
       (select count(*) from public.inventory_operations) as operation_count;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009981';
insert into wine_suggestion_results
select public.complete_capture_wine_suggestion(
    '00000000-0000-4000-8000-000000009983',
    'cloudflare-llama-3.3-70b-wine-label-v1',
    '{
      "producer":{"value":"JEAN-MARC BURGAUD","evidence":["JEAN-MARC BURGAUD"],"confidence":"high"},
      "cuvee":{"value":"MORGON CÔTE DU PY","evidence":["MORGON CÔTE DU PY"],"confidence":"medium"},
      "appellation":{"value":"MORGON","evidence":["APPELLATION MORGON PROTÉGÉE"],"confidence":"high"},
      "area":{"value":null,"evidence":[],"confidence":"low"},
      "color":{"value":null,"evidence":[],"confidence":"low"},
      "format_ml":{"value":null,"evidence":[],"confidence":"low"},
      "vintage":{"value":2011,"status":"year","evidence":["2011"],"confidence":"high"}
    }'::jsonb
);
select is((select result->'suggestion'->'producer'->>'value' from wine_suggestion_results), 'JEAN-MARC BURGAUD', 'Producer classification is saved as a tentative private field');
select is((select result->'suggestion'->'cuvee'->>'value' from wine_suggestion_results), 'MORGON CÔTE DU PY', 'The cuvée remains distinct from the producer');
select is((select result->'suggestion'->'vintage'->>'value' from wine_suggestion_results), '2011', 'Supported vintage evidence is retained');
select is(public.list_capture_wine_suggestion('00000000-0000-4000-8000-000000009983')->'suggestion'->'appellation'->>'value', 'MORGON', 'The owner can read the saved private suggestion');
select is(
    public.complete_capture_wine_suggestion(
        '00000000-0000-4000-8000-000000009985',
        'cloudflare-llama-3.3-70b-wine-label-v1',
        '{"producer":{"value":"CASTELLO DI AMA","evidence":["CASTELLO DI AMA"],"confidence":"high"},"cuvee":{"value":"PURPLE ROSE","evidence":["PURPLE ROSE"],"confidence":"high"},"appellation":{"value":"TOSCANA","evidence":["TOSCANA"],"confidence":"medium"},"area":{"value":null,"evidence":[],"confidence":"low"},"color":{"value":null,"evidence":[],"confidence":"low"},"format_ml":{"value":750,"evidence":["13,5% Vol e 750 ml"],"confidence":"medium"},"vintage":{"value":2024,"status":"year","evidence":["2024"],"confidence":"high"}}'::jsonb
    )->'suggestion'->'format_ml'->>'value',
    '750',
    'A printed bottle volume is saved as a numeric format rather than rejected'
);
select is(public.list_capture_wine_suggestion('00000000-0000-4000-8000-000000009985')->'suggestion'->'format_ml'->'evidence'->>0,
    '13,5% Vol e 750 ml', 'The exact second-label volume evidence remains attached');
select throws_ok(
    $$select public.complete_capture_wine_suggestion('00000000-0000-4000-8000-000000009985', 'cloudflare-llama-3.3-70b-wine-label-v1', '{"producer":{"value":"CASTELLO DI AMA","evidence":["CASTELLO DI AMA"],"confidence":"high"},"cuvee":{"value":"PURPLE ROSE","evidence":["PURPLE ROSE"],"confidence":"high"},"appellation":{"value":null,"evidence":[],"confidence":"low"},"area":{"value":null,"evidence":[],"confidence":"low"},"color":{"value":null,"evidence":[],"confidence":"low"},"format_ml":{"value":"750","evidence":["13,5% Vol e 750 ml"],"confidence":"medium"},"vintage":{"value":null,"status":"not_visible","evidence":[],"confidence":"low"}}'::jsonb)$$,
    '22023', 'Capture suggestion value is invalid', 'Bottle format strings remain invalid; only numeric millilitres are accepted'
);
select throws_ok(
    $$select public.complete_capture_wine_suggestion('00000000-0000-4000-8000-000000009983', 'cloudflare-llama-3.3-70b-wine-label-v1', '{"producer":{"value":"Invented Winery","evidence":["not in transcript"],"confidence":"high"},"cuvee":{"value":"MORGON CÔTE DU PY","evidence":["MORGON CÔTE DU PY"],"confidence":"medium"},"appellation":{"value":null,"evidence":[],"confidence":"low"},"area":{"value":null,"evidence":[],"confidence":"low"},"color":{"value":null,"evidence":[],"confidence":"low"},"format_ml":{"value":null,"evidence":[],"confidence":"low"},"vintage":{"value":null,"status":"not_visible","evidence":[],"confidence":"low"}}'::jsonb)$$,
    '22023', 'Capture suggestion evidence is not in the saved transcript', 'A quoted source line must match the exact saved OCR transcript'
);
select is(
    public.complete_capture_wine_suggestion(
        '00000000-0000-4000-8000-000000009983',
        'cloudflare-llama-3.3-70b-wine-label-v1',
        '{"producer":{"value":"Jean-Marc Burgaud","evidence":["JEAN-MARC BURGAUD"],"confidence":"high"},"cuvee":{"value":"MORGON COTE DU PY","evidence":["MORGON CÔTE DU PY"],"confidence":"high"},"appellation":{"value":null,"evidence":[],"confidence":"low"},"area":{"value":null,"evidence":[],"confidence":"low"},"color":{"value":null,"evidence":[],"confidence":"low"},"format_ml":{"value":null,"evidence":[],"confidence":"low"},"vintage":{"value":null,"status":"not_visible","evidence":[],"confidence":"low"}}'::jsonb
    )->'suggestion'->'producer'->>'value',
    'JEAN-MARC BURGAUD',
    'Concurrent or duplicate completion returns the first persisted result'
);
reset role;
select is(
    (select wine_count from cellar_write_baseline),
    (select count(*) from public.wines),
    'Label suggestion never creates or updates wine catalogue rows'
);
select is(
    (select operation_count from cellar_write_baseline),
    (select count(*) from public.inventory_operations),
    'Label suggestion never creates inventory operations'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009984';
select throws_ok(
    $$select public.list_capture_wine_suggestion('00000000-0000-4000-8000-000000009983')$$,
    '42501', 'Capture is not available to this account', 'A household member cannot read the Owner suggestion'
);
select throws_ok(
    $$select public.complete_capture_wine_suggestion('00000000-0000-4000-8000-000000009983', 'cloudflare-llama-3.3-70b-wine-label-v1', '{}'::jsonb)$$,
    '42501', 'Capture is not available to this account', 'A household member cannot create or overwrite the Owner suggestion'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009981';
select throws_ok(
    $$select public.list_capture_wine_suggestion('00000000-0000-4000-8000-000000009982')$$,
    '55000', 'Capture suggestion is not available', 'Expired text cannot be read through the suggestion API'
);
reset role;

select * from finish();
rollback;
