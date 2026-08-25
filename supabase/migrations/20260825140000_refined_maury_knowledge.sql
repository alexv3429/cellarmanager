begin;

create or replace function public.install_refined_pairing_knowledge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_v5_id uuid := private.enrichment_seed_uuid('knowledge:pairing-v5');
    v_version_id uuid := private.enrichment_seed_uuid('knowledge:pairing-v6');
    v_maury_id uuid := private.enrichment_seed_uuid('place:maury');
    v_maury_sec_id uuid := private.enrichment_seed_uuid('place:maury-sec');
    v_maury_profile_id uuid;
    v_maury_sec_profile_id uuid := private.enrichment_seed_uuid(
        'profile:pairing-v6:maury-sec-red'
    );
    v_evidence_id uuid := private.enrichment_seed_uuid(
        'evidence:maturity-knowledge-v2'
    );
    v_result jsonb;
begin
    if exists (
        select 1
        from public.enrichment_knowledge_versions version
        where version.id = v_version_id
          and version.status in ('active', 'superseded', 'retired')
    ) then
        select jsonb_build_object(
            'knowledge_version_id', version.id,
            'status', version.status,
            'content_sha256', version.content_sha256,
            'already_installed', true
        )
        into v_result
        from public.enrichment_knowledge_versions version
        where version.id = v_version_id;

        return v_result;
    end if;

    if exists (
        select 1
        from public.enrichment_knowledge_versions version
        where version.version_number = 6
          and version.id <> v_version_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'Knowledge version 6 is already used by another model';
    end if;

    perform public.install_expanded_pairing_knowledge();

    insert into public.enrichment_knowledge_versions (
        id,
        version_number,
        label,
        model_key,
        model_version
    )
    values (
        v_version_id,
        6,
        'Refined reviewed structural food pairing model',
        'hierarchical-maturity',
        'pairing-1.2.0'
    )
    on conflict (id) do nothing;

    perform private.copy_enrichment_profiles(
        v_v5_id,
        v_version_id,
        'profile:pairing-v6:copy:'
    );

    select typed.profile_id
    into strict v_maury_profile_id
    from public.enrichment_place_profiles typed
    where typed.knowledge_version_id = v_version_id
      and typed.place_id = v_maury_id
      and typed.wine_color = 'red';

    update public.enrichment_profiles profile
    set
        confidence = 0.64,
        rationale = 'A Maury without the mandatory Sec term is treated as vin doux naturel; the separate Maury Sec identity retains a dry red profile.',
        reviewed_at = '2026-08-25T18:30:00Z'
    where profile.id = v_maury_profile_id;

    update public.enrichment_place_profiles typed
    set
        sweetness = 4.5,
        tannin = 2.5,
        alcohol = 4.5,
        freshness = 3.0,
        concentration = 4.3
    where typed.profile_id = v_maury_profile_id;

    insert into public.enrichment_places (
        id,
        parent_id,
        place_type,
        canonical_name,
        country_code
    )
    values (
        v_maury_sec_id,
        v_maury_id,
        'appellation',
        'Maury Sec',
        'FR'
    )
    on conflict (id) do nothing;

    insert into public.enrichment_place_aliases (place_id, alias_value)
    values (v_maury_sec_id, 'Maury Sec')
    on conflict (normalized_value) do nothing;

    if not exists (
        select 1
        from public.enrichment_place_aliases alias
        where alias.place_id = v_maury_sec_id
          and alias.normalized_value =
              private.normalize_wine_reference_text('Maury Sec')
    ) then
        raise exception using
            errcode = '23505',
            message = 'Maury Sec alias conflicts with another place';
    end if;

    insert into public.enrichment_profiles (
        id,
        knowledge_version_id,
        profile_type,
        review_status,
        confidence,
        rationale,
        reviewed_at
    )
    values (
        v_maury_sec_profile_id,
        v_version_id,
        'place',
        'reviewed',
        0.64,
        'Maury Sec is the explicitly labelled dry red form of the appellation and must not inherit the vin doux naturel sweetness profile.',
        '2026-08-25T18:30:00Z'
    );

    insert into public.enrichment_place_profiles (
        profile_id,
        knowledge_version_id,
        place_id,
        wine_color,
        first_trial_age,
        best_start_age,
        best_end_age,
        outer_horizon_age,
        body,
        acidity,
        tannin,
        sweetness,
        alcohol,
        freshness,
        savory,
        concentration
    )
    values (
        v_maury_sec_profile_id,
        v_version_id,
        v_maury_sec_id,
        'red',
        3,
        5,
        10,
        16,
        3.8,
        3.4,
        3.7,
        0,
        3.8,
        3.4,
        3.8,
        3.8
    );

    insert into public.enrichment_profile_evidence (
        profile_id,
        evidence_id,
        evidence_role
    )
    values (v_maury_sec_profile_id, v_evidence_id, 'supports');

    return public.publish_enrichment_knowledge_version(v_version_id);
end;
$$;

comment on function public.install_refined_pairing_knowledge() is
    'Publishes immutable v6 with distinct Maury vin doux naturel and Maury Sec structural profiles.';

revoke execute on function public.install_refined_pairing_knowledge()
from public, anon, authenticated;

grant execute on function public.install_refined_pairing_knowledge()
to service_role;

commit;
