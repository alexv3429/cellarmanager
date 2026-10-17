begin;

-- Read-only, service-only comparison of a draft against actual household
-- maturity state. A draft match remains a diagnostic, never display advice.
-- No household identity, wine, or result is copied into shared references.
create function public.drinking_window_shadow_compare(
    p_version_id uuid, p_household_id uuid, p_wine_ids uuid[]
)
returns table (
    wine_id uuid,
    draft_sha256 text,
    draft_issue_count bigint,
    identity_status text,
    draft_status text,
    comparison_status text,
    current_source text,
    current_projection_id uuid,
    current_first_trial_year integer,
    current_best_start_year integer,
    current_best_end_year integer,
    reference_row_id uuid,
    matched_scope text,
    proposed_first_trial_year integer,
    proposed_best_start_year integer,
    proposed_best_end_year integer,
    first_trial_delta integer,
    best_start_delta integer,
    best_end_delta integer,
    reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine_id uuid;
    v_wine public.wines%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_projection public.wine_enrichment_projections%rowtype;
    v_override public.wine_maturity_overrides%rowtype;
    v_match record;
    v_hash text;
    v_issues bigint;
    v_identity_status text;
    v_current_source text;
    v_current_first integer;
    v_current_start integer;
    v_current_end integer;
    v_comparison text;
begin
    if p_household_id is null or p_wine_ids is null
       or cardinality(p_wine_ids) not between 1 and 250
       or array_position(p_wine_ids, null) is not null
       or (select count(distinct id) from unnest(p_wine_ids) as ids(id))
          <> cardinality(p_wine_ids) then
        raise exception using errcode = '22023',
            message = 'Provide one household and 1 to 250 distinct wine IDs';
    end if;

    -- These checks do not approve a draft. They make an unready comparison
    -- unmistakable and bind every row of the report to the same draft state.
    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    select count(*) into v_issues
    from public.drinking_window_publication_issues(p_version_id);

    foreach v_wine_id in array p_wine_ids loop
        select * into v_wine from public.wines w
        where w.id = v_wine_id and w.household_id = p_household_id
          and w.merged_into_wine_id is null;
        if not found then
            raise exception using errcode = '22023',
                message = 'Every wine must be active and belong to the requested household';
        end if;

        v_region_id := null;
        v_appellation_id := null;
        v_producer_id := null;
        v_product_id := null;
        v_release_id := null;
        v_identity_status := 'exact_place_and_reference';

        -- A text label resolves only when its normalized canonical name or
        -- reviewed alias identifies exactly one place of the right kind.
        select array_agg(distinct candidate.id) into v_region_ids
        from (
            select p.id from public.enrichment_places p
            where p.place_type in ('region', 'subregion')
              and p.normalized_name = private.normalize_wine_reference_text(v_wine.area)
            union
            select p.id from public.enrichment_place_aliases a
            join public.enrichment_places p on p.id = a.place_id
            where p.place_type in ('region', 'subregion')
              and a.normalized_value = private.normalize_wine_reference_text(v_wine.area)
        ) candidate;
        if cardinality(v_region_ids) = 1 then
            v_region_id := v_region_ids[1];
        else
            v_identity_status := 'region_unresolved';
        end if;

        if v_wine.appellation is not null then
            select array_agg(distinct candidate.id) into v_appellation_ids
            from (
                select p.id from public.enrichment_places p
                where p.place_type = 'appellation'
                  and p.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
                union
                select p.id from public.enrichment_place_aliases a
                join public.enrichment_places p on p.id = a.place_id
                where p.place_type = 'appellation'
                  and a.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
            ) candidate;
            if cardinality(v_appellation_ids) = 1 then
                v_appellation_id := v_appellation_ids[1];
            elsif v_identity_status = 'exact_place_and_reference' then
                v_identity_status := 'appellation_unresolved';
            end if;
        end if;

        -- Only an existing household link supplies producer/product/release.
        -- Never infer those identities from a similar-looking OCR string.
        if v_wine.wine_reference_type = 'release' then
            select r.id, p.id, p.producer_id
            into v_release_id, v_product_id, v_producer_id
            from public.wine_reference_releases r
            join public.wine_reference_products p on p.id = r.product_id
            where r.id = v_wine.wine_reference_id
              and r.vintage_year = v_wine.vintage;
        elsif v_wine.wine_reference_type = 'product' then
            select p.id, p.producer_id into v_product_id, v_producer_id
            from public.wine_reference_products p
            where p.id = v_wine.wine_reference_id;
        end if;
        if v_producer_id is null and v_identity_status = 'exact_place_and_reference' then
            v_identity_status := 'wine_reference_unlinked';
        end if;

        select * into v_override from public.wine_maturity_overrides o
        where o.household_id = p_household_id and o.wine_id = v_wine_id;
        select * into v_projection from public.wine_enrichment_projections p
        where p.household_id = p_household_id and p.wine_id = v_wine_id
          and p.projection_type = 'maturity' and p.context_key = ''
          and p.status = 'current';

        v_current_source := 'none';
        v_current_first := null;
        v_current_start := null;
        v_current_end := null;
        if v_override.wine_id is not null then
            v_current_source := 'manual_override';
            v_current_first := v_override.first_trial_year;
            v_current_start := v_override.best_start_year;
            v_current_end := v_override.best_end_year;
        elsif v_projection.id is not null then
            v_current_source := case
                when v_projection.valid_until <= now() then 'expired_model'
                else 'model' end;
            v_current_first := (v_projection.recommendation ->> 'first_trial_year')::integer;
            v_current_start := (v_projection.recommendation ->> 'best_start_year')::integer;
            v_current_end := (v_projection.recommendation ->> 'best_end_year')::integer;
        end if;

        select * into v_match
        from public.drinking_window_preview_draft_match(
            p_version_id, v_producer_id, v_product_id, v_release_id,
            v_appellation_id, v_region_id,
            private.canonical_enrichment_wine_color(v_wine.color),
            v_wine.vintage
        );

        v_comparison := case
            when v_current_source = 'manual_override' then 'manual_preserved'
            when v_match.status <> 'draft_match' then v_match.status
            when v_current_source = 'none' then 'new_reference_no_baseline'
            when v_current_source = 'expired_model' then 'expired_baseline'
            when (v_current_first, v_current_start, v_current_end)
                 = (v_match.first_trial_year, v_match.best_start_year,
                    v_match.best_end_year) then 'unchanged'
            else 'changed'
        end;

        return query select v_wine_id, v_hash, v_issues,
            v_identity_status, v_match.status, v_comparison,
            v_current_source, v_projection.id,
            v_current_first, v_current_start, v_current_end,
            v_match.reference_row_id, v_match.matched_scope,
            v_match.first_trial_year, v_match.best_start_year,
            v_match.best_end_year,
            case when v_match.status = 'draft_match' and v_current_first is not null
                then v_match.first_trial_year - v_current_first else null end,
            case when v_match.status = 'draft_match' and v_current_start is not null
                then v_match.best_start_year - v_current_start else null end,
            case when v_match.status = 'draft_match' and v_current_end is not null
                then v_match.best_end_year - v_current_end else null end,
            v_match.reason;
    end loop;
end;
$$;

revoke all on function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_shadow_compare(uuid, uuid, uuid[])
to service_role;

commit;
