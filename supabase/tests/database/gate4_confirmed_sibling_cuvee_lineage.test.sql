begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users(id,email) values
    ('fd130000-0000-4000-8000-000000000001','sibling-owner@example.test');
insert into public.households(id,name) values
    ('fd130000-0000-4000-8000-000000000010','Sibling cellar'),
    ('fd130000-0000-4000-8000-000000000011','Unrelated cellar');
insert into public.household_members(household_id,user_id,role) values
    ('fd130000-0000-4000-8000-000000000010',
     'fd130000-0000-4000-8000-000000000001','owner'),
    ('fd130000-0000-4000-8000-000000000011',
     'fd130000-0000-4000-8000-000000000001','owner');
insert into public.wine_reference_entities(id,entity_type) values
    ('fd130000-0000-4000-8000-000000000101','producer'),
    ('fd130000-0000-4000-8000-000000000201','product'),
    ('fd130000-0000-4000-8000-000000000202','product'),
    ('fd130000-0000-4000-8000-000000000301','release'),
    ('fd130000-0000-4000-8000-000000000302','release'),
    ('fd130000-0000-4000-8000-000000000401','package'),
    ('fd130000-0000-4000-8000-000000000402','package');
insert into public.wine_reference_producers(id,canonical_name) values
    ('fd130000-0000-4000-8000-000000000101','Synthetic Frantz Chagnoleau');
insert into public.wine_reference_products(id,producer_id,canonical_name) values
    ('fd130000-0000-4000-8000-000000000201',
     'fd130000-0000-4000-8000-000000000101','Synthetic Saint-Véran À la Côte'),
    ('fd130000-0000-4000-8000-000000000202',
     'fd130000-0000-4000-8000-000000000101','Synthetic alternate cuvée');
insert into public.wine_reference_releases(id,product_id,vintage_year) values
    ('fd130000-0000-4000-8000-000000000301',
     'fd130000-0000-4000-8000-000000000201',2019),
    ('fd130000-0000-4000-8000-000000000302',
     'fd130000-0000-4000-8000-000000000202',2018);
insert into public.wine_reference_packages(id,release_id,volume_ml) values
    ('fd130000-0000-4000-8000-000000000401',
     'fd130000-0000-4000-8000-000000000301',750),
    ('fd130000-0000-4000-8000-000000000402',
     'fd130000-0000-4000-8000-000000000302',750);
insert into public.wine_reference_household_producer_preferences(
    household_id,source_producer_normalized,source_producer_text,producer_id,decided_by
) values ('fd130000-0000-4000-8000-000000000010','chagnoleau','Chagnoleau',
    'fd130000-0000-4000-8000-000000000101','fd130000-0000-4000-8000-000000000001');
insert into public.wines(id,household_id,producer,cuvee,vintage,color,appellation,area,
    format_ml,wine_reference_id,wine_reference_type) values
    ('fd130000-0000-4000-8000-000000000501',
     'fd130000-0000-4000-8000-000000000010','Chagnoleau','A la Cote',2019,
     'white','Saint-Véran','Bourgogne',750,'fd130000-0000-4000-8000-000000000401','package'),
    ('fd130000-0000-4000-8000-000000000502',
     'fd130000-0000-4000-8000-000000000010','Chagnoleau','A la Cote',2022,
     'white','Saint-Véran','Bourgogne',750,null,null),
    ('fd130000-0000-4000-8000-000000000503',
     'fd130000-0000-4000-8000-000000000010','Chagnoleau','A la Cote',2021,
     'white','Viré-Clessé','Bourgogne',750,null,null),
    ('fd130000-0000-4000-8000-000000000504',
     'fd130000-0000-4000-8000-000000000011','Chagnoleau','A la Cote',2022,
     'white','Saint-Véran','Bourgogne',750,null,null),
    ('fd130000-0000-4000-8000-000000000505',
     'fd130000-0000-4000-8000-000000000010','Chagnoleau','A la Cote',2018,
     'white','Saint-Véran','Bourgogne',750,'fd130000-0000-4000-8000-000000000402','package');
insert into public.wine_reference_match_decisions(
    household_id,wine_id,source_fingerprint,source_snapshot,source_key,
    identifier_scheme,identifier_value,decision,reference_id,reference_type,
    candidate_snapshot,decided_by
) values (
    'fd130000-0000-4000-8000-000000000010',
    'fd130000-0000-4000-8000-000000000501','0123456789abcdef0123456789abcdef',
    '{}'::jsonb,'liv-ex-lwin','LWIN7','1234567','confirmed',
    'fd130000-0000-4000-8000-000000000401','package','{}'::jsonb,
    'fd130000-0000-4000-8000-000000000001');

select is((select lineage.product_id from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id='fd130000-0000-4000-8000-000000000502'),
    'fd130000-0000-4000-8000-000000000201'::uuid,
    'A confirmed package on the same local cuvée identifies another vintage');
select is((select lineage.release_id from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id='fd130000-0000-4000-8000-000000000502'),
    null, 'A missing 2022 shared release is not invented');
select is((select lineage.product_id from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id='fd130000-0000-4000-8000-000000000503'),
    null, 'An appellation disagreement prevents same-name inference');
select is((select count(*) from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id='fd130000-0000-4000-8000-000000000504'),
    0::bigint, 'The decision never crosses into another household');

insert into public.wine_reference_entities(id,entity_type) values
    ('fd130000-0000-4000-8000-000000000303','release');
insert into public.wine_reference_releases(id,product_id,vintage_year) values
    ('fd130000-0000-4000-8000-000000000303',
     'fd130000-0000-4000-8000-000000000201',2022);
select is((select lineage.release_id from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id='fd130000-0000-4000-8000-000000000502'),
    'fd130000-0000-4000-8000-000000000303'::uuid,
    'A subsequently curated exact release becomes available without an owner click');

insert into public.wine_reference_match_decisions(
    household_id,wine_id,source_fingerprint,source_snapshot,source_key,
    identifier_scheme,identifier_value,decision,reference_id,reference_type,
    candidate_snapshot,decided_by
) values (
    'fd130000-0000-4000-8000-000000000010',
    'fd130000-0000-4000-8000-000000000505','fedcba9876543210fedcba9876543210',
    '{}'::jsonb,'liv-ex-lwin','LWIN7','7654321','confirmed',
    'fd130000-0000-4000-8000-000000000402','package','{}'::jsonb,
    'fd130000-0000-4000-8000-000000000001');
select is((select lineage.product_id from public.wines wine,
    lateral private.drinking_window_wine_reference_lineage(wine) lineage
    where wine.id='fd130000-0000-4000-8000-000000000502'),
    null, 'Conflicting confirmed products prevent a guessed cuvée');
select is((select wine_reference_id from public.wines
    where id='fd130000-0000-4000-8000-000000000502'),
    null::uuid, 'The inferred lineage never rewrites the local wine');
select * from finish();
rollback;
