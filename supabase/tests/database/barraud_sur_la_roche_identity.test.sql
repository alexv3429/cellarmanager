begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select is(
    (select count(*)::int from public.wine_reference_producers
     where canonical_name = 'Daniel Barraud'),
    1, 'Daniel Barraud has one shared canonical producer identity'
);
select is(
    (select count(*)::int from public.wine_reference_products product
     join public.wine_reference_producers producer on producer.id = product.producer_id
     where producer.canonical_name = 'Daniel Barraud'
       and product.canonical_name = 'Pouilly-Fuissé Premier Cru Sur la Roche'),
    1, 'The exact Sur la Roche Premier Cru product has one shared identity'
);
select is(
    (select count(*)::int from public.wine_reference_releases release
     join public.wine_reference_products product on product.id = release.product_id
     join public.wine_reference_producers producer on producer.id = product.producer_id
     where producer.canonical_name = 'Daniel Barraud'
       and product.canonical_name = 'Pouilly-Fuissé Premier Cru Sur la Roche'
       and release.vintage_year = 2023
       and release.release_designator is null
       and release.base_vintage_year is null
       and release.disgorged_on is null
       and release.lot_code is null),
    1, 'The reviewed 2023 release is a single unqualified vintage identity'
);
select is(
    (select count(*)::int from public.wine_reference_products product
     join public.wine_reference_producers producer on producer.id = product.producer_id
     where producer.canonical_name = 'Daniel Barraud'
       and product.canonical_name = 'Pouilly-Fuissé Premier Cru Sur la Roche'
       and exists (select 1 from public.wine_reference_entities entity
                   where entity.id = product.id and entity.entity_type = 'product')),
    1, 'The product has a typed reference root'
);
select is(
    (select count(*)::int from public.wine_reference_releases release
     join public.wine_reference_products product on product.id = release.product_id
     where product.canonical_name = 'Pouilly-Fuissé Premier Cru Sur la Roche'
       and release.vintage_year = 2023
       and exists (select 1 from public.wine_reference_entities entity
                   where entity.id = release.id and entity.entity_type = 'release')),
    1, 'The release has a typed reference root'
);
select is(
    private.ensure_hierarchy_producer('daniel-barraud', 'Daniel Barraud'),
    (select id from public.wine_reference_producers where canonical_name = 'Daniel Barraud'),
    'Replaying the producer seed reuses the identity'
);
select is(
    private.ensure_hierarchy_product(
      'daniel-barraud-pouilly-fuisse-premier-cru-sur-la-roche',
      (select id from public.wine_reference_producers where canonical_name = 'Daniel Barraud'),
      'Pouilly-Fuissé Premier Cru Sur la Roche'
    ),
    (select product.id from public.wine_reference_products product
     join public.wine_reference_producers producer on producer.id = product.producer_id
     where producer.canonical_name = 'Daniel Barraud'
       and product.canonical_name = 'Pouilly-Fuissé Premier Cru Sur la Roche'),
    'Replaying the product seed reuses the identity'
);
select is(
    (select count(*)::int from public.wine_reference_household_producer_preferences preference
     join public.wine_reference_producers producer on producer.id = preference.producer_id
     where producer.canonical_name = 'Daniel Barraud'),
    0, 'The identity seed does not make a household interpretation'
);
select is(
    (select count(*)::int from public.wine_reference_aliases alias
     join public.wine_reference_producers producer on producer.id = alias.entity_id
     where producer.canonical_name = 'Daniel Barraud'
       and alias.entity_type = 'producer'
       and alias.normalized_value = 'barraud'),
    0, 'The surname was not promoted to a global alias'
);

select * from finish();
rollback;
