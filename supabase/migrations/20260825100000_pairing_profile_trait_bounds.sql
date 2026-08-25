begin;

create or replace function private.calculate_pairing_wine_profile(
    p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job public.enrichment_jobs%rowtype;
    v_wine public.wines%rowtype;
    v_maturity public.wine_enrichment_projections%rowtype;
    v_fallback_profile_id uuid;
    v_projection_id uuid;
    v_traits jsonb;
    v_normalized_traits jsonb;
    v_warnings jsonb := '[]'::jsonb;
    v_specificity text;
    v_confidence numeric;
    v_color text;
begin
    select job.* into v_job
    from public.enrichment_jobs job
    where job.id = p_job_id
      and job.capability = 'pairing-profile';

    if not found then
        return jsonb_build_object(
            'status', 'not-found',
            'reason', 'pairing-job-not-found'
        );
    end if;

    select wine.* into v_wine
    from public.wines wine
    where wine.id = v_job.wine_id
      and wine.household_id = v_job.household_id;

    if not found then
        return jsonb_build_object(
            'status', 'not-found',
            'reason', 'wine-not-found'
        );
    end if;

    v_color := private.canonical_enrichment_wine_color(v_wine.color);

    select projection.* into v_maturity
    from public.wine_enrichment_projections projection
    where projection.household_id = v_wine.household_id
      and projection.wine_id = v_wine.id
      and projection.knowledge_version_id = v_job.knowledge_version_id
      and projection.projection_type = 'maturity'
      and projection.context_key = ''
      and projection.status = 'current';

    if found and jsonb_typeof(v_maturity.recommendation -> 'traits') = 'object' then
        v_traits := v_maturity.recommendation -> 'traits';
        v_specificity := v_maturity.specificity;
        v_confidence := v_maturity.confidence;
    else
        -- Structural pairing can use an exact reviewed place without
        -- inventing the calendar anchor required by maturity advice.
        select profile.id,
               jsonb_build_object(
                   'body', typed.body,
                   'acidity', typed.acidity,
                   'tannin', typed.tannin,
                   'sweetness', typed.sweetness,
                   'alcohol', typed.alcohol,
                   'freshness', typed.freshness,
                   'savory', typed.savory,
                   'concentration', typed.concentration
               ),
               profile.confidence
        into v_fallback_profile_id, v_traits, v_confidence
        from public.enrichment_place_aliases alias
        join public.enrichment_place_profiles typed
          on typed.place_id = alias.place_id
         and typed.knowledge_version_id = v_job.knowledge_version_id
         and typed.wine_color = v_color
        join public.enrichment_profiles profile
          on profile.id = typed.profile_id
        where alias.normalized_value =
              private.normalize_wine_reference_text(v_wine.appellation)
        limit 1;

        if found then
            v_specificity := 'place';
            v_warnings := jsonb_build_array(
                'Pairing uses reviewed wine structure, but readiness is unknown because no maturity window is available.'
            );
        elsif exists (
            select 1
            from public.enrichment_demands demand
            where demand.household_id = v_wine.household_id
              and demand.wine_id = v_wine.id
              and demand.capability = 'maturity'
              and demand.demand_status in ('queued', 'matching', 'retrying')
        ) then
            return jsonb_build_object(
                'status', 'retry',
                'reason', 'maturity-profile-pending'
            );
        else
            return jsonb_build_object(
                'status', 'needs-review',
                'reason', 'pairing-profile-unavailable'
            );
        end if;
    end if;

    if jsonb_typeof(v_traits) <> 'object'
       or (
           select count(*)
           from jsonb_object_keys(v_traits)
       ) <> 8
       or exists (
           select 1
           from jsonb_each(v_traits) trait
           where trait.key not in (
               'body', 'acidity', 'tannin', 'sweetness',
               'alcohol', 'freshness', 'savory', 'concentration'
           )
              or jsonb_typeof(trait.value) <> 'number'
       ) then
        return jsonb_build_object(
            'status', 'needs-review',
            'reason', 'invalid-pairing-wine-structure'
        );
    end if;

    -- Layered adjustments may cross the bounded structural scale slightly.
    -- Pairing uses the boundary value instead of rejecting an otherwise
    -- reviewed profile or allowing an out-of-domain score.
    v_normalized_traits := jsonb_build_object(
        'body', greatest(0, least(5, (v_traits ->> 'body')::numeric)),
        'acidity', greatest(0, least(5, (v_traits ->> 'acidity')::numeric)),
        'tannin', greatest(0, least(5, (v_traits ->> 'tannin')::numeric)),
        'sweetness', greatest(0, least(5, (v_traits ->> 'sweetness')::numeric)),
        'alcohol', greatest(0, least(5, (v_traits ->> 'alcohol')::numeric)),
        'freshness', greatest(0, least(5, (v_traits ->> 'freshness')::numeric)),
        'savory', greatest(0, least(5, (v_traits ->> 'savory')::numeric)),
        'concentration', greatest(
            0,
            least(5, (v_traits ->> 'concentration')::numeric)
        )
    );

    if v_normalized_traits <> v_traits then
        v_warnings := v_warnings || jsonb_build_array(
            'Derived structural values were normalized to the model bounds.'
        );
    end if;
    v_traits := v_normalized_traits;

    update public.wine_enrichment_projections projection
    set status = 'superseded'
    where projection.household_id = v_wine.household_id
      and projection.wine_id = v_wine.id
      and projection.projection_type = 'pairing'
      and projection.context_key = 'wine-profile'
      and projection.status = 'current';

    insert into public.wine_enrichment_projections (
        household_id,
        wine_id,
        reference_id,
        reference_type,
        knowledge_version_id,
        projection_type,
        context_key,
        method,
        specificity,
        confidence,
        input_fingerprint,
        recommendation
    )
    values (
        v_wine.household_id,
        v_wine.id,
        v_wine.wine_reference_id,
        v_wine.wine_reference_type,
        v_job.knowledge_version_id,
        'pairing',
        'wine-profile',
        'curated-inference',
        v_specificity,
        v_confidence,
        v_job.input_fingerprint,
        jsonb_build_object(
            'schema_version', 1,
            'kind', 'wine-profile',
            'wine_color', v_color,
            'traits', v_traits,
            'confidence_label', case
                when v_confidence >= 0.75 then 'high'
                when v_confidence >= 0.5 then 'medium'
                else 'low'
            end,
            'warnings', v_warnings
        )
    )
    returning id into v_projection_id;

    if v_maturity.id is not null then
        insert into public.wine_enrichment_projection_profiles (
            projection_id,
            knowledge_version_id,
            profile_id,
            contribution_order
        )
        select
            v_projection_id,
            link.knowledge_version_id,
            link.profile_id,
            link.contribution_order
        from public.wine_enrichment_projection_profiles link
        where link.projection_id = v_maturity.id;

        insert into public.wine_enrichment_projection_evidence (
            projection_id,
            evidence_id
        )
        select v_projection_id, link.evidence_id
        from public.wine_enrichment_projection_evidence link
        where link.projection_id = v_maturity.id;
    else
        insert into public.wine_enrichment_projection_profiles (
            projection_id,
            knowledge_version_id,
            profile_id,
            contribution_order
        )
        values (
            v_projection_id,
            v_job.knowledge_version_id,
            v_fallback_profile_id,
            1
        );

        insert into public.wine_enrichment_projection_evidence (
            projection_id,
            evidence_id
        )
        select v_projection_id, link.evidence_id
        from public.enrichment_profile_evidence link
        where link.profile_id = v_fallback_profile_id;
    end if;

    return jsonb_build_object(
        'status', 'complete',
        'pairing_profile_projection_id', v_projection_id
    );
end;
$$;

revoke execute on function private.calculate_pairing_wine_profile(uuid)
from public, anon, authenticated;

grant execute on function private.calculate_pairing_wine_profile(uuid)
to service_role;

comment on function private.calculate_pairing_wine_profile(uuid) is
    'Prepares bounded wine structure for pairing while retaining reviewed maturity provenance.';

commit;
