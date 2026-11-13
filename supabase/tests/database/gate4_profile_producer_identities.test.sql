begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
    (select count(*)::integer from public.wine_reference_producers
     where canonical_name in (
         'Bret Brothers', 'Domaine Carrette', 'Clos Marie',
         'Mas de Daumas Gassac', 'Domaine Sainte-Barbe — Jean-Marie Chaland',
         'Domaine Jobard-Morey', 'Domaine La Soufrandière',
         'Domaine Maxime Cottenceau', 'Domaine Nicolas Maillet')),
    9, 'All nine initially missing profile producers are searchable identities'
);

insert into public.wines(id, household_id, producer, cuvee)
values ('00000000-0000-4000-8000-000000009531',
        '00000000-0000-4000-8000-000000000100', 'Chaland', 'Chazelles');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(
    (select count(*)::integer
     from jsonb_array_elements(public.search_household_reference_producers(
         '00000000-0000-4000-8000-000000000100', 'Chaland')) result
     where result ->> 'canonical_name' = 'Domaine Sainte-Barbe — Jean-Marie Chaland'),
    1, 'The cellar owner finds Chaland by the short name'
);
select is(
    (select item ->> 'canonical_name'
     from jsonb_array_elements(public.get_household_producer_preference_review(
         '00000000-0000-4000-8000-000000000100') -> 'sources') item
     where item ->> 'normalized' = 'chaland'),
    null, 'Importing a shared producer does not silently link the household'
);
reset role;

select is(
    (select count(*)::integer from public.wine_reference_products product
     join public.wine_reference_producers producer on producer.id = product.producer_id
     where producer.canonical_name = 'Domaine Sainte-Barbe — Jean-Marie Chaland'),
    0, 'Producer identity alone creates no cuvée or vintage'
);
select is(
    (select count(*)::integer from public.wine_reference_aliases alias
     join public.wine_reference_producers producer on producer.id = alias.entity_id
     where producer.canonical_name = 'Domaine Sainte-Barbe — Jean-Marie Chaland'),
    0, 'No household shorthand became a global alias'
);
select is(
    (select producer from public.wines where id = '00000000-0000-4000-8000-000000009531'),
    'Chaland', 'The owner catalogue wording is unchanged'
);

select * from finish();
rollback;
