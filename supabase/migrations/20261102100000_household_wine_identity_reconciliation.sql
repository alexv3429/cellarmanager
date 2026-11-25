begin;

-- Read-only, household-scoped reconciliation. A similar name is a suggestion,
-- never an automatic shared identity or a reason to activate shared dates.
create function public.preview_household_wine_identity_reconciliation(p_wine_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_items jsonb := '[]'::jsonb;
    v_candidates jsonb;
    v_count integer;
begin
    if p_wine_ids is null or pg_catalog.cardinality(p_wine_ids) not between 1 and 100
       or pg_catalog.cardinality(p_wine_ids) <> (select count(distinct id) from pg_catalog.unnest(p_wine_ids) id)
       or array_position(p_wine_ids, null) is not null then
        raise exception using errcode = '22023', message = 'Choose 1 to 100 distinct wines';
    end if;
    for v_wine in select wine.* from public.wines wine
        where wine.id = any(p_wine_ids) order by wine.id loop
        if private.require_household_member(v_wine.household_id) <> 'owner' then
            raise exception using errcode = '42501', message = 'Only household owners can review wine identities';
        end if;
        if v_wine.merged_into_wine_id is not null or v_wine.wine_reference_id is not null then
            raise exception using errcode = '22023', message = 'Choose active wines without a shared link';
        end if;
        with matching as (
            select case when v_wine.vintage is null then product.id else release.id end reference_id,
                   case when v_wine.vintage is null then 'product' else 'release' end reference_type,
                   producer.canonical_name producer_name, product.canonical_name product_name,
                   release.vintage_year, release.release_designator,
                   case when private.normalize_wine_reference_text(producer.canonical_name) = private.normalize_wine_reference_text(v_wine.producer)
                           or exists (select 1 from public.wine_reference_aliases alias
                               where alias.entity_id = producer.id and alias.entity_type = 'producer'
                                 and alias.normalized_value = private.normalize_wine_reference_text(v_wine.producer))
                        then 2 else 1 end producer_strength,
                   case when private.normalize_wine_reference_text(product.canonical_name) = private.normalize_wine_reference_text(v_wine.cuvee)
                           or exists (select 1 from public.wine_reference_aliases alias
                               where alias.entity_id = product.id and alias.entity_type = 'product'
                                 and alias.normalized_value = private.normalize_wine_reference_text(v_wine.cuvee))
                        then 2 else 1 end product_strength
            from public.wine_reference_products product
            join public.wine_reference_producers producer on producer.id = product.producer_id
            left join public.wine_reference_releases release
                on release.product_id = product.id and release.vintage_year = v_wine.vintage
            where (v_wine.vintage is null or release.id is not null)
              and (private.normalize_wine_reference_text(producer.canonical_name) = private.normalize_wine_reference_text(v_wine.producer)
                or exists (select 1 from public.wine_reference_aliases alias
                    where alias.entity_id = producer.id and alias.entity_type = 'producer'
                      and alias.normalized_value = private.normalize_wine_reference_text(v_wine.producer))
                or (length(private.normalize_wine_reference_text(v_wine.producer)) >= 5
                    and pg_catalog.strpos(private.normalize_wine_reference_text(producer.canonical_name),
                        private.normalize_wine_reference_text(v_wine.producer)) > 0))
              and (private.normalize_wine_reference_text(product.canonical_name) = private.normalize_wine_reference_text(v_wine.cuvee)
                or exists (select 1 from public.wine_reference_aliases alias
                    where alias.entity_id = product.id and alias.entity_type = 'product'
                      and alias.normalized_value = private.normalize_wine_reference_text(v_wine.cuvee))
                or (length(private.normalize_wine_reference_text(v_wine.cuvee)) >= 5
                    and pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name),
                        private.normalize_wine_reference_text(v_wine.cuvee)) > 0))
        ), ranked as (
            select matching.*, row_number() over (order by producer_strength + product_strength desc,
                producer_name, product_name, reference_id) rank from matching
        )
        select count(*), coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'reference_id', reference_id, 'reference_type', reference_type,
            'producer_name', producer_name, 'product_name', product_name,
            'vintage_year', vintage_year, 'release_designator', release_designator,
            'match_basis', case when producer_strength = 2 and product_strength = 2
                then 'exact_or_curated_alias' else 'name_containment' end
        ) order by rank) filter (where rank <= 5), '[]'::jsonb)
        into v_count, v_candidates from ranked;
        v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'wine_id', v_wine.id, 'source_fingerprint', private.wine_reference_source_fingerprint(v_wine),
            'candidate_count', v_count, 'candidates', v_candidates));
    end loop;
    if pg_catalog.jsonb_array_length(v_items) <> pg_catalog.cardinality(p_wine_ids) then
        raise exception using errcode = '22023', message = 'One or more wines were not found';
    end if;
    return v_items;
end;
$$;

-- A single owner confirmation can cover several unambiguous suggestions.
-- Rechecking the current preview plus the existing per-wine fingerprint makes
-- the entire operation atomic; the existing decision audit records each link.
create function public.confirm_household_wine_identity_reconciliation(p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_choice jsonb;
    v_ids uuid[];
    v_preview jsonb;
    v_item jsonb;
    v_result jsonb := '[]'::jsonb;
begin
    if pg_catalog.jsonb_typeof(p_choices) is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_choices) not between 1 and 50 then
        raise exception using errcode = '22023', message = 'Choose 1 to 50 wine links';
    end if;
    select array_agg((choice.value ->> 'wine_id')::uuid) into v_ids
    from pg_catalog.jsonb_array_elements(p_choices) choice;
    if pg_catalog.cardinality(v_ids) <> (select count(distinct id) from pg_catalog.unnest(v_ids) id) then
        raise exception using errcode = '22023', message = 'Choose each wine only once';
    end if;
    v_preview := public.preview_household_wine_identity_reconciliation(v_ids);
    for v_choice in select value from pg_catalog.jsonb_array_elements(p_choices) loop
        select value into v_item from pg_catalog.jsonb_array_elements(v_preview)
        where value ->> 'wine_id' = v_choice ->> 'wine_id';
        if (v_item ->> 'candidate_count')::integer <> 1
           or v_item ->> 'source_fingerprint' is distinct from v_choice ->> 'source_fingerprint'
           or v_item #>> '{candidates,0,reference_id}' is distinct from v_choice ->> 'reference_id' then
            raise exception using errcode = '40001', message = 'Wine identity suggestions changed; refresh before saving';
        end if;
        v_result := v_result || pg_catalog.jsonb_build_array(public.manage_household_wine_identity(
            (v_choice ->> 'wine_id')::uuid, 'link', (v_choice ->> 'reference_id')::uuid,
            v_choice ->> 'source_fingerprint', null));
    end loop;
    return v_result;
end;
$$;

revoke all on function public.preview_household_wine_identity_reconciliation(uuid[]) from public, anon;
revoke all on function public.confirm_household_wine_identity_reconciliation(jsonb) from public, anon;
grant execute on function public.preview_household_wine_identity_reconciliation(uuid[]) to authenticated;
grant execute on function public.confirm_household_wine_identity_reconciliation(jsonb) to authenticated;
commit;
