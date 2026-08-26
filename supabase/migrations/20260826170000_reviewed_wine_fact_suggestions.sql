begin;

-- A confirmed LWIN review already carries several useful origin facts. Expose
-- them as read-only suggestions so the household owner can review and save
-- them explicitly; never copy them into the wine automatically.
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

    if v_wine.wine_reference_id is null then
        return pg_catalog.jsonb_build_object(
            'status', 'unavailable',
            'reason', 'No reviewed reference match is confirmed',
            'source', null,
            'values', null
        );
    end if;

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

    if not found then
        return pg_catalog.jsonb_build_object(
            'status', 'unavailable',
            'reason', 'The current reference has no reviewed fact snapshot',
            'source', null,
            'values', null
        );
    end if;

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

    if v_country is null
       and v_region is null
       and v_subregion is null
       and v_classification is null
       and v_vineyard is null
    then
        return pg_catalog.jsonb_build_object(
            'status', 'unavailable',
            'reason', 'The reviewed reference contains no origin facts',
            'source', pg_catalog.jsonb_build_object(
                'name', 'Liv-ex LWIN reference',
                'identifier_scheme', v_decision.identifier_scheme,
                'identifier_value', v_decision.identifier_value,
                'reviewed_at', v_decision.updated_at
            ),
            'values', null
        );
    end if;

    return pg_catalog.jsonb_build_object(
        'status', 'available',
        'reason', null,
        'source', pg_catalog.jsonb_build_object(
            'name', 'Liv-ex LWIN reference',
            'identifier_scheme', v_decision.identifier_scheme,
            'identifier_value', v_decision.identifier_value,
            'reviewed_at', v_decision.updated_at
        ),
        'values', pg_catalog.jsonb_build_object(
            'country', v_country,
            'region', v_region,
            'subregion', v_subregion,
            'classification', v_classification,
            'vineyard', v_vineyard
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
