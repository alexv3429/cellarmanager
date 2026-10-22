begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table pilot_ids (
    version_id uuid, producer_id uuid, region_id uuid, appellation_id uuid,
    cote_product_id uuid, cote_release_id uuid,
    james_product_id uuid, james_release_id uuid,
    charmes_product_id uuid, charmes_release_id uuid
) on commit drop;

do $$
declare
    v_producer_id uuid;
    v_charmes_product_id uuid;
    v_charmes_release_id uuid;
begin
    select id into strict v_producer_id
    from public.wine_reference_producers
    where canonical_name = 'Jean-Marc Burgaud';
    v_charmes_product_id := private.ensure_hierarchy_product(
        'jean-marc-burgaud-les-charmes-test', v_producer_id,
        'Jean-Marc Burgaud, Les Charmes, Morgon'
    );
    select id into v_charmes_release_id
    from public.wine_reference_releases
    where product_id = v_charmes_product_id and vintage_year = 2022;
    if v_charmes_release_id is null then
        v_charmes_release_id := private.ensure_hierarchy_release(
            'jean-marc-burgaud-les-charmes-2022-test',
            v_charmes_product_id, 2022
        );
    end if;

    insert into pilot_ids
    select
        v.id, v_producer_id, g.region_id, m.member_place_id,
        cote_product.id, cote_release.id,
        james_product.id, james_release.id,
        v_charmes_product_id, v_charmes_release_id
    from public.drinking_window_reference_versions v
    join public.drinking_window_ageing_groups g on g.version_id = v.id
    join public.drinking_window_ageing_group_memberships m on m.group_id = g.id
    join public.wine_reference_releases cote_release on cote_release.id = m.member_release_id
    join public.wine_reference_products cote_product on cote_product.id = cote_release.product_id
    join public.wine_reference_products james_product
      on james_product.producer_id = v_producer_id
      and pg_catalog.strpos(private.normalize_wine_reference_text(james_product.canonical_name), 'james') > 0
    join public.wine_reference_releases james_release
      on james_release.product_id = james_product.id and james_release.vintage_year = 2022
    where v.version_number = 1
      and pg_catalog.strpos(private.normalize_wine_reference_text(cote_product.canonical_name), 'cote du py') > 0
      and pg_catalog.strpos(private.normalize_wine_reference_text(cote_product.canonical_name), 'james') = 0;
end;
$$;

select is((select count(*) from pilot_ids), 1::bigint,
    'First draft has one unambiguous pair of reviewed Burgaud 2022 releases');
select is((select status from public.drinking_window_reference_versions
    where id = (select version_id from pilot_ids)), 'draft',
    'The first real reference stays unpublished');
select is((select count(*) from public.drinking_window_reference_rows
    where version_id = (select version_id from pilot_ids)), 1::bigint,
    'Only one tightly eligible 2022 row is drafted');
select is((select count(*) from public.drinking_window_ageing_group_memberships
    where version_id = (select version_id from pilot_ids)), 2::bigint,
    'Only Côte du Py and James 2022 are members');
select is((select first_trial_year::text || '/' || best_start_year::text || '/' ||
    best_end_year::text from public.drinking_window_reference_rows
    where version_id = (select version_id from pilot_ids)),
    '2025/2028/2035', 'The exact owner-authored three dates are retained');

select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.cote_product_id, i.cote_release_id,
        i.appellation_id, i.region_id, 'red', 2022) result),
    'draft_match', 'Morgon Côte du Py 2022 qualifies by exact release');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.james_product_id, i.james_release_id,
        i.appellation_id, i.region_id, 'red', 2022) result),
    'draft_match', 'Morgon James 2022 qualifies by exact release');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.charmes_product_id, i.charmes_release_id,
        i.appellation_id, i.region_id, 'red', 2022) result),
    'no_match', 'Les Charmes 2022 does not inherit the longer-ageing window');
select is((select status from pilot_ids i,
    public.drinking_window_preview_draft_match(
        i.version_id, i.producer_id, i.cote_product_id, null,
        i.appellation_id, i.region_id, 'red', 2022) result),
    'no_match', 'A product name without an explicit release link is insufficient');

select is((select count(*) from pilot_ids i,
    public.drinking_window_draft_issues(i.version_id)), 0::bigint,
    'Owner evidence, provenance rights, and draft shape pass diagnostics');
select is((select count(*) from pilot_ids i,
    public.drinking_window_eligibility_issues(i.version_id)), 0::bigint,
    'The two release memberships pass place and scope eligibility');
select is((select count(*) from pilot_ids i,
    public.drinking_window_evidence_fit_issues(i.version_id)), 0::bigint,
    'Evidence scope fits the window, group, and two exact releases');
select is((select count(*) from pilot_ids i,
    public.drinking_window_review_issues(i.version_id)
    where issue_code = 'missing_current_approval'), 4::bigint,
    'Publication still requires four genuine curator decisions');

select * from finish();
rollback;
