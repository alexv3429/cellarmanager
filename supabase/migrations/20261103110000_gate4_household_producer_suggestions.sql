begin;

-- Offer the owner bounded candidates from the reviewed shared identity graph.
-- A candidate is never a household mapping: only the existing owner-confirmed
-- manage_household_producer_preference RPC can save that decision.
create or replace function public.get_household_producer_preference_review(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if private.require_household_member(p_household_id) <> 'owner' then
        raise exception using errcode = '42501', message = 'Only household owners can review producer preferences';
    end if;

    return pg_catalog.jsonb_build_object(
        'household_id', p_household_id,
        'sources', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'source_text', source.source_text,
                    'normalized', source.normalized,
                    'wine_count', source.wine_count,
                    'producer_id', preference.producer_id,
                    'canonical_name', producer.canonical_name,
                    'suggestions', coalesce(suggestions.items, '[]'::jsonb)
                ) order by source.source_text)
            from (
                select
                    private.normalize_wine_reference_text(wine.producer) as normalized,
                    min(pg_catalog.btrim(wine.producer)) as source_text,
                    count(*) as wine_count
                from public.wines wine
                where wine.household_id = p_household_id
                  and wine.merged_into_wine_id is null
                group by private.normalize_wine_reference_text(wine.producer)
            ) source
            left join public.wine_reference_household_producer_preferences preference
              on preference.household_id = p_household_id
             and preference.source_producer_normalized = source.normalized
            left join public.wine_reference_producers producer
              on producer.id = preference.producer_id
            left join lateral (
                select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'id', candidate.id,
                    'canonical_name', candidate.canonical_name,
                    'match_kind', candidate.match_kind
                ) order by candidate.rank desc, candidate.canonical_name, candidate.id) as items
                from (
                    select shared.id, shared.canonical_name,
                        case
                            when private.normalize_wine_reference_text(shared.canonical_name) = source.normalized
                                then 'exact'
                            when exists (
                                select 1 from public.wine_reference_aliases alias
                                where alias.entity_type = 'producer'
                                  and alias.entity_id = shared.id
                                  and alias.normalized_value = source.normalized
                            ) then 'alias'
                            else 'similar'
                        end as match_kind,
                        case
                            when private.normalize_wine_reference_text(shared.canonical_name) = source.normalized
                                then 3
                            when exists (
                                select 1 from public.wine_reference_aliases alias
                                where alias.entity_type = 'producer'
                                  and alias.entity_id = shared.id
                                  and alias.normalized_value = source.normalized
                            ) then 2
                            else 1
                        end as rank
                    from public.wine_reference_producers shared
                    where private.normalize_wine_reference_text(shared.canonical_name) = source.normalized
                       or exists (
                            select 1 from public.wine_reference_aliases alias
                            where alias.entity_type = 'producer'
                              and alias.entity_id = shared.id
                              and alias.normalized_value = source.normalized
                       )
                       or (pg_catalog.length(source.normalized) >= 5
                           and pg_catalog.strpos(
                               private.normalize_wine_reference_text(shared.canonical_name),
                               source.normalized
                           ) > 0)
                    order by rank desc, shared.canonical_name, shared.id
                    limit 5
                ) candidate
            ) suggestions on true
        ), '[]'::jsonb)
    );
end;
$$;

revoke all on function public.get_household_producer_preference_review(uuid) from public, anon;
grant execute on function public.get_household_producer_preference_review(uuid) to authenticated;

commit;
