begin;

-- LWIN identifies a wine but does not contain every wine fact. Reviewed
-- appellation evidence fills that gap without pretending that a permitted or
-- typical grape is an exact bottle composition. The evidence remains shared,
-- sourced, and reviewable; household facts are still changed only by the
-- owner's explicit save action.
insert into public.enrichment_places (
    id,
    parent_id,
    place_type,
    canonical_name,
    country_code
)
values
    (
        private.enrichment_seed_uuid('place:bourgogne'),
        null,
        'region',
        'Bourgogne',
        'FR'
    ),
    (
        private.enrichment_seed_uuid('place:puligny-montrachet'),
        private.enrichment_seed_uuid('place:bourgogne'),
        'appellation',
        'Puligny-Montrachet',
        'FR'
    ),
    (
        private.enrichment_seed_uuid('place:puligny-premier-cru'),
        private.enrichment_seed_uuid('place:puligny-montrachet'),
        'classification',
        'Puligny-Montrachet Premier Cru',
        'FR'
    )
on conflict (id) do nothing;

insert into public.enrichment_place_aliases (place_id, alias_value)
values
    (private.enrichment_seed_uuid('place:bourgogne'), 'Bourgogne'),
    (private.enrichment_seed_uuid('place:bourgogne'), 'Burgundy'),
    (private.enrichment_seed_uuid('place:puligny-montrachet'), 'Puligny'),
    (private.enrichment_seed_uuid('place:puligny-montrachet'), 'Puligny-Montrachet'),
    (private.enrichment_seed_uuid('place:puligny-montrachet'), 'Puligny Montrachet'),
    (private.enrichment_seed_uuid('place:puligny-premier-cru'), 'Puligny 1C'),
    (private.enrichment_seed_uuid('place:puligny-premier-cru'), 'Puligny-Montrachet 1C'),
    (private.enrichment_seed_uuid('place:puligny-premier-cru'), 'Puligny Montrachet 1C'),
    (private.enrichment_seed_uuid('place:puligny-premier-cru'), 'Puligny-Montrachet 1er Cru'),
    (private.enrichment_seed_uuid('place:puligny-premier-cru'), 'Puligny-Montrachet Premier Cru')
on conflict (normalized_value) do nothing;

insert into public.enrichment_sources (
    id,
    source_key,
    source_name,
    source_kind,
    homepage_url
)
values (
    private.enrichment_seed_uuid('source:bivb-burgundy-grapes'),
    'bivb-burgundy-grapes',
    'Reviewed Puligny appellation material (BIVB/INAO)',
    'regulatory',
    'https://www.bourgogne-wines.com/wine-and-terroir/our-grape-varietals-our-colors/pinot-noir-and-chardonnay-the-bourgogne-region-s-two-noble-grape-varietals%2C2475%2C9265.html'
)
on conflict (id) do nothing;

insert into public.enrichment_source_policies (
    id,
    source_id,
    policy_version,
    status,
    effective_from,
    terms_checked_on,
    evidence_url,
    display_right,
    normalized_storage_right,
    raw_payload_storage_right,
    offline_sync_right,
    retention_right,
    cross_household_reuse_right,
    attribution_text,
    notes
)
values (
    private.enrichment_seed_uuid('policy:bivb-burgundy-grapes:v1'),
    private.enrichment_seed_uuid('source:bivb-burgundy-grapes'),
    1,
    'reviewed',
    '2026-08-26',
    '2026-08-26',
    'https://www.bourgogne-wines.com/wine-and-terroir/our-grape-varietals-our-colors/pinot-noir-and-chardonnay-the-bourgogne-region-s-two-noble-grape-varietals%2C2475%2C9265.html',
    'allowed',
    'allowed',
    'prohibited',
    'allowed',
    'allowed',
    'allowed',
    'Bourgogne Wine Board (BIVB) and INAO',
    'Only a short reviewed normalized grape suggestion is stored. No source page or provider payload is copied.'
)
on conflict (id) do nothing;

insert into public.enrichment_evidence (
    id,
    source_id,
    source_policy_id,
    source_record_id,
    source_record_url,
    content_mode,
    claim_type,
    scope_level,
    place_id,
    wine_color,
    claim_value,
    review_status,
    reviewed_at,
    source_published_on,
    retrieved_at
)
values
    (
        private.enrichment_seed_uuid('evidence:puligny-montrachet-white-grapes:v1'),
        private.enrichment_seed_uuid('source:bivb-burgundy-grapes'),
        private.enrichment_seed_uuid('policy:bivb-burgundy-grapes:v1'),
        'puligny-montrachet-white-grapes-v1',
        'https://www.inao.gouv.fr/produit/puligny-montrachet-premier-cru-la-garenne-blanc-8100',
        'normalized-claim',
        'legal-definition',
        'place',
        private.enrichment_seed_uuid('place:puligny-montrachet'),
        'white',
        '{
          "grape_composition":[{"name":"Chardonnay","percentage":null}],
          "basis":"reviewed-typical",
          "permitted_grapes":["Chardonnay","Pinot Blanc"],
          "note":"Chardonnay is the typical suggestion for a white Puligny-Montrachet. The INAO specification also permits Pinot Blanc, so confirm the producer or label before saving an exact composition."
        }'::jsonb,
        'reviewed',
        '2026-08-26T18:00:00Z',
        null,
        '2026-08-26T18:00:00Z'
    ),
    (
        private.enrichment_seed_uuid('evidence:puligny-montrachet-premier-white-grapes:v1'),
        private.enrichment_seed_uuid('source:bivb-burgundy-grapes'),
        private.enrichment_seed_uuid('policy:bivb-burgundy-grapes:v1'),
        'puligny-montrachet-premier-white-grapes-v1',
        'https://www.inao.gouv.fr/produit/puligny-montrachet-premier-cru-la-garenne-blanc-8100',
        'normalized-claim',
        'legal-definition',
        'place',
        private.enrichment_seed_uuid('place:puligny-premier-cru'),
        'white',
        '{
          "grape_composition":[{"name":"Chardonnay","percentage":null}],
          "basis":"reviewed-typical",
          "permitted_grapes":["Chardonnay","Pinot Blanc"],
          "note":"Chardonnay is the typical suggestion for a white Puligny-Montrachet Premier Cru. The INAO specification also permits Pinot Blanc, so confirm the producer or label before saving an exact composition."
        }'::jsonb,
        'reviewed',
        '2026-08-26T18:00:00Z',
        null,
        '2026-08-26T18:00:00Z'
    )
on conflict (id) do nothing;

create or replace function public.get_wine_fact_suggestions(
    p_wine_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_decision public.wine_reference_match_decisions%rowtype;
    v_country text;
    v_region text;
    v_subregion text;
    v_classification text;
    v_vineyard text;
    v_appellation text;
    v_place_id uuid;
    v_fact_claim jsonb;
    v_fact_source_name text;
    v_fact_source_url text;
    v_fact_reviewed_at timestamptz;
    v_grapes jsonb := '[]'::jsonb;
    v_grape_note text;
    v_sources jsonb := '[]'::jsonb;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select wine.*
    into v_wine
    from public.wines wine
    where wine.id = p_wine_id;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Wine was not found';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = v_wine.household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Wine does not belong to this household';
    end if;

    if v_wine.wine_reference_id is not null then
        select decision.*
        into v_decision
        from public.wine_reference_match_decisions decision
        where decision.household_id = v_wine.household_id
          and decision.wine_id = v_wine.id
          and decision.decision = 'confirmed'
          and decision.reference_id = v_wine.wine_reference_id
          and decision.reference_type = v_wine.wine_reference_type
        order by decision.updated_at desc, decision.id
        limit 1;

        if found then
            v_country := nullif(
                pg_catalog.btrim(v_decision.candidate_snapshot ->> 'country'),
                ''
            );
            v_region := nullif(
                pg_catalog.btrim(v_decision.candidate_snapshot ->> 'region'),
                ''
            );
            v_subregion := nullif(
                pg_catalog.btrim(v_decision.candidate_snapshot ->> 'sub_region'),
                ''
            );
            v_classification := nullif(
                pg_catalog.btrim(
                    v_decision.candidate_snapshot ->> 'classification'
                ),
                ''
            );
            v_vineyard := coalesce(
                nullif(
                    pg_catalog.btrim(
                        v_decision.candidate_snapshot ->> 'parcel'
                    ),
                    ''
                ),
                nullif(
                    pg_catalog.btrim(
                        v_decision.candidate_snapshot ->> 'site'
                    ),
                    ''
                )
            );
            v_appellation := nullif(
                pg_catalog.btrim(
                    v_decision.candidate_snapshot ->> 'appellation'
                ),
                ''
            );

            if v_country is not null
               or v_region is not null
               or v_subregion is not null
               or v_classification is not null
               or v_vineyard is not null
            then
                v_sources := v_sources || pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                        'kind', 'reference',
                        'name', 'Liv-ex LWIN reference',
                        'identifier_scheme', v_decision.identifier_scheme,
                        'identifier_value', v_decision.identifier_value,
                        'url', null,
                        'reviewed_at', v_decision.updated_at
                    )
                );
            end if;
        end if;
    end if;

    v_appellation := coalesce(
        nullif(pg_catalog.btrim(v_wine.appellation), ''),
        v_appellation
    );

    if v_appellation is not null then
        select alias.place_id
        into v_place_id
        from public.enrichment_place_aliases alias
        where alias.normalized_value =
            private.normalize_wine_reference_text(v_appellation)
        limit 1;
    end if;

    if v_place_id is not null then
        with recursive ancestry as (
            select place.id, place.parent_id, 0 as depth
            from public.enrichment_places place
            where place.id = v_place_id

            union all

            select parent.id, parent.parent_id, child.depth + 1
            from public.enrichment_places parent
            join ancestry child on child.parent_id = parent.id
        )
        select
            evidence.claim_value,
            source.source_name,
            evidence.source_record_url,
            evidence.reviewed_at
        into
            v_fact_claim,
            v_fact_source_name,
            v_fact_source_url,
            v_fact_reviewed_at
        from ancestry place
        join public.enrichment_evidence evidence
          on evidence.place_id = place.id
        join public.enrichment_sources source
          on source.id = evidence.source_id
        where evidence.content_mode = 'normalized-claim'
          and evidence.claim_type = 'legal-definition'
          and evidence.review_status = 'reviewed'
          and evidence.wine_color =
              private.canonical_enrichment_wine_color(v_wine.color)
          and pg_catalog.jsonb_typeof(
              evidence.claim_value -> 'grape_composition'
          ) = 'array'
        order by place.depth, evidence.reviewed_at desc, evidence.id
        limit 1;

        if found then
            v_grapes := v_fact_claim -> 'grape_composition';
            v_grape_note := nullif(
                pg_catalog.btrim(v_fact_claim ->> 'note'),
                ''
            );
            v_sources := v_sources || pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                        'kind', 'reviewed-web',
                        'name', v_fact_source_name,
                        'identifier_scheme', null,
                        'identifier_value', null,
                        'url', v_fact_source_url,
                        'reviewed_at', v_fact_reviewed_at
                    )
            );
        end if;
    end if;

    if pg_catalog.jsonb_array_length(v_sources) = 0 then
        return pg_catalog.jsonb_build_object(
            'status', 'unavailable',
            'reason', 'No reviewed reference or appellation facts are available',
            'sources', '[]'::jsonb,
            'values', null
        );
    end if;

    return pg_catalog.jsonb_build_object(
        'status', 'available',
        'reason', null,
        'sources', v_sources,
        'values', pg_catalog.jsonb_build_object(
            'country', v_country,
            'region', v_region,
            'subregion', v_subregion,
            'classification', v_classification,
            'vineyard', v_vineyard,
            'grape_composition', v_grapes,
            'grape_note', v_grape_note
        )
    );
end;
$$;

revoke all
on function public.get_wine_fact_suggestions(uuid)
from public, anon;

grant execute
on function public.get_wine_fact_suggestions(uuid)
to authenticated;

commit;
