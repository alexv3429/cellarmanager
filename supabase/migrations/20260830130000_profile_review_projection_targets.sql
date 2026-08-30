-- Expose the exact reviewed profiles behind the current maturity projection.
-- This is deliberately separate from the recommendation JSON: older valid
-- projections predate the hierarchical `contributions` explanation format,
-- while their immutable profile links are still authoritative.
create or replace function public.get_wine_profile_review_targets(
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
    v_household_id uuid;
    v_items jsonb;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    select wine.household_id
    into v_household_id
    from public.wines wine
    where wine.id = p_wine_id;

    if not found or not exists (
        select 1
        from public.household_members member
        where member.household_id = v_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Wine membership is required';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'profile_id', link.profile_id,
                'profile_type', subject.value ->> 'profile_type',
                'subject_title', subject.value ->> 'subject_title',
                'contribution_order', link.contribution_order
            )
            order by link.contribution_order, link.profile_id
        ),
        '[]'::jsonb
    )
    into v_items
    from public.wine_enrichment_projections projection
    join public.wine_enrichment_projection_profiles link
      on link.projection_id = projection.id
    cross join lateral (
        select private.enrichment_profile_review_subject(link.profile_id) as value
    ) subject
    where projection.household_id = v_household_id
      and projection.wine_id = p_wine_id
      and projection.projection_type = 'maturity'
      and projection.context_key = ''
      and projection.status = 'current'
      and subject.value is not null;

    return jsonb_build_object(
        'status', 'available',
        'items', v_items
    );
end;
$$;

revoke execute
on function public.get_wine_profile_review_targets(uuid)
from public, anon;

grant execute
on function public.get_wine_profile_review_targets(uuid)
to authenticated;

comment on function public.get_wine_profile_review_targets(uuid) is
'Returns reportable active shared profiles linked to a member-visible wine current maturity projection, including legacy projections without inline contributions.';
