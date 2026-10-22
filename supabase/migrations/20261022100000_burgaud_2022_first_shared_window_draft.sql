begin;

-- The owner's reviewed 2022 Beaujolais Cru estimate is a first, narrowly
-- eligible shared candidate, not a regional wildcard. The producer describes
-- Côte du Py and James as separate long-ageing Morgon cuvées. No household
-- wine is linked, no curator decision is fabricated, and the version remains
-- a draft until the publication and staged-rollout gates are satisfied.
-- https://jean-marc-burgaud.com/nos-vins
-- https://www.saq.com/fr/15467631
-- https://www.jamessuckling.com/tasting-notes/251774/jean-marc-burgaud-morgon-james-2022
do $$
declare
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_cote_product_id uuid;
    v_james_product_id uuid;
    v_cote_release_id uuid;
    v_james_release_id uuid;
    v_ids uuid[];
    v_version_id uuid := private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:version');
    v_group_id uuid := private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:group');
    v_row_id uuid := private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:row');
    v_cote_member_id uuid := private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:cote-member');
    v_james_member_id uuid := private.enrichment_seed_uuid('drinking-window:first-shared:burgaud-2022:james-member');
    v_source_id uuid := private.enrichment_seed_uuid('source:cellarmanager-owner-window-review-2022');
    v_policy_id uuid := private.enrichment_seed_uuid('source-policy:cellarmanager-owner-window-review-2022:v1');
    v_window_evidence_id uuid := private.enrichment_seed_uuid('evidence:burgaud-2022:owner-window');
    v_group_evidence_id uuid := private.enrichment_seed_uuid('evidence:burgaud-2022:owner-group');
    v_cote_evidence_id uuid := private.enrichment_seed_uuid('evidence:burgaud-2022:cote-membership');
    v_james_evidence_id uuid := private.enrichment_seed_uuid('evidence:burgaud-2022:james-membership');
    v_review_url text := 'https://github.com/alexv3429/cellarmanager/blob/main/docs/drinking-window-first-shared-draft.md';
begin
    if exists (select 1 from public.drinking_window_reference_versions) then
        raise exception using errcode = '23505',
            message = 'First shared drinking-window version requires an empty reference library';
    end if;

    select array_agg(id order by id) into v_ids
    from public.enrichment_places
    where canonical_name = 'Beaujolais' and place_type = 'region';
    if cardinality(v_ids) is distinct from 1 then
        raise exception using errcode = '21000',
            message = 'Beaujolais region identity needs review';
    end if;
    v_region_id := v_ids[1];

    select array_agg(id order by id) into v_ids
    from public.enrichment_places
    where canonical_name = 'Morgon' and place_type = 'appellation'
      and parent_id = v_region_id;
    if cardinality(v_ids) is distinct from 1 then
        raise exception using errcode = '21000',
            message = 'Morgon appellation identity needs review';
    end if;
    v_appellation_id := v_ids[1];

    v_producer_id := private.ensure_hierarchy_producer(
        'jean-marc-burgaud', 'Jean-Marc Burgaud'
    );
    if not exists (
        select 1 from public.wine_reference_producers
        where id = v_producer_id and canonical_name = 'Jean-Marc Burgaud'
    ) then
        raise exception using errcode = '23505',
            message = 'Burgaud producer identity needs review';
    end if;

    -- Refuse plausible alternative spellings instead of quietly creating a
    -- duplicate. The existing James product is reused when present.
    select array_agg(id order by id) into v_ids
    from public.wine_reference_products
    where producer_id = v_producer_id
      and pg_catalog.strpos(private.normalize_wine_reference_text(canonical_name), 'cote du py') > 0
      and pg_catalog.strpos(private.normalize_wine_reference_text(canonical_name), 'james') = 0;
    if cardinality(v_ids) > 1 or (
        cardinality(v_ids) = 1 and private.normalize_wine_reference_text(
            (select canonical_name from public.wine_reference_products where id = v_ids[1])
        ) <> private.normalize_wine_reference_text('Jean-Marc Burgaud, Côte du Py, Morgon')
    ) then
        raise exception using errcode = '23505',
            message = 'Burgaud Côte du Py product spelling needs review';
    end if;
    v_cote_product_id := private.ensure_hierarchy_product(
        'jean-marc-burgaud-morgon-cote-du-py', v_producer_id,
        'Jean-Marc Burgaud, Côte du Py, Morgon'
    );

    select array_agg(id order by id) into v_ids
    from public.wine_reference_products
    where producer_id = v_producer_id
      and pg_catalog.strpos(private.normalize_wine_reference_text(canonical_name), 'james') > 0;
    if cardinality(v_ids) > 1 or (
        cardinality(v_ids) = 1 and private.normalize_wine_reference_text(
            (select canonical_name from public.wine_reference_products where id = v_ids[1])
        ) <> private.normalize_wine_reference_text('Jean-Marc Burgaud, Cote du Py James, Morgon')
    ) then
        raise exception using errcode = '23505',
            message = 'Burgaud James product identity needs review';
    end if;
    v_james_product_id := private.ensure_hierarchy_product(
        'jean-marc-burgaud-morgon-cote-du-py-james', v_producer_id,
        'Jean-Marc Burgaud, Cote du Py James, Morgon'
    );

    select array_agg(id order by id) into v_ids
    from public.wine_reference_releases
    where product_id = v_cote_product_id and vintage_year = 2022;
    if cardinality(v_ids) > 1 then
        raise exception using errcode = '21000',
            message = 'Burgaud Côte du Py 2022 release is ambiguous';
    end if;
    v_cote_release_id := coalesce(v_ids[1], private.ensure_hierarchy_release(
        'jean-marc-burgaud-morgon-cote-du-py-2022', v_cote_product_id, 2022
    ));

    select array_agg(id order by id) into v_ids
    from public.wine_reference_releases
    where product_id = v_james_product_id and vintage_year = 2022;
    if cardinality(v_ids) > 1 then
        raise exception using errcode = '21000',
            message = 'Burgaud James 2022 release is ambiguous';
    end if;
    v_james_release_id := coalesce(v_ids[1], private.ensure_hierarchy_release(
        'jean-marc-burgaud-morgon-cote-du-py-james-2022', v_james_product_id, 2022
    ));

    if not exists (
        select 1 from public.wine_reference_releases
        where id = v_cote_release_id and product_id = v_cote_product_id
          and vintage_year = 2022
    ) or not exists (
        select 1 from public.wine_reference_releases
        where id = v_james_release_id and product_id = v_james_product_id
          and vintage_year = 2022
    ) then
        raise exception using errcode = '23505',
            message = 'Burgaud 2022 release seed conflicts with an existing identity';
    end if;

    if exists (
        select 1 from public.wine_reference_releases
        where id in (v_cote_release_id, v_james_release_id)
          and (release_designator is not null or base_vintage_year is not null
            or disgorged_on is not null or lot_code is not null)
    ) then
        raise exception using errcode = '23505',
            message = 'Qualified Burgaud 2022 release needs identity review';
    end if;

    insert into public.drinking_window_reference_versions (id, version_number)
    values (v_version_id, 1);

    insert into public.drinking_window_ageing_groups (
        id, version_id, scope, region_id, wine_color, group_key, definition
    ) values (
        v_group_id, v_version_id, 'region', v_region_id, 'red',
        'reviewed-long-ageing-2022-morgon',
        'Only individually reviewed long-ageing red 2022 releases in Beaujolais. This first draft includes Burgaud Côte du Py and James, not Les Charmes, all Morgon, or all Beaujolais Cru.'
    );

    insert into public.drinking_window_reference_rows (
        id, version_id, scope, region_id, wine_color, vintage_year,
        ageing_group_id, first_trial_year, best_start_year, best_end_year, rationale
    ) values (
        v_row_id, v_version_id, 'region', v_region_id, 'red', 2022,
        v_group_id, 2025, 2028, 2035,
        'Owner-authored 2022 Beaujolais long-ageing estimate: test from 2025, probable optimum 2028–2035. These are not dates published by the producer; they apply only to separately reviewed release memberships.'
    );

    insert into public.drinking_window_ageing_group_memberships (
        id, version_id, group_id, member_kind, member_place_id,
        member_release_id, first_vintage_year, last_vintage_year, rationale
    ) values
        (v_cote_member_id, v_version_id, v_group_id, 'release', v_appellation_id,
         v_cote_release_id, 2022, 2022,
         'The producer identifies Côte du Py as a wine for ageing; the owner approved this cuvée for the longer-ageing 2022 group.'),
        (v_james_member_id, v_version_id, v_group_id, 'release', v_appellation_id,
         v_james_release_id, 2022, 2022,
         'The producer identifies James as having substantial ageing potential; the owner approved this cuvée for the longer-ageing 2022 group.');

    insert into public.enrichment_sources (
        id, source_key, source_name, source_kind, homepage_url
    ) values (
        v_source_id, 'owner-reviewed-first-shared-window-2022',
        'Owner-reviewed first shared drinking-window estimate', 'owner', v_review_url
    );
    insert into public.enrichment_source_policies (
        id, source_id, policy_version, status, effective_from, terms_checked_on,
        evidence_url, display_right, normalized_storage_right,
        raw_payload_storage_right, offline_sync_right, retention_right,
        cross_household_reuse_right, attribution_text, notes
    ) values (
        v_policy_id, v_source_id, 1, 'reviewed', date '2026-10-22',
        date '2026-10-22', v_review_url, 'allowed', 'allowed',
        'prohibited', 'prohibited', 'allowed', 'allowed',
        'Owner-authored CellarManager drinking-window estimate',
        'The owner explicitly permitted sharing the three-date estimate with reviewed membership. This grants no right to copy third-party tasting notes and is not a curator publication decision.'
    );

    insert into public.enrichment_evidence (
        id, source_id, source_policy_id, source_record_id, source_record_url,
        content_mode, claim_type, scope_level, place_id, release_id,
        vintage_year, wine_color, review_status, reviewed_at
    ) values
        (v_window_evidence_id, v_source_id, v_policy_id,
         'owner-window-2022-beaujolais-long-ageing', v_review_url,
         'pointer-only', 'maturity-window', 'vintage', v_region_id, null,
         2022, 'red', 'reviewed', now()),
        (v_group_evidence_id, v_source_id, v_policy_id,
         'owner-group-2022-long-ageing-morgon', v_review_url,
         'pointer-only', 'wine-structure', 'place', v_region_id, null,
         null, 'red', 'reviewed', now()),
        (v_cote_evidence_id, v_source_id, v_policy_id,
         'owner-membership-cote-du-py-2022', v_review_url,
         'pointer-only', 'wine-structure', 'release', null, v_cote_release_id,
         null, 'red', 'reviewed', now()),
        (v_james_evidence_id, v_source_id, v_policy_id,
         'owner-membership-james-2022', v_review_url,
         'pointer-only', 'wine-structure', 'release', null, v_james_release_id,
         null, 'red', 'reviewed', now());

    insert into public.drinking_window_reference_evidence (
        version_id, reference_row_id, ageing_group_id, membership_id,
        evidence_id, claim_part
    ) values
        (v_version_id, v_row_id, null, null, v_window_evidence_id, 'first_trial'),
        (v_version_id, v_row_id, null, null, v_window_evidence_id, 'optimal_period'),
        (v_version_id, null, v_group_id, null, v_group_evidence_id, 'group_definition'),
        (v_version_id, null, null, v_cote_member_id, v_cote_evidence_id, 'membership_eligibility'),
        (v_version_id, null, null, v_james_member_id, v_james_evidence_id, 'membership_eligibility');
end;
$$;

commit;
