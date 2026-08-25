update public.wine_enrichment_projections projection
set
    status = 'superseded',
    recommendation = jsonb_set(
        projection.recommendation,
        '{scorer_version}',
        to_jsonb('pairing-score-1.1.0'::text)
    )
where projection.projection_type = 'pairing'
  and projection.context_key like 'dish:%'
  and projection.status = 'current';

alter function public.get_pairing_suggestions(
    uuid, text, jsonb, text[], text, integer
)
rename to get_pairing_suggestions_v1;

revoke execute on function public.get_pairing_suggestions_v1(
    uuid, text, jsonb, text[], text, integer
)
from public, anon, authenticated;

grant execute on function public.get_pairing_suggestions_v1(
    uuid, text, jsonb, text[], text, integer
)
to service_role;

create function public.get_pairing_suggestions(
    p_household_id uuid,
    p_dish_key text,
    p_dish_attributes jsonb,
    p_preferred_colors text[],
    p_preferred_style text,
    p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    v_result := public.get_pairing_suggestions_v1(
        p_household_id,
        p_dish_key,
        p_dish_attributes,
        p_preferred_colors,
        p_preferred_style,
        p_limit
    );

    update public.wine_enrichment_projections projection
    set recommendation = jsonb_set(
        projection.recommendation,
        '{scorer_version}',
        to_jsonb('pairing-score-1.2.0'::text)
    )
    where projection.household_id = p_household_id
      and projection.projection_type = 'pairing'
      and projection.context_key like 'dish:%'
      and projection.status = 'current'
      and projection.recommendation ->> 'dish_key' = lower(trim(p_dish_key))
      and projection.recommendation ->> 'scorer_version' is null;

    return v_result || jsonb_build_object(
        'scorer_version', 'pairing-score-1.2.0'
    );
end;
$$;

revoke execute on function public.get_pairing_suggestions(
    uuid, text, jsonb, text[], text, integer
)
from public, anon;

grant execute on function public.get_pairing_suggestions(
    uuid, text, jsonb, text[], text, integer
)
to authenticated, service_role;

comment on function public.get_pairing_suggestions(
    uuid, text, jsonb, text[], text, integer
) is
    'Returns household-safe in-stock pairings and records the independently versioned scoring algorithm.';
