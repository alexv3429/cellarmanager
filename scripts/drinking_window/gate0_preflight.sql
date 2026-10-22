-- Gate 0, aggregate-only preflight for the linked project. No household rows
-- or credentials are returned. Run as an authorized operator before applying
-- the pending migrations. A nonzero version count blocks the first Burgaud
-- draft seed. Unexpected identity counts require review, not automatic repair.
begin transaction read only;

select
    (select count(*) from public.drinking_window_reference_versions)
        as reference_version_count,
    (select count(*) from public.enrichment_places
     where canonical_name = 'Beaujolais' and place_type = 'region')
        as beaujolais_region_count,
    (select count(*) from public.enrichment_places
     where canonical_name = 'Morgon' and place_type = 'appellation')
        as morgon_appellation_count,
    (select count(*) from public.wine_reference_producers
     where canonical_name = 'Jean-Marc Burgaud')
        as burgaud_producer_count,
    (select count(*) from public.wine_reference_producers
     where canonical_name = 'Daniel Barraud')
        as barraud_producer_count;

with expected(name) as (values
    ('Ghislaine Barthod'),
    ('Michel Bouzereau & Fils'),
    ('Jacques Carillon'),
    ('Domaine Castagnier'),
    ('Bruno Clavelier'),
    ('Domaine de Montcalmès')
)
select expected.name as intended_producer,
       count(producer.id) as existing_exact_name_count
from expected
left join public.wine_reference_producers producer
  on private.normalize_wine_reference_text(producer.canonical_name) =
     private.normalize_wine_reference_text(expected.name)
group by expected.name
order by expected.name;

commit;
