begin;

-- Pairing uses the same immutable knowledge publication boundary as maturity.
-- A dish is reviewed model input, not free-form household data or a provider
-- response, so it receives a typed profile and attributable methodology.
alter table public.enrichment_profiles
    drop constraint enrichment_profiles_type_check;

alter table public.enrichment_profiles
    add constraint enrichment_profiles_type_check
        check (
            profile_type in (
                'place',
                'place-adjustment',
                'vintage',
                'producer-era',
                'producer-vintage-interaction',
                'cuvee',
                'release',
                'dish'
            )
        );

create table public.enrichment_dish_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'dish',
    dish_key text not null,
    dish_name text not null,
    description text not null,
    intensity numeric(3, 2) not null,
    fat numeric(3, 2) not null,
    acidity numeric(3, 2) not null,
    sweetness numeric(3, 2) not null,
    salt numeric(3, 2) not null,
    umami numeric(3, 2) not null,
    spice numeric(3, 2) not null,
    protein numeric(3, 2) not null,
    fish numeric(3, 2) not null,

    constraint enrichment_dish_profiles_type_check
        check (profile_type = 'dish'),
    constraint enrichment_dish_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(
            id,
            knowledge_version_id,
            profile_type
        )
        on delete cascade,
    constraint enrichment_dish_profiles_key_unique
        unique (knowledge_version_id, dish_key),
    constraint enrichment_dish_profiles_key_check
        check (
            length(dish_key) between 1 and 64
            and dish_key = lower(trim(dish_key))
            and dish_key ~ '^[a-z0-9][a-z0-9-]*$'
        ),
    constraint enrichment_dish_profiles_text_check
        check (
            length(trim(dish_name)) > 0
            and length(trim(description)) > 0
        ),
    constraint enrichment_dish_profiles_attributes_check
        check (
            intensity between 0 and 5
            and fat between 0 and 5
            and acidity between 0 and 5
            and sweetness between 0 and 5
            and salt between 0 and 5
            and umami between 0 and 5
            and spice between 0 and 5
            and protein between 0 and 5
            and fish between 0 and 5
        )
);

alter table public.enrichment_dish_profiles enable row level security;

revoke all privileges on table public.enrichment_dish_profiles
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table public.enrichment_dish_profiles
to service_role;

create trigger enrichment_dish_profiles_require_draft
before insert or update or delete on public.enrichment_dish_profiles
for each row
execute function private.require_draft_enrichment_profile_version();

create constraint trigger enrichment_dish_profiles_shape
after delete on public.enrichment_dish_profiles
deferrable initially deferred
for each row
execute function private.validate_enrichment_profile_shape();

create or replace function private.validate_enrichment_profile_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_profile_id uuid;
    v_profile_type text;
    v_typed_rows integer;
begin
    if tg_table_name = 'enrichment_profiles' then
        v_profile_id := new.id;
    else
        v_profile_id := old.profile_id;
    end if;

    select profile.profile_type into v_profile_type
    from public.enrichment_profiles profile
    where profile.id = v_profile_id;

    if not found then
        return null;
    end if;

    select
        (case when exists (select 1 from public.enrichment_place_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_place_adjustment_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_vintage_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_producer_era_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_producer_vintage_interaction_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_cuvee_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_release_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
        + (case when exists (select 1 from public.enrichment_dish_profiles typed where typed.profile_id = v_profile_id) then 1 else 0 end)
    into v_typed_rows;

    if v_typed_rows <> 1
       or not (
           (v_profile_type = 'place' and exists (select 1 from public.enrichment_place_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'place-adjustment' and exists (select 1 from public.enrichment_place_adjustment_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'vintage' and exists (select 1 from public.enrichment_vintage_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'producer-era' and exists (select 1 from public.enrichment_producer_era_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'producer-vintage-interaction' and exists (select 1 from public.enrichment_producer_vintage_interaction_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'cuvee' and exists (select 1 from public.enrichment_cuvee_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'release' and exists (select 1 from public.enrichment_release_profiles typed where typed.profile_id = v_profile_id))
           or (v_profile_type = 'dish' and exists (select 1 from public.enrichment_dish_profiles typed where typed.profile_id = v_profile_id))
       ) then
        raise exception using
            errcode = '23514',
            message = 'Enrichment profile requires exactly one matching typed row';
    end if;

    return null;
end;
$$;

-- Personal defaults are deliberately outside shared knowledge. They are
-- applied only for one signed-in member and one household.
create table public.wine_pairing_preferences (
    household_id uuid not null,
    user_id uuid not null,
    dish_key text not null,
    preferred_colors text[] not null default '{}'::text[],
    preferred_style text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (household_id, user_id, dish_key),
    constraint wine_pairing_preferences_member_fk
        foreign key (household_id, user_id)
        references public.household_members(household_id, user_id)
        on delete cascade,
    constraint wine_pairing_preferences_dish_check
        check (
            length(dish_key) between 1 and 64
            and dish_key = lower(trim(dish_key))
            and dish_key ~ '^[a-z0-9][a-z0-9-]*$'
        ),
    constraint wine_pairing_preferences_colors_check
        check (
            cardinality(preferred_colors) <= 7
            and array_position(preferred_colors, null) is null
            and preferred_colors <@ array[
                'red', 'white', 'rose', 'sparkling',
                'sweet', 'fortified', 'other'
            ]::text[]
        ),
    constraint wine_pairing_preferences_style_check
        check (
            preferred_style is null
            or preferred_style in ('fresh', 'light', 'rich', 'savory', 'mature')
        )
);

alter table public.wine_pairing_preferences enable row level security;

revoke all privileges on table public.wine_pairing_preferences
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table public.wine_pairing_preferences
to service_role;

-- Include every current typed profile in future canonical hashes. Earlier
-- published hashes remain historical values and are never recalculated.
create or replace function private.enrichment_knowledge_version_payload(
    p_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'version_number', version.version_number,
        'label', version.label,
        'model_key', version.model_key,
        'model_version', version.model_version,
        'profiles', coalesce(
            (
                select jsonb_agg(
                    profile_payload.payload
                    order by profile_payload.profile_type, profile_payload.profile_id
                )
                from (
                    select
                        profile.profile_type,
                        profile.id as profile_id,
                        jsonb_build_object(
                            'id', profile.id,
                            'type', profile.profile_type,
                            'confidence', profile.confidence,
                            'rationale', profile.rationale,
                            'typed', case profile.profile_type
                                when 'place' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_place_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'place-adjustment' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_place_adjustment_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'vintage' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_vintage_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'producer-era' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_producer_era_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'producer-vintage-interaction' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_producer_vintage_interaction_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'cuvee' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_cuvee_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'release' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_release_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'dish' then (
                                    select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                                    from public.enrichment_dish_profiles typed
                                    where typed.profile_id = profile.id
                                )
                            end,
                            'evidence', coalesce(
                                (
                                    select jsonb_agg(
                                        jsonb_build_object(
                                            'id', evidence.id,
                                            'role', link.evidence_role,
                                            'source_id', evidence.source_id,
                                            'source_policy_id', evidence.source_policy_id,
                                            'source_record_id', evidence.source_record_id,
                                            'source_record_url', evidence.source_record_url,
                                            'content_mode', evidence.content_mode,
                                            'claim_type', evidence.claim_type,
                                            'scope_level', evidence.scope_level,
                                            'place_id', evidence.place_id,
                                            'producer_id', evidence.producer_id,
                                            'product_id', evidence.product_id,
                                            'release_id', evidence.release_id,
                                            'package_id', evidence.package_id,
                                            'vintage_year', evidence.vintage_year,
                                            'wine_color', evidence.wine_color,
                                            'claim_value', evidence.claim_value,
                                            'source_published_on', evidence.source_published_on
                                        )
                                        order by evidence.id
                                    )
                                    from public.enrichment_profile_evidence link
                                    join public.enrichment_evidence evidence
                                      on evidence.id = link.evidence_id
                                    where link.profile_id = profile.id
                                ),
                                '[]'::jsonb
                            )
                        ) as payload
                    from public.enrichment_profiles profile
                    where profile.knowledge_version_id = p_version_id
                ) profile_payload
            ),
            '[]'::jsonb
        )
    )
    from public.enrichment_knowledge_versions version
    where version.id = p_version_id;
$$;

revoke execute
on function private.enrichment_knowledge_version_payload(uuid)
from public, anon, authenticated;

grant execute
on function private.enrichment_knowledge_version_payload(uuid)
to service_role;

create or replace function public.install_pairing_knowledge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_v3_id uuid := private.enrichment_seed_uuid('knowledge:maturity-v3');
    v_version_id uuid := private.enrichment_seed_uuid('knowledge:pairing-v4');
    v_source_id uuid := private.enrichment_seed_uuid('source:cellarmanager-pairing');
    v_policy_id uuid := private.enrichment_seed_uuid('policy:cellarmanager-pairing-v1');
    v_evidence_id uuid := private.enrichment_seed_uuid('evidence:cellarmanager-pairing-v1');
    v_dish record;
    v_profile_id uuid;
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
        where version.version_number = 4
          and version.id <> v_version_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'Knowledge version 4 is already used by another model';
    end if;

    perform public.install_hierarchical_maturity_knowledge();

    insert into public.enrichment_sources (
        id,
        source_key,
        source_name,
        source_kind,
        homepage_url
    )
    values (
        v_source_id,
        'cellarmanager-pairing-model',
        'CellarManager reviewed structural pairing model',
        'cellarmanager',
        'https://github.com/alexv3429/cellarmanager'
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
        v_policy_id,
        v_source_id,
        1,
        'reviewed',
        '2026-08-25',
        '2026-08-25',
        'https://github.com/alexv3429/cellarmanager/blob/main/docs/pairing-projections.md',
        'allowed',
        'allowed',
        'prohibited',
        'allowed',
        'allowed',
        'allowed',
        'CellarManager reviewed structural pairing model',
        'CellarManager owns these derived structural dish profiles and scoring rules.'
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
        review_status,
        reviewed_at,
        source_published_on
    )
    values (
        v_evidence_id,
        v_source_id,
        v_policy_id,
        'docs/pairing-projections.md',
        'https://github.com/alexv3429/cellarmanager/blob/main/docs/pairing-projections.md',
        'pointer-only',
        'methodology',
        'methodology',
        'reviewed',
        '2026-08-25T09:00:00Z',
        '2026-08-25'
    )
    on conflict (id) do nothing;

    insert into public.enrichment_knowledge_versions (
        id,
        version_number,
        label,
        model_key,
        model_version
    )
    values (
        v_version_id,
        4,
        'Reviewed structural food pairing model',
        'hierarchical-maturity',
        'pairing-1.0.0'
    )
    on conflict (id) do nothing;

    -- Copy v3 into new immutable profile roots. Shared places, producers,
    -- products, releases, and evidence retain their stable identities.
    insert into public.enrichment_profiles (
        id,
        knowledge_version_id,
        profile_type,
        review_status,
        confidence,
        rationale,
        reviewed_by,
        reviewed_at
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || profile.id::text),
        v_version_id,
        profile.profile_type,
        profile.review_status,
        profile.confidence,
        profile.rationale,
        profile.reviewed_by,
        profile.reviewed_at
    from public.enrichment_profiles profile
    where profile.knowledge_version_id = v_v3_id;

    insert into public.enrichment_place_profiles (
        profile_id, knowledge_version_id, place_id, wine_color,
        first_trial_age, best_start_age, best_end_age, outer_horizon_age,
        body, acidity, tannin, sweetness, alcohol, freshness, savory,
        concentration
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id, typed.place_id, typed.wine_color,
        typed.first_trial_age, typed.best_start_age, typed.best_end_age,
        typed.outer_horizon_age, typed.body, typed.acidity, typed.tannin,
        typed.sweetness, typed.alcohol, typed.freshness, typed.savory,
        typed.concentration
    from public.enrichment_place_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_place_adjustment_profiles (
        profile_id, knowledge_version_id, place_id, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id, typed.place_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_place_adjustment_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_vintage_profiles (
        profile_id, knowledge_version_id, place_id, vintage_year, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, condition_tags, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id, typed.place_id, typed.vintage_year, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.condition_tags, typed.concentration_adjustment
    from public.enrichment_vintage_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_producer_era_profiles (
        profile_id, knowledge_version_id, producer_id,
        first_vintage_year, final_vintage_year, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id, typed.producer_id, typed.first_vintage_year,
        typed.final_vintage_year, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_producer_era_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_producer_vintage_interaction_profiles (
        profile_id, knowledge_version_id, producer_era_profile_id,
        required_condition_tags,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id,
        private.enrichment_seed_uuid(
            'profile:pairing-v4:copy:' || typed.producer_era_profile_id::text
        ),
        typed.required_condition_tags,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_producer_vintage_interaction_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_cuvee_profiles (
        profile_id, knowledge_version_id, product_id, place_id, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id, typed.product_id, typed.place_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_cuvee_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_release_profiles (
        profile_id, knowledge_version_id, release_id, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || typed.profile_id::text),
        v_version_id, typed.release_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_release_profiles typed
    where typed.knowledge_version_id = v_v3_id;

    insert into public.enrichment_profile_evidence (
        profile_id,
        evidence_id,
        evidence_role
    )
    select
        private.enrichment_seed_uuid('profile:pairing-v4:copy:' || link.profile_id::text),
        link.evidence_id,
        link.evidence_role
    from public.enrichment_profile_evidence link
    join public.enrichment_profiles profile on profile.id = link.profile_id
    where profile.knowledge_version_id = v_v3_id;

    for v_dish in
        select *
        from jsonb_to_recordset($dishes$
        [
          {"key":"salad-vinaigrette","name":"Green salad with vinaigrette","description":"A light salad whose dressing makes acidity the main constraint.","intensity":2,"fat":1,"acidity":4,"sweetness":0,"salt":2,"umami":1,"spice":0,"protein":0,"fish":0},
          {"key":"roast-chicken-mushrooms","name":"Roast chicken with mushrooms","description":"Moderate richness, poultry protein, and earthy umami.","intensity":3,"fat":3,"acidity":1,"sweetness":0,"salt":2,"umami":3,"spice":0,"protein":3,"fish":0},
          {"key":"duck-cherry","name":"Duck breast with cherry sauce","description":"Rich poultry with a lightly sweet fruit sauce.","intensity":4,"fat":4,"acidity":2,"sweetness":1,"salt":2,"umami":2,"spice":0,"protein":4,"fish":0},
          {"key":"grilled-beef","name":"Grilled beef","description":"A powerful grilled protein with fat, salt, and umami.","intensity":5,"fat":4,"acidity":0,"sweetness":0,"salt":3,"umami":3,"spice":1,"protein":5,"fish":0},
          {"key":"salmon-lemon","name":"Grilled salmon with lemon","description":"Rich fish with a material citrus-acidity constraint.","intensity":3,"fat":3,"acidity":3,"sweetness":0,"salt":2,"umami":2,"spice":0,"protein":2,"fish":4},
          {"key":"spicy-lamb-tagine","name":"Spiced lamb tagine","description":"Rich lamb with aromatic spice and mild sweetness; heat is adjustable.","intensity":4,"fat":3,"acidity":1,"sweetness":2,"salt":2,"umami":2,"spice":3,"protein":4,"fish":0},
          {"key":"tomato-pasta","name":"Tomato pasta","description":"A medium-weight dish dominated by tomato acidity and savoury character.","intensity":3,"fat":2,"acidity":4,"sweetness":1,"salt":2,"umami":3,"spice":1,"protein":1,"fish":0},
          {"key":"mushroom-risotto","name":"Mushroom risotto","description":"Creamy texture with pronounced mushroom umami.","intensity":3,"fat":3,"acidity":1,"sweetness":0,"salt":2,"umami":4,"spice":0,"protein":1,"fish":0},
          {"key":"aged-cheese","name":"Aged hard cheese","description":"An intense, fatty, salty, and umami-rich cheese.","intensity":4,"fat":4,"acidity":1,"sweetness":0,"salt":4,"umami":4,"spice":0,"protein":3,"fish":0},
          {"key":"fruit-tart","name":"Fruit tart","description":"A sweet dessert; the wine must be at least as sweet as the dish.","intensity":3,"fat":2,"acidity":2,"sweetness":4,"salt":0,"umami":0,"spice":0,"protein":0,"fish":0}
        ]
        $dishes$::jsonb) as dish_seed(
            key text,
            name text,
            description text,
            intensity numeric,
            fat numeric,
            acidity numeric,
            sweetness numeric,
            salt numeric,
            umami numeric,
            spice numeric,
            protein numeric,
            fish numeric
        )
    loop
        v_profile_id := private.enrichment_seed_uuid(
            'profile:pairing-v4:dish:' || v_dish.key
        );

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
            v_profile_id,
            v_version_id,
            'dish',
            'reviewed',
            0.72,
            'Reviewed structural dish hypothesis; ingredients and preparation remain adjustable per request.',
            '2026-08-25T09:00:00Z'
        );

        insert into public.enrichment_dish_profiles (
            profile_id,
            knowledge_version_id,
            dish_key,
            dish_name,
            description,
            intensity,
            fat,
            acidity,
            sweetness,
            salt,
            umami,
            spice,
            protein,
            fish
        )
        values (
            v_profile_id,
            v_version_id,
            v_dish.key,
            v_dish.name,
            v_dish.description,
            v_dish.intensity,
            v_dish.fat,
            v_dish.acidity,
            v_dish.sweetness,
            v_dish.salt,
            v_dish.umami,
            v_dish.spice,
            v_dish.protein,
            v_dish.fish
        );

        insert into public.enrichment_profile_evidence (
            profile_id,
            evidence_id,
            evidence_role
        )
        values (v_profile_id, v_evidence_id, 'supports');
    end loop;

    return public.publish_enrichment_knowledge_version(v_version_id);
end;
$$;

comment on function public.install_pairing_knowledge() is
    'Copies reviewed v3 wine knowledge, adds reviewed dish profiles, and explicitly publishes immutable v4.';

revoke execute on function public.install_pairing_knowledge()
from public, anon, authenticated;

grant execute on function public.install_pairing_knowledge()
to service_role;

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
    v_profile_id uuid;
    v_projection_id uuid;
    v_traits jsonb;
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
        -- Pairing structure does not require a calendar anchor. This exact
        -- place fallback therefore lets a reviewed NV Champagne profile work
        -- without inventing a vintage or maturity window.
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

    if exists (
        select 1
        from jsonb_each_text(v_traits) trait
        where trait.key not in (
            'body', 'acidity', 'tannin', 'sweetness',
            'alcohol', 'freshness', 'savory', 'concentration'
        )
           or (trait.value)::numeric not between 0 and 5
    ) or (
        select count(*)
        from jsonb_object_keys(v_traits)
    ) <> 8 then
        raise exception using
            errcode = '22023',
            message = 'Pairing wine traits must contain eight values between 0 and 5';
    end if;

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

create or replace function public.enqueue_pairing_profile_jobs(
    p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version_id uuid;
    v_enqueued integer;
begin
    if p_limit not between 1 and 500 then
        raise exception using
            errcode = '22023',
            message = 'Pairing enqueue limit must be between 1 and 500';
    end if;

    select version.id into v_version_id
    from public.enrichment_knowledge_versions version
    where version.status = 'active';

    if not found then
        return jsonb_build_object(
            'knowledge_version_id', null,
            'enqueued', 0,
            'reason', 'no-active-knowledge-version'
        );
    end if;

    with candidates as (
        select demand.id
        from public.enrichment_demands demand
        where demand.capability = 'pairing-profile'
          and (
              demand.demand_status = 'queued'
              or (
                  demand.demand_status = 'retrying'
                  and demand.next_attempt_at <= now()
              )
          )
        order by demand.priority desc, demand.requested_at, demand.id
        for update skip locked
        limit p_limit
    ), inserted as (
        insert into public.enrichment_jobs (
            demand_id,
            household_id,
            wine_id,
            capability,
            input_fingerprint,
            knowledge_version_id
        )
        select
            demand.id,
            demand.household_id,
            demand.wine_id,
            demand.capability,
            demand.input_fingerprint,
            v_version_id
        from public.enrichment_demands demand
        join candidates on candidates.id = demand.id
        where not exists (
            select 1
            from public.enrichment_jobs job
            where job.demand_id = demand.id
              and job.knowledge_version_id = v_version_id
              and job.input_fingerprint = demand.input_fingerprint
        )
        returning id
    )
    select count(*)::integer into v_enqueued
    from inserted;

    return jsonb_build_object(
        'knowledge_version_id', v_version_id,
        'enqueued', v_enqueued
    );
end;
$$;

revoke execute on function public.enqueue_pairing_profile_jobs(integer)
from public, anon, authenticated;

grant execute on function public.enqueue_pairing_profile_jobs(integer)
to service_role;

create or replace function public.claim_pairing_profile_jobs(
    p_worker_id text,
    p_limit integer default 10,
    p_lease_seconds integer default 120
)
returns table (
    job_id uuid,
    lease_token uuid,
    demand_id uuid,
    household_id uuid,
    wine_id uuid,
    knowledge_version_id uuid,
    input_fingerprint text,
    attempt_count integer,
    lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_worker_id is null or length(trim(p_worker_id)) = 0 then
        raise exception using
            errcode = '22023',
            message = 'Pairing worker ID is required';
    end if;

    if p_limit not between 1 and 100 then
        raise exception using
            errcode = '22023',
            message = 'Pairing claim limit must be between 1 and 100';
    end if;

    if p_lease_seconds not between 30 and 900 then
        raise exception using
            errcode = '22023',
            message = 'Pairing lease must be between 30 and 900 seconds';
    end if;

    with expired as (
        update public.enrichment_jobs job
        set
            job_status = case
                when job.attempt_count >= job.max_attempts then 'failed'
                else 'retrying'
            end,
            next_attempt_at = case
                when job.attempt_count >= job.max_attempts then null
                else now()
            end,
            lease_token = null,
            leased_by = null,
            lease_expires_at = null,
            last_error_code = 'lease-expired',
            completed_at = case
                when job.attempt_count >= job.max_attempts then now()
                else null
            end,
            updated_at = now()
        where job.capability = 'pairing-profile'
          and job.job_status = 'leased'
          and job.lease_expires_at <= now()
        returning job.demand_id, job.job_status,
                  job.next_attempt_at, job.attempt_count
    )
    update public.enrichment_demands demand
    set
        demand_status = case
            when expired.job_status = 'failed' then 'failed'
            else 'retrying'
        end,
        attempt_count = expired.attempt_count,
        next_attempt_at = expired.next_attempt_at,
        last_attempted_at = now(),
        last_completed_at = null,
        last_error_code = 'lease-expired',
        updated_at = now()
    from expired
    where demand.id = expired.demand_id;

    perform public.enqueue_pairing_profile_jobs(p_limit);

    return query
    with candidates as (
        select job.id
        from public.enrichment_jobs job
        where job.capability = 'pairing-profile'
          and (
              job.job_status = 'queued'
              or (
                  job.job_status = 'retrying'
                  and job.next_attempt_at <= now()
              )
          )
          and job.attempt_count < job.max_attempts
        order by job.created_at, job.id
        for update skip locked
        limit p_limit
    ), claimed as (
        update public.enrichment_jobs job
        set
            job_status = 'leased',
            attempt_count = job.attempt_count + 1,
            next_attempt_at = null,
            lease_token = gen_random_uuid(),
            leased_by = trim(p_worker_id),
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            last_error_code = null,
            updated_at = now()
        from candidates
        where job.id = candidates.id
        returning job.*
    ), updated_demands as (
        update public.enrichment_demands demand
        set
            demand_status = 'matching',
            attempt_count = claimed.attempt_count,
            next_attempt_at = null,
            last_attempted_at = now(),
            last_completed_at = null,
            last_error_code = null,
            updated_at = now()
        from claimed
        where demand.id = claimed.demand_id
        returning demand.id
    )
    select
        claimed.id,
        claimed.lease_token,
        claimed.demand_id,
        claimed.household_id,
        claimed.wine_id,
        claimed.knowledge_version_id,
        claimed.input_fingerprint,
        claimed.attempt_count,
        claimed.lease_expires_at
    from claimed
    join updated_demands on updated_demands.id = claimed.demand_id;
end;
$$;

revoke execute on function public.claim_pairing_profile_jobs(text, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_pairing_profile_jobs(text, integer, integer)
to service_role;

create or replace function public.process_pairing_profile_jobs(
    p_worker_id text default 'database-cron',
    p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_claim record;
    v_result jsonb;
    v_outcome text;
    v_reason text;
    v_processed integer := 0;
    v_completed integer := 0;
    v_needs_review integer := 0;
    v_not_found integer := 0;
    v_retried integer := 0;
begin
    if p_limit not between 1 and 100 then
        raise exception using
            errcode = '22023',
            message = 'Pairing processing limit must be between 1 and 100';
    end if;

    for v_claim in
        select *
        from public.claim_pairing_profile_jobs(p_worker_id, p_limit, 300)
    loop
        v_processed := v_processed + 1;

        begin
            v_result := private.calculate_pairing_wine_profile(v_claim.job_id);
            v_outcome := v_result ->> 'status';
            v_reason := coalesce(v_result ->> 'reason', 'pairing-profile-unavailable');

            if v_outcome = 'complete' then
                perform public.complete_enrichment_job(
                    v_claim.job_id, v_claim.lease_token, 'complete'
                );
                v_completed := v_completed + 1;
            elsif v_outcome = 'not-found' then
                perform public.complete_enrichment_job(
                    v_claim.job_id, v_claim.lease_token,
                    'not-found', v_reason
                );
                v_not_found := v_not_found + 1;
            elsif v_outcome = 'retry' then
                perform public.complete_enrichment_job(
                    v_claim.job_id, v_claim.lease_token,
                    'retry', v_reason, now() + interval '1 minute'
                );
                v_retried := v_retried + 1;
            else
                perform public.complete_enrichment_job(
                    v_claim.job_id, v_claim.lease_token,
                    'needs-review', v_reason
                );
                v_needs_review := v_needs_review + 1;
            end if;
        exception
            when others then
                perform public.complete_enrichment_job(
                    v_claim.job_id, v_claim.lease_token,
                    'retry', 'pairing-calculation-error',
                    now() + interval '5 minutes'
                );
                v_retried := v_retried + 1;
        end;
    end loop;

    return jsonb_build_object(
        'processed', v_processed,
        'completed', v_completed,
        'needs_review', v_needs_review,
        'not_found', v_not_found,
        'retried', v_retried
    );
end;
$$;

comment on function public.process_pairing_profile_jobs(text, integer) is
    'Prepares bounded, attributable wine-side structure for later dish queries.';

revoke execute on function public.process_pairing_profile_jobs(text, integer)
from public, anon, authenticated;

grant execute on function public.process_pairing_profile_jobs(text, integer)
to service_role;

create or replace function private.score_wine_pairing(
    p_wine_traits jsonb,
    p_dish_attributes jsonb,
    p_maturity_state text,
    p_preferred_style text,
    p_previous_verdict text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_body numeric := (p_wine_traits ->> 'body')::numeric;
    v_acidity numeric := (p_wine_traits ->> 'acidity')::numeric;
    v_tannin numeric := (p_wine_traits ->> 'tannin')::numeric;
    v_sweetness numeric := (p_wine_traits ->> 'sweetness')::numeric;
    v_alcohol numeric := (p_wine_traits ->> 'alcohol')::numeric;
    v_freshness numeric := (p_wine_traits ->> 'freshness')::numeric;
    v_savory numeric := (p_wine_traits ->> 'savory')::numeric;
    v_concentration numeric := (p_wine_traits ->> 'concentration')::numeric;
    v_intensity numeric := (p_dish_attributes ->> 'intensity')::numeric;
    v_fat numeric := (p_dish_attributes ->> 'fat')::numeric;
    v_dish_acidity numeric := (p_dish_attributes ->> 'acidity')::numeric;
    v_dish_sweetness numeric := (p_dish_attributes ->> 'sweetness')::numeric;
    v_salt numeric := (p_dish_attributes ->> 'salt')::numeric;
    v_umami numeric := (p_dish_attributes ->> 'umami')::numeric;
    v_spice numeric := (p_dish_attributes ->> 'spice')::numeric;
    v_protein numeric := (p_dish_attributes ->> 'protein')::numeric;
    v_fish numeric := (p_dish_attributes ->> 'fish')::numeric;
    v_score numeric := 82;
    v_intensity_gap numeric;
    v_acidity_deficit numeric;
    v_sweetness_deficit numeric;
    v_heat_risk numeric;
    v_style_adjustment numeric := 0;
    v_personal_adjustment numeric := 0;
    v_reasons text[] := array[]::text[];
    v_cautions text[] := array[]::text[];
    v_rounded integer;
begin
    v_intensity_gap := abs(v_body - v_intensity);
    v_score := v_score - v_intensity_gap * 7;
    if v_intensity_gap <= 0.8 then
        v_reasons := array_append(
            v_reasons,
            'Wine and dish intensity are well matched.'
        );
    elsif v_intensity_gap > 2 then
        v_cautions := array_append(
            v_cautions,
            'The wine and dish differ substantially in intensity.'
        );
    end if;

    v_acidity_deficit := v_dish_acidity - v_acidity;
    if v_acidity_deficit > 0.5 then
        v_score := v_score - v_acidity_deficit * 11;
        v_cautions := array_append(
            v_cautions,
            'The dish may make this wine seem insufficiently fresh.'
        );
    elsif v_dish_acidity >= 3 and v_acidity >= v_dish_acidity - 0.5 then
        v_score := v_score + 5;
        v_reasons := array_append(
            v_reasons,
            'Its acidity can stand up to the dish.'
        );
    end if;

    v_sweetness_deficit := v_dish_sweetness - v_sweetness;
    if v_sweetness_deficit > 0 then
        v_score := v_score - v_sweetness_deficit * 18;
        v_cautions := array_append(
            v_cautions,
            'The dish is sweeter than the wine.'
        );
    end if;

    if v_fat >= 3 then
        v_score := v_score + (v_acidity + v_tannin) * 1.2;
        v_reasons := array_append(
            v_reasons,
            'Acidity and structure can balance the richness.'
        );
    end if;

    if v_protein >= 3 then
        v_score := v_score + v_tannin * 1.5;
    end if;

    if v_fish >= 3 and v_tannin > 2.5 then
        v_score := v_score - (v_tannin - 2.5) * v_fish * 3;
        v_cautions := array_append(
            v_cautions,
            'Tannin may become metallic or harsh with the fish.'
        );
    end if;

    if v_umami >= 3 then
        v_score := v_score + v_savory * 1.2;
        v_score := v_score - greatest(0, v_tannin - 3.5) * v_umami * 1.5;
        if v_savory >= 3.5 then
            v_reasons := array_append(
                v_reasons,
                'The wine''s savoury character echoes the dish''s umami.'
            );
        end if;
    end if;

    if v_spice >= 3 then
        v_heat_risk := greatest(0, v_alcohol - 3.5)
            + greatest(0, v_tannin - 3.5);
        v_score := v_score - v_heat_risk * v_spice * 1.5;
        v_score := v_score + greatest(0, v_freshness - 3) * 1.5;
        if v_heat_risk > 1 then
            v_cautions := array_append(
                v_cautions,
                'High alcohol or firm tannin may amplify chilli heat.'
            );
        else
            v_reasons := array_append(
                v_reasons,
                'Moderate alcohol and tannin limit the spice risk.'
            );
        end if;
    end if;

    if v_salt >= 3 and v_freshness >= 3.5 then
        v_score := v_score + 4;
        v_reasons := array_append(
            v_reasons,
            'Freshness should work well with the salt.'
        );
    end if;

    v_score := v_score + case p_maturity_state
        when 'hold' then -25
        when 'assess' then -6
        when 'ready' then 4
        when 'priority' then 7
        when 'assess-now' then 2
        else -2
    end;

    if p_maturity_state = 'hold' then
        v_cautions := array_append(
            v_cautions,
            'The maturity model recommends holding this bottle.'
        );
    elsif p_maturity_state = 'priority' then
        v_reasons := array_append(
            v_reasons,
            'This bottle should be prioritised according to its maturity window.'
        );
    elsif p_maturity_state = 'ready' then
        v_reasons := array_append(
            v_reasons,
            'The bottle is inside its likely drinking period.'
        );
    elsif p_maturity_state is null then
        v_cautions := array_append(
            v_cautions,
            'No maturity window is available, so readiness is uncertain.'
        );
    end if;

    v_style_adjustment := case p_preferred_style
        when 'fresh' then (v_acidity + v_freshness - 5) * 2
        when 'light' then (7 - v_body - v_alcohol) * 2
        when 'rich' then (v_body + v_concentration - 5) * 2
        when 'savory' then (v_savory - 2.5) * 3
        when 'mature' then case
            when p_maturity_state in ('ready', 'priority', 'assess-now') then 8
            else -5
        end
        else 0
    end;
    v_score := v_score + v_style_adjustment;

    if p_preferred_style is not null and v_style_adjustment >= 3 then
        v_reasons := array_append(
            v_reasons,
            format('It fits your %s style preference.', p_preferred_style)
        );
    elsif p_preferred_style is not null and v_style_adjustment <= -3 then
        v_cautions := array_append(
            v_cautions,
            format('It is a weak fit for your %s style preference.', p_preferred_style)
        );
    end if;

    v_personal_adjustment := case p_previous_verdict
        when 'useful' then 6
        when 'questionable' then -4
        when 'wrong' then -18
        else 0
    end;
    v_score := v_score + v_personal_adjustment;

    if v_personal_adjustment > 0 then
        v_reasons := array_append(
            v_reasons,
            'You previously liked this wine with this dish profile.'
        );
    elsif v_personal_adjustment < 0 then
        v_cautions := array_append(
            v_cautions,
            'Your previous feedback lowers this personal recommendation.'
        );
    end if;

    v_rounded := round(greatest(0, least(100, v_score)))::integer;

    return jsonb_build_object(
        'score', v_rounded,
        'base_score', round(greatest(
            0,
            least(100, v_score - v_style_adjustment - v_personal_adjustment)
        ))::integer,
        'style_adjustment', round(v_style_adjustment)::integer,
        'personal_adjustment', round(v_personal_adjustment)::integer,
        'suitable', v_rounded >= 55
            and (v_dish_sweetness < 3 or v_sweetness_deficit <= 0.75),
        'reasons', to_jsonb(v_reasons[1:5]),
        'cautions', to_jsonb(v_cautions[1:4])
    );
end;
$$;

revoke execute on function private.score_wine_pairing(
    jsonb, jsonb, text, text, text
)
from public, anon, authenticated;

grant execute on function private.score_wine_pairing(
    jsonb, jsonb, text, text, text
)
to service_role;

create or replace function public.get_pairing_dish_profiles(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_version_id uuid;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Household membership is required';
    end if;

    select version.id into v_version_id
    from public.enrichment_knowledge_versions version
    where version.status = 'active';

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'key', dish.dish_key,
                'name', dish.dish_name,
                'description', dish.description,
                'confidence', profile.confidence,
                'attributes', jsonb_build_object(
                    'intensity', dish.intensity,
                    'fat', dish.fat,
                    'acidity', dish.acidity,
                    'sweetness', dish.sweetness,
                    'salt', dish.salt,
                    'umami', dish.umami,
                    'spice', dish.spice,
                    'protein', dish.protein,
                    'fish', dish.fish
                ),
                'preference', case
                    when preference.user_id is null then null
                    else jsonb_build_object(
                        'preferred_colors', preference.preferred_colors,
                        'preferred_style', preference.preferred_style,
                        'updated_at', preference.updated_at
                    )
                end
            )
            order by dish.dish_name
        ),
        '[]'::jsonb
    )
    into v_result
    from public.enrichment_dish_profiles dish
    join public.enrichment_profiles profile on profile.id = dish.profile_id
    left join public.wine_pairing_preferences preference
      on preference.household_id = p_household_id
     and preference.user_id = v_user_id
     and preference.dish_key = dish.dish_key
    where dish.knowledge_version_id = v_version_id;

    return v_result;
end;
$$;

create or replace function public.set_pairing_preference(
    p_household_id uuid,
    p_dish_key text,
    p_preferred_colors text[],
    p_preferred_style text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_dish_key text := lower(trim(p_dish_key));
    v_colors text[];
    v_style text := nullif(lower(trim(p_preferred_style)), '');
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Household membership is required';
    end if;

    if not exists (
        select 1
        from public.enrichment_dish_profiles dish
        join public.enrichment_knowledge_versions version
          on version.id = dish.knowledge_version_id
         and version.status = 'active'
        where dish.dish_key = v_dish_key
    ) then
        raise exception using
            errcode = '22023',
            message = 'Unknown pairing dish profile';
    end if;

    select coalesce(array_agg(color order by color), '{}'::text[])
    into v_colors
    from (
        select distinct lower(trim(value)) as color
        from unnest(coalesce(p_preferred_colors, '{}'::text[])) item(value)
        where length(trim(value)) > 0
    ) normalized;

    if not v_colors <@ array[
        'red', 'white', 'rose', 'sparkling',
        'sweet', 'fortified', 'other'
    ]::text[] then
        raise exception using
            errcode = '22023',
            message = 'Unsupported wine color preference';
    end if;

    if v_style is not null
       and v_style not in ('fresh', 'light', 'rich', 'savory', 'mature') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported pairing style preference';
    end if;

    if cardinality(v_colors) = 0 and v_style is null then
        delete from public.wine_pairing_preferences preference
        where preference.household_id = p_household_id
          and preference.user_id = v_user_id
          and preference.dish_key = v_dish_key;

        return jsonb_build_object(
            'dish_key', v_dish_key,
            'preferred_colors', '[]'::jsonb,
            'preferred_style', null,
            'saved', false
        );
    end if;

    insert into public.wine_pairing_preferences (
        household_id,
        user_id,
        dish_key,
        preferred_colors,
        preferred_style
    )
    values (
        p_household_id,
        v_user_id,
        v_dish_key,
        v_colors,
        v_style
    )
    on conflict (household_id, user_id, dish_key)
    do update set
        preferred_colors = excluded.preferred_colors,
        preferred_style = excluded.preferred_style,
        updated_at = now();

    return jsonb_build_object(
        'dish_key', v_dish_key,
        'preferred_colors', to_jsonb(v_colors),
        'preferred_style', v_style,
        'saved', true
    );
end;
$$;

revoke execute on function public.get_pairing_dish_profiles(uuid)
from public, anon;
revoke execute on function public.set_pairing_preference(uuid, text, text[], text)
from public, anon;

grant execute on function public.get_pairing_dish_profiles(uuid)
to authenticated;
grant execute on function public.set_pairing_preference(uuid, text, text[], text)
to authenticated;

create or replace function public.get_pairing_suggestions(
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
    v_user_id uuid := (select auth.uid());
    v_version_id uuid;
    v_dish_profile_id uuid;
    v_dish_name text;
    v_default_attributes jsonb;
    v_dish_confidence numeric;
    v_dish_key text := lower(trim(p_dish_key));
    v_attributes jsonb;
    v_colors text[];
    v_style text := nullif(lower(trim(p_preferred_style)), '');
    v_context_hash text;
    v_context_key text;
    v_candidate record;
    v_projection_id uuid;
    v_projection_fingerprint text;
    v_feedback text;
    v_suggestions jsonb := '[]'::jsonb;
    v_best_rejected jsonb := null;
    v_suggestion_count integer := 0;
    v_profile_count integer := 0;
    v_candidate_count integer := 0;
    v_stock_count integer := 0;
    v_pending_count integer := 0;
    v_confidence numeric;
    v_confidence_label text;
    v_order integer;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Household membership is required';
    end if;

    if p_limit not between 1 and 10 then
        raise exception using
            errcode = '22023',
            message = 'Pairing suggestion limit must be between 1 and 10';
    end if;

    select version.id into v_version_id
    from public.enrichment_knowledge_versions version
    where version.status = 'active';

    select
        dish.profile_id,
        dish.dish_name,
        profile.confidence,
        jsonb_build_object(
            'intensity', dish.intensity,
            'fat', dish.fat,
            'acidity', dish.acidity,
            'sweetness', dish.sweetness,
            'salt', dish.salt,
            'umami', dish.umami,
            'spice', dish.spice,
            'protein', dish.protein,
            'fish', dish.fish
        )
    into
        v_dish_profile_id,
        v_dish_name,
        v_dish_confidence,
        v_default_attributes
    from public.enrichment_dish_profiles dish
    join public.enrichment_profiles profile on profile.id = dish.profile_id
    where dish.knowledge_version_id = v_version_id
      and dish.dish_key = v_dish_key;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Unknown pairing dish profile';
    end if;

    v_attributes := coalesce(p_dish_attributes, v_default_attributes);

    if jsonb_typeof(v_attributes) <> 'object'
       or (
           select count(*)
           from jsonb_object_keys(v_attributes)
       ) <> 9
       or exists (
           select 1
           from jsonb_each_text(v_attributes) attribute
           where attribute.key not in (
               'intensity', 'fat', 'acidity', 'sweetness', 'salt',
               'umami', 'spice', 'protein', 'fish'
           )
              or (attribute.value)::numeric not between 0 and 5
       ) then
        raise exception using
            errcode = '22023',
            message = 'Dish attributes must contain nine values between 0 and 5';
    end if;

    -- Rebuild in fixed key order so equivalent requests share one context.
    v_attributes := jsonb_build_object(
        'intensity', (v_attributes ->> 'intensity')::numeric,
        'fat', (v_attributes ->> 'fat')::numeric,
        'acidity', (v_attributes ->> 'acidity')::numeric,
        'sweetness', (v_attributes ->> 'sweetness')::numeric,
        'salt', (v_attributes ->> 'salt')::numeric,
        'umami', (v_attributes ->> 'umami')::numeric,
        'spice', (v_attributes ->> 'spice')::numeric,
        'protein', (v_attributes ->> 'protein')::numeric,
        'fish', (v_attributes ->> 'fish')::numeric
    );

    select coalesce(array_agg(color order by color), '{}'::text[])
    into v_colors
    from (
        select distinct lower(trim(value)) as color
        from unnest(coalesce(p_preferred_colors, '{}'::text[])) item(value)
        where length(trim(value)) > 0
    ) normalized;

    if not v_colors <@ array[
        'red', 'white', 'rose', 'sparkling',
        'sweet', 'fortified', 'other'
    ]::text[] then
        raise exception using
            errcode = '22023',
            message = 'Unsupported wine color preference';
    end if;

    if v_style is not null
       and v_style not in ('fresh', 'light', 'rich', 'savory', 'mature') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported pairing style preference';
    end if;

    v_context_hash := pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(
                jsonb_build_object(
                    'user_id', v_user_id,
                    'dish_profile_id', v_dish_profile_id,
                    'attributes', v_attributes,
                    'preferred_colors', to_jsonb(v_colors),
                    'preferred_style', v_style
                )::text,
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    );
    v_context_key := 'dish:' || v_dish_key || ':' || left(v_context_hash, 32);

    select count(distinct holding.wine_id)::integer into v_stock_count
    from public.holdings holding
    where holding.household_id = p_household_id
      and holding.quantity > 0;

    select count(distinct profile.wine_id)::integer into v_candidate_count
    from public.wine_enrichment_projections profile
    join public.holdings holding
      on holding.household_id = profile.household_id
     and holding.wine_id = profile.wine_id
     and holding.quantity > 0
    where profile.household_id = p_household_id
      and profile.knowledge_version_id = v_version_id
      and profile.projection_type = 'pairing'
      and profile.context_key = 'wine-profile'
      and profile.status = 'current'
      and (
          cardinality(v_colors) = 0
          or profile.recommendation ->> 'wine_color' = any(v_colors)
      );

    select count(distinct profile.wine_id)::integer into v_profile_count
    from public.wine_enrichment_projections profile
    join public.holdings holding
      on holding.household_id = profile.household_id
     and holding.wine_id = profile.wine_id
     and holding.quantity > 0
    where profile.household_id = p_household_id
      and profile.knowledge_version_id = v_version_id
      and profile.projection_type = 'pairing'
      and profile.context_key = 'wine-profile'
      and profile.status = 'current';

    select count(distinct demand.wine_id)::integer into v_pending_count
    from public.enrichment_demands demand
    join public.holdings holding
      on holding.household_id = demand.household_id
     and holding.wine_id = demand.wine_id
     and holding.quantity > 0
    where demand.household_id = p_household_id
      and demand.capability = 'pairing-profile'
      and demand.demand_status in ('queued', 'matching', 'retrying');

    for v_candidate in
        with stock as (
            select
                holding.wine_id,
                sum(holding.quantity)::integer as quantity,
                jsonb_agg(
                    jsonb_build_object(
                        'cellar', cellar.name,
                        'location', location.code,
                        'quantity', holding.quantity
                    )
                    order by cellar.name,
                             location.display_order, location.code
                ) as locations
            from public.holdings holding
            join public.locations location on location.id = holding.location_id
            join public.cellars cellar on cellar.id = location.cellar_id
            where holding.household_id = p_household_id
              and holding.quantity > 0
            group by holding.wine_id
        )
        select
            wine.id as wine_id,
            wine.producer,
            wine.cuvee,
            wine.vintage,
            wine.color,
            wine.appellation,
            wine.area,
            wine.format_ml,
            wine.wine_reference_id,
            wine.wine_reference_type,
            stock.quantity,
            stock.locations,
            profile.id as profile_projection_id,
            profile.input_fingerprint as profile_fingerprint,
            profile.specificity,
            profile.confidence as profile_confidence,
            profile.recommendation -> 'traits' as traits,
            profile.recommendation -> 'warnings' as profile_warnings,
            maturity.id as maturity_projection_id,
            maturity.confidence as maturity_confidence,
            maturity.recommendation ->> 'state' as maturity_state,
            previous.verdict as previous_verdict,
            private.score_wine_pairing(
                profile.recommendation -> 'traits',
                v_attributes,
                maturity.recommendation ->> 'state',
                v_style,
                previous.verdict
            ) as score_payload
        from stock
        join public.wines wine on wine.id = stock.wine_id
        join public.wine_enrichment_projections profile
          on profile.household_id = p_household_id
         and profile.wine_id = wine.id
         and profile.knowledge_version_id = v_version_id
         and profile.projection_type = 'pairing'
         and profile.context_key = 'wine-profile'
         and profile.status = 'current'
        left join public.wine_enrichment_projections maturity
          on maturity.household_id = p_household_id
         and maturity.wine_id = wine.id
         and maturity.knowledge_version_id = v_version_id
         and maturity.projection_type = 'maturity'
         and maturity.context_key = ''
         and maturity.status = 'current'
        left join lateral (
            select feedback.verdict
            from public.wine_enrichment_projections old_projection
            join public.wine_enrichment_projection_feedback feedback
              on feedback.projection_id = old_projection.id
             and feedback.reviewed_by = v_user_id
            where old_projection.household_id = p_household_id
              and old_projection.wine_id = wine.id
              and old_projection.projection_type = 'pairing'
              and old_projection.context_key <> 'wine-profile'
              and old_projection.recommendation ->> 'dish_key' = v_dish_key
            order by feedback.updated_at desc
            limit 1
        ) previous on true
        where cardinality(v_colors) = 0
           or profile.recommendation ->> 'wine_color' = any(v_colors)
        order by
            (private.score_wine_pairing(
                profile.recommendation -> 'traits',
                v_attributes,
                maturity.recommendation ->> 'state',
                v_style,
                previous.verdict
            ) ->> 'score')::integer desc,
            wine.id
        limit 50
    loop
        if not (v_candidate.score_payload ->> 'suitable')::boolean then
            if v_best_rejected is null then
                v_best_rejected := jsonb_build_object(
                    'wine_id', v_candidate.wine_id,
                    'producer', v_candidate.producer,
                    'cuvee', v_candidate.cuvee,
                    'vintage', v_candidate.vintage,
                    'color', v_candidate.color,
                    'score_label', case
                        when (v_candidate.score_payload ->> 'score')::integer >= 45
                            then 'Close, but not recommended'
                        else 'Poor structural match'
                    end,
                    'reasons', v_candidate.score_payload -> 'reasons',
                    'cautions', v_candidate.score_payload -> 'cautions'
                );
            end if;
            continue;
        end if;

        if v_suggestion_count >= p_limit then
            continue;
        end if;

        v_confidence := least(
            v_candidate.profile_confidence,
            v_dish_confidence,
            coalesce(
                v_candidate.maturity_confidence,
                v_candidate.profile_confidence * 0.8
            )
        );
        v_confidence_label := case
            when v_confidence >= 0.75 then 'high'
            when v_confidence >= 0.5 then 'medium'
            else 'low'
        end;

        v_projection_fingerprint := pg_catalog.encode(
            extensions.digest(
                pg_catalog.convert_to(
                    concat_ws(
                        ':',
                        v_candidate.profile_fingerprint,
                        v_context_hash,
                        coalesce(v_candidate.maturity_projection_id::text, 'no-maturity'),
                        coalesce(v_candidate.previous_verdict, 'no-feedback')
                    ),
                    'UTF8'
                ),
                'sha256'
            ),
            'hex'
        );

        v_projection_id := null;
        select projection.id into v_projection_id
        from public.wine_enrichment_projections projection
        where projection.household_id = p_household_id
          and projection.wine_id = v_candidate.wine_id
          and projection.knowledge_version_id = v_version_id
          and projection.projection_type = 'pairing'
          and projection.context_key = v_context_key
          and projection.input_fingerprint = v_projection_fingerprint
          and projection.status = 'current';

        if not found then
            update public.wine_enrichment_projections projection
            set status = 'superseded'
            where projection.household_id = p_household_id
              and projection.wine_id = v_candidate.wine_id
              and projection.projection_type = 'pairing'
              and projection.context_key = v_context_key
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
                p_household_id,
                v_candidate.wine_id,
                v_candidate.wine_reference_id,
                v_candidate.wine_reference_type,
                v_version_id,
                'pairing',
                v_context_key,
                'curated-inference',
                v_candidate.specificity,
                v_confidence,
                v_projection_fingerprint,
                jsonb_build_object(
                    'schema_version', 1,
                    'kind', 'dish-match',
                    'dish_key', v_dish_key,
                    'dish_name', v_dish_name,
                    'dish_attributes', v_attributes,
                    'preferred_colors', to_jsonb(v_colors),
                    'preferred_style', v_style,
                    'score', (v_candidate.score_payload ->> 'score')::integer,
                    'score_label', case
                        when (v_candidate.score_payload ->> 'score')::integer >= 80
                            then 'Excellent match'
                        when (v_candidate.score_payload ->> 'score')::integer >= 68
                            then 'Strong match'
                        else 'Possible match'
                    end,
                    'base_score', (v_candidate.score_payload ->> 'base_score')::integer,
                    'style_adjustment', (v_candidate.score_payload ->> 'style_adjustment')::integer,
                    'personal_adjustment', (v_candidate.score_payload ->> 'personal_adjustment')::integer,
                    'maturity_state', v_candidate.maturity_state,
                    'confidence_label', v_confidence_label,
                    'reasons', v_candidate.score_payload -> 'reasons',
                    'cautions', v_candidate.score_payload -> 'cautions',
                    'profile_warnings', coalesce(v_candidate.profile_warnings, '[]'::jsonb)
                )
            )
            returning id into v_projection_id;

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
            where link.projection_id = v_candidate.profile_projection_id;

            select coalesce(max(link.contribution_order), 0) + 1
            into v_order
            from public.wine_enrichment_projection_profiles link
            where link.projection_id = v_projection_id;

            insert into public.wine_enrichment_projection_profiles (
                projection_id,
                knowledge_version_id,
                profile_id,
                contribution_order
            )
            values (
                v_projection_id,
                v_version_id,
                v_dish_profile_id,
                v_order
            );

            insert into public.wine_enrichment_projection_evidence (
                projection_id,
                evidence_id
            )
            select v_projection_id, link.evidence_id
            from public.wine_enrichment_projection_evidence link
            where link.projection_id = v_candidate.profile_projection_id
            on conflict do nothing;

            insert into public.wine_enrichment_projection_evidence (
                projection_id,
                evidence_id
            )
            select v_projection_id, link.evidence_id
            from public.enrichment_profile_evidence link
            where link.profile_id = v_dish_profile_id
            on conflict do nothing;
        end if;

        select feedback.verdict into v_feedback
        from public.wine_enrichment_projection_feedback feedback
        where feedback.projection_id = v_projection_id
          and feedback.reviewed_by = v_user_id;

        v_suggestions := v_suggestions || jsonb_build_array(
            jsonb_build_object(
                'projection_id', v_projection_id,
                'wine_id', v_candidate.wine_id,
                'producer', v_candidate.producer,
                'cuvee', v_candidate.cuvee,
                'vintage', v_candidate.vintage,
                'color', v_candidate.color,
                'appellation', v_candidate.appellation,
                'area', v_candidate.area,
                'format_ml', v_candidate.format_ml,
                'quantity', v_candidate.quantity,
                'locations', v_candidate.locations,
                'score_label', case
                    when (v_candidate.score_payload ->> 'score')::integer >= 80
                        then 'Excellent match'
                    when (v_candidate.score_payload ->> 'score')::integer >= 68
                        then 'Strong match'
                    else 'Possible match'
                end,
                'confidence_label', v_confidence_label,
                'maturity_state', v_candidate.maturity_state,
                'reasons', v_candidate.score_payload -> 'reasons',
                'cautions', v_candidate.score_payload -> 'cautions',
                'feedback_verdict', v_feedback
            )
        );
        v_suggestion_count := v_suggestion_count + 1;
    end loop;

    return jsonb_build_object(
        'status', case
            when v_suggestion_count > 0 then 'suggestions'
            when v_profile_count = 0 and v_pending_count > 0 then 'preparing'
            when v_profile_count = 0 then 'not-assessed'
            else 'no-suitable-wine'
        end,
        'dish', jsonb_build_object(
            'key', v_dish_key,
            'name', v_dish_name,
            'attributes', v_attributes
        ),
        'preferred_colors', to_jsonb(v_colors),
        'preferred_style', v_style,
        'stock_wines', v_stock_count,
        'assessed_candidates', v_candidate_count,
        'unavailable_profiles', greatest(0, v_stock_count - v_profile_count),
        'suggestions', v_suggestions,
        'best_rejected', v_best_rejected
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
to authenticated;

create or replace function public.review_wine_pairing_projection(
    p_projection_id uuid,
    p_verdict text,
    p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_projection public.wine_enrichment_projections%rowtype;
    v_note text := nullif(trim(p_note), '');
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_verdict not in ('useful', 'questionable', 'wrong') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported pairing verdict';
    end if;

    select projection.* into v_projection
    from public.wine_enrichment_projections projection
    where projection.id = p_projection_id
      and projection.projection_type = 'pairing'
      and projection.context_key <> 'wine-profile'
      and projection.status = 'current';

    if not found or not exists (
        select 1
        from public.household_members member
        where member.household_id = v_projection.household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'Current household pairing projection is required';
    end if;

    insert into public.wine_enrichment_projection_feedback (
        projection_id,
        household_id,
        wine_id,
        reviewed_by,
        verdict,
        note
    )
    values (
        v_projection.id,
        v_projection.household_id,
        v_projection.wine_id,
        v_user_id,
        p_verdict,
        v_note
    )
    on conflict (projection_id, reviewed_by)
    do update set
        verdict = excluded.verdict,
        note = excluded.note,
        updated_at = now();

    return jsonb_build_object(
        'projection_id', v_projection.id,
        'verdict', p_verdict,
        'note', v_note,
        'saved', true
    );
end;
$$;

revoke execute on function public.review_wine_pairing_projection(uuid, text, text)
from public, anon;

grant execute on function public.review_wine_pairing_projection(uuid, text, text)
to authenticated;

do $$
declare
    v_existing_job_id bigint;
begin
    select job.jobid into v_existing_job_id
    from cron.job job
    where job.jobname = 'cellarmanager-pairing-profiles';

    if found then
        perform cron.unschedule(v_existing_job_id);
    end if;

    perform cron.schedule(
        'cellarmanager-pairing-profiles',
        '* * * * *',
        $cron$select public.process_pairing_profile_jobs('database-cron', 100);$cron$
    );
end
$$;

comment on table public.enrichment_dish_profiles is
    'Reviewed structural dish inputs published inside immutable shared knowledge versions.';

comment on table public.wine_pairing_preferences is
    'Personal dish color/style defaults that refine only one member ranking.';

comment on function public.get_pairing_suggestions(
    uuid, text, jsonb, text[], text, integer
) is
    'Ranks in-stock household wines for one reviewed, adjustable dish profile and retains attributable projections.';

commit;
