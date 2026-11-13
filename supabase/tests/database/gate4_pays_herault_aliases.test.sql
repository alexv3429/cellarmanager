begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select is((select count(distinct a.place_id)::integer
    from public.enrichment_place_aliases a
    join public.enrichment_places p on p.id=a.place_id
    join public.enrichment_places region on region.id=p.parent_id
    where a.normalized_value in ('igp pays d herault','igp pays de l herault')
      and p.normalized_name='igp herault' and region.normalized_name='languedoc'),
    1,'Both official spelling variants identify the same Languedoc IGP');
select is((select count(*)::integer from public.enrichment_place_aliases
    where normalized_value in ('igp pays d herault','igp pays de l herault')),
    2,'Both distinct spellings are available without duplicate aliases');
select is(private.household_resolved_appellation(
    '00000000-0000-4000-8000-000000000100','Languedoc','IGP Pays d’Hérault'),
    (select id from public.enrichment_places where normalized_name='igp herault'
        and place_type='appellation'),
    'The shared IGP spelling resolves in a cellar without a local mapping');
select * from finish();
rollback;
