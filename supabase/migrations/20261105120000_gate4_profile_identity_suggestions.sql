begin;

-- Resolve only identities already present in the shared graph. Profile aliases
-- are lookup hints for this import, never new global aliases or approvals.
create function public.suggest_drinking_window_profile_identities(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_document jsonb;
    v_producer_id uuid;
    v_producer_count integer;
    v_producer_names text[];
    v_cuvee jsonb;
    v_cuvee_names text[];
    v_composite_names text[];
    v_product_id uuid;
    v_product_count integer;
    v_cuvees jsonb := '{}'::jsonb;
    v_ambiguous jsonb := '[]'::jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select exchange.document into v_document
    from private.drinking_window_profile_exchanges exchange
    where exchange.id = p_id and exchange.profile_kind = 'producer';
    if not found then
        raise exception using errcode = '22023', message = 'Choose an imported producer profile';
    end if;
    select pg_catalog.array_agg(distinct private.normalize_wine_reference_text(name))
    into v_producer_names
    from (
        select v_document #>> '{producer,name}' name
        union all
        select value from pg_catalog.jsonb_array_elements_text(
            case when pg_catalog.jsonb_typeof(v_document #> '{producer,aliases}') = 'array'
                then v_document #> '{producer,aliases}' else '[]'::jsonb end)
    ) names where private.normalize_wine_reference_text(name) <> '';
    select count(distinct producer.id), min(producer.id::text)::uuid
    into v_producer_count, v_producer_id
    from public.wine_reference_producers producer
    where private.normalize_wine_reference_text(producer.canonical_name) = any(v_producer_names)
       or exists (select 1 from public.wine_reference_aliases alias
           where alias.entity_id = producer.id and alias.entity_type = 'producer'
             and alias.normalized_value = any(v_producer_names));
    if v_producer_count <> 1 then v_producer_id := null; end if;
    if v_producer_id is not null then
        for v_cuvee in select value from pg_catalog.jsonb_array_elements(v_document -> 'cuvees') loop
            select pg_catalog.array_agg(distinct private.normalize_wine_reference_text(name))
            into v_cuvee_names
            from (
                select v_cuvee ->> 'name' name
                union all
                select value from pg_catalog.jsonb_array_elements_text(
                    case when pg_catalog.jsonb_typeof(v_cuvee -> 'aliases') = 'array'
                        then v_cuvee -> 'aliases' else '[]'::jsonb end)
            ) names where private.normalize_wine_reference_text(name) <> '';
            select pg_catalog.array_agg(distinct private.normalize_wine_reference_text(
                producer_name || ', ' || (v_cuvee ->> 'appellation') || ', ' || cuvee_name))
            into v_composite_names
            from (
                select v_document #>> '{producer,name}' producer_name
                union all
                select value from pg_catalog.jsonb_array_elements_text(
                    case when pg_catalog.jsonb_typeof(v_document #> '{producer,aliases}') = 'array'
                        then v_document #> '{producer,aliases}' else '[]'::jsonb end)
            ) producers
            cross join (
                select v_cuvee ->> 'name' cuvee_name
                union all
                select value from pg_catalog.jsonb_array_elements_text(
                    case when pg_catalog.jsonb_typeof(v_cuvee -> 'aliases') = 'array'
                        then v_cuvee -> 'aliases' else '[]'::jsonb end)
            ) cuvees;
            select count(distinct product.id), min(product.id::text)::uuid
            into v_product_count, v_product_id
            from public.wine_reference_products product
            where product.producer_id = v_producer_id
              and (private.normalize_wine_reference_text(product.canonical_name) = any(v_cuvee_names)
                or private.normalize_wine_reference_text(product.canonical_name) = any(v_composite_names)
                or exists (select 1 from public.wine_reference_aliases alias
                    where alias.entity_id = product.id and alias.entity_type = 'product'
                      and alias.normalized_value = any(v_cuvee_names)));
            if v_product_count = 1 then
                v_cuvees := v_cuvees || pg_catalog.jsonb_build_object(v_cuvee ->> 'id', v_product_id);
            elsif v_product_count > 1 then
                v_ambiguous := v_ambiguous || pg_catalog.jsonb_build_array(v_cuvee ->> 'id');
            end if;
        end loop;
    end if;
    return pg_catalog.jsonb_build_object('profile_id', p_id,
        'producer_id', v_producer_id, 'producer_matches', v_producer_count,
        'cuvees', v_cuvees, 'ambiguous_cuvees', v_ambiguous,
        'published', false, 'wines_linked', 0);
end;
$$;
revoke all on function public.suggest_drinking_window_profile_identities(uuid)
from public, anon;
grant execute on function public.suggest_drinking_window_profile_identities(uuid)
to authenticated;

commit;
