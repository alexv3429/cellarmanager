begin;

-- Knowledge v3 keeps the published v1/v2 rows immutable and adds the three
-- material layers proven by the hierarchy POC: a place adjustment inherited
-- through the geographic tree, a producer/vintage interaction, and an exact
-- release adjustment.
alter table public.enrichment_places
    drop constraint enrichment_places_type_check;

alter table public.enrichment_places
    add constraint enrichment_places_type_check
        check (
            place_type in (
                'country',
                'region',
                'subregion',
                'appellation',
                'classification',
                'climat',
                'site',
                'parcel',
                'other'
            )
        );

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
                'release'
            )
        );

alter table public.wine_enrichment_projections
    drop constraint wine_enrichment_projections_specificity_check;

alter table public.wine_enrichment_projections
    add constraint wine_enrichment_projections_specificity_check
        check (
            specificity in (
                'exact-release',
                'exact-product',
                'nearby-vintage',
                'comparable-profile',
                'regional-style',
                'owner-maintained',
                'region',
                'place',
                'producer-era',
                'cuvee',
                'release'
            )
        );

alter table public.enrichment_place_profiles
    add column concentration numeric(3, 2) not null default 0
        check (concentration between 0 and 5);

alter table public.enrichment_vintage_profiles
    add column condition_tags text[] not null default '{}'::text[],
    add column concentration_adjustment numeric(3, 2) not null default 0
        check (concentration_adjustment between -5 and 5),
    add constraint enrichment_vintage_profiles_condition_tags_check
        check (
            cardinality(condition_tags) <= 16
            and array_position(condition_tags, null) is null
        );

alter table public.enrichment_producer_era_profiles
    add column concentration_adjustment numeric(3, 2) not null default 0
        check (concentration_adjustment between -5 and 5);

alter table public.enrichment_cuvee_profiles
    add column concentration_adjustment numeric(3, 2) not null default 0
        check (concentration_adjustment between -5 and 5);

create table public.enrichment_place_adjustment_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'place-adjustment',
    place_id uuid not null references public.enrichment_places(id),
    wine_color text not null,
    first_trial_age_adjustment integer not null default 0,
    best_start_age_adjustment integer not null default 0,
    best_end_age_adjustment integer not null default 0,
    outer_horizon_age_adjustment integer not null default 0,
    body_adjustment numeric(3, 2) not null default 0,
    acidity_adjustment numeric(3, 2) not null default 0,
    tannin_adjustment numeric(3, 2) not null default 0,
    sweetness_adjustment numeric(3, 2) not null default 0,
    alcohol_adjustment numeric(3, 2) not null default 0,
    freshness_adjustment numeric(3, 2) not null default 0,
    savory_adjustment numeric(3, 2) not null default 0,
    concentration_adjustment numeric(3, 2) not null default 0,

    constraint enrichment_place_adjustment_profiles_type_check
        check (profile_type = 'place-adjustment'),
    constraint enrichment_place_adjustment_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(id, knowledge_version_id, profile_type)
        on delete cascade,
    constraint enrichment_place_adjustment_profiles_unique
        unique (knowledge_version_id, place_id, wine_color),
    constraint enrichment_place_adjustment_profiles_color_check
        check (wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    constraint enrichment_place_adjustment_profiles_age_check
        check (
            first_trial_age_adjustment between -50 and 50
            and best_start_age_adjustment between -50 and 50
            and best_end_age_adjustment between -50 and 50
            and outer_horizon_age_adjustment between -50 and 50
        ),
    constraint enrichment_place_adjustment_profiles_traits_check
        check (
            body_adjustment between -5 and 5
            and acidity_adjustment between -5 and 5
            and tannin_adjustment between -5 and 5
            and sweetness_adjustment between -5 and 5
            and alcohol_adjustment between -5 and 5
            and freshness_adjustment between -5 and 5
            and savory_adjustment between -5 and 5
            and concentration_adjustment between -5 and 5
        )
);

create table public.enrichment_producer_vintage_interaction_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'producer-vintage-interaction',
    producer_era_profile_id uuid not null
        references public.enrichment_producer_era_profiles(profile_id),
    required_condition_tags text[] not null,
    first_trial_age_adjustment integer not null default 0,
    best_start_age_adjustment integer not null default 0,
    best_end_age_adjustment integer not null default 0,
    outer_horizon_age_adjustment integer not null default 0,
    body_adjustment numeric(3, 2) not null default 0,
    acidity_adjustment numeric(3, 2) not null default 0,
    tannin_adjustment numeric(3, 2) not null default 0,
    sweetness_adjustment numeric(3, 2) not null default 0,
    alcohol_adjustment numeric(3, 2) not null default 0,
    freshness_adjustment numeric(3, 2) not null default 0,
    savory_adjustment numeric(3, 2) not null default 0,
    concentration_adjustment numeric(3, 2) not null default 0,

    constraint enrichment_producer_vintage_interaction_profiles_type_check
        check (profile_type = 'producer-vintage-interaction'),
    constraint enrichment_producer_vintage_interaction_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(id, knowledge_version_id, profile_type)
        on delete cascade,
    constraint enrichment_producer_vintage_interaction_profiles_unique
        unique (knowledge_version_id, producer_era_profile_id, required_condition_tags),
    constraint enrichment_producer_vintage_interaction_profiles_tags_check
        check (
            cardinality(required_condition_tags) between 1 and 16
            and array_position(required_condition_tags, null) is null
        ),
    constraint enrichment_producer_vintage_interaction_profiles_age_check
        check (
            first_trial_age_adjustment between -50 and 50
            and best_start_age_adjustment between -50 and 50
            and best_end_age_adjustment between -50 and 50
            and outer_horizon_age_adjustment between -50 and 50
        ),
    constraint enrichment_producer_vintage_interaction_profiles_traits_check
        check (
            body_adjustment between -5 and 5
            and acidity_adjustment between -5 and 5
            and tannin_adjustment between -5 and 5
            and sweetness_adjustment between -5 and 5
            and alcohol_adjustment between -5 and 5
            and freshness_adjustment between -5 and 5
            and savory_adjustment between -5 and 5
            and concentration_adjustment between -5 and 5
        )
);

create table public.enrichment_release_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'release',
    release_id uuid not null references public.wine_reference_releases(id),
    wine_color text not null,
    first_trial_age_adjustment integer not null default 0,
    best_start_age_adjustment integer not null default 0,
    best_end_age_adjustment integer not null default 0,
    outer_horizon_age_adjustment integer not null default 0,
    body_adjustment numeric(3, 2) not null default 0,
    acidity_adjustment numeric(3, 2) not null default 0,
    tannin_adjustment numeric(3, 2) not null default 0,
    sweetness_adjustment numeric(3, 2) not null default 0,
    alcohol_adjustment numeric(3, 2) not null default 0,
    freshness_adjustment numeric(3, 2) not null default 0,
    savory_adjustment numeric(3, 2) not null default 0,
    concentration_adjustment numeric(3, 2) not null default 0,

    constraint enrichment_release_profiles_type_check
        check (profile_type = 'release'),
    constraint enrichment_release_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(id, knowledge_version_id, profile_type)
        on delete cascade,
    constraint enrichment_release_profiles_unique
        unique (knowledge_version_id, release_id, wine_color),
    constraint enrichment_release_profiles_color_check
        check (wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    constraint enrichment_release_profiles_age_check
        check (
            first_trial_age_adjustment between -50 and 50
            and best_start_age_adjustment between -50 and 50
            and best_end_age_adjustment between -50 and 50
            and outer_horizon_age_adjustment between -50 and 50
        ),
    constraint enrichment_release_profiles_traits_check
        check (
            body_adjustment between -5 and 5
            and acidity_adjustment between -5 and 5
            and tannin_adjustment between -5 and 5
            and sweetness_adjustment between -5 and 5
            and alcohol_adjustment between -5 and 5
            and freshness_adjustment between -5 and 5
            and savory_adjustment between -5 and 5
            and concentration_adjustment between -5 and 5
        )
);

alter table public.enrichment_place_adjustment_profiles enable row level security;
alter table public.enrichment_producer_vintage_interaction_profiles enable row level security;
alter table public.enrichment_release_profiles enable row level security;

revoke all privileges on table
    public.enrichment_place_adjustment_profiles,
    public.enrichment_producer_vintage_interaction_profiles,
    public.enrichment_release_profiles
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.enrichment_place_adjustment_profiles,
    public.enrichment_producer_vintage_interaction_profiles,
    public.enrichment_release_profiles
to service_role;

create trigger enrichment_place_adjustment_profiles_require_draft
before insert or update or delete on public.enrichment_place_adjustment_profiles
for each row execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_producer_vintage_interaction_profiles_require_draft
before insert or update or delete on public.enrichment_producer_vintage_interaction_profiles
for each row execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_release_profiles_require_draft
before insert or update or delete on public.enrichment_release_profiles
for each row execute function private.require_draft_enrichment_profile_version();

create constraint trigger enrichment_place_adjustment_profiles_shape
after delete on public.enrichment_place_adjustment_profiles
deferrable initially deferred
for each row execute function private.validate_enrichment_profile_shape();

create constraint trigger enrichment_producer_vintage_interaction_profiles_shape
after delete on public.enrichment_producer_vintage_interaction_profiles
deferrable initially deferred
for each row execute function private.validate_enrichment_profile_shape();

create constraint trigger enrichment_release_profiles_shape
after delete on public.enrichment_release_profiles
deferrable initially deferred
for each row execute function private.validate_enrichment_profile_shape();

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
       ) then
        raise exception using
            errcode = '23514',
            message = 'Enrichment profile requires exactly one matching typed row';
    end if;

    return null;
end;
$$;

-- The v1/v2 calculator remains available for their immutable knowledge
-- versions. The dispatcher introduced below selects the hierarchical engine
-- only for a knowledge version explicitly published with that model key.
alter function private.calculate_maturity_projection(uuid)
rename to calculate_flat_maturity_projection;

create or replace function private.adjust_maturity_traits(
    p_traits jsonb,
    p_body numeric,
    p_acidity numeric,
    p_tannin numeric,
    p_sweetness numeric,
    p_alcohol numeric,
    p_freshness numeric,
    p_savory numeric,
    p_concentration numeric
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select jsonb_build_object(
        'body', round(coalesce((p_traits ->> 'body')::numeric, 0) + coalesce(p_body, 0), 2),
        'acidity', round(coalesce((p_traits ->> 'acidity')::numeric, 0) + coalesce(p_acidity, 0), 2),
        'tannin', round(coalesce((p_traits ->> 'tannin')::numeric, 0) + coalesce(p_tannin, 0), 2),
        'sweetness', round(coalesce((p_traits ->> 'sweetness')::numeric, 0) + coalesce(p_sweetness, 0), 2),
        'alcohol', round(coalesce((p_traits ->> 'alcohol')::numeric, 0) + coalesce(p_alcohol, 0), 2),
        'freshness', round(coalesce((p_traits ->> 'freshness')::numeric, 0) + coalesce(p_freshness, 0), 2),
        'savory', round(coalesce((p_traits ->> 'savory')::numeric, 0) + coalesce(p_savory, 0), 2),
        'concentration', round(coalesce((p_traits ->> 'concentration')::numeric, 0) + coalesce(p_concentration, 0), 2)
    );
$$;

revoke execute on function private.adjust_maturity_traits(
    jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
)
from public, anon, authenticated;
grant execute on function private.adjust_maturity_traits(
    jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) to service_role;

create or replace function private.resolve_hierarchical_maturity(
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
    v_color text;
    v_product_id uuid;
    v_producer_id uuid;
    v_release_id uuid;
    v_leaf_place_id uuid;
    v_place record;
    v_layer record;
    v_vintage record;
    v_producer record;
    v_cuvee record;
    v_release record;
    v_has_adjustments boolean := false;
    v_color_conflict boolean := false;
    v_first_age integer;
    v_best_start_age integer;
    v_best_end_age integer;
    v_drink_by_age integer;
    v_first_year integer;
    v_best_start_year integer;
    v_best_end_year integer;
    v_drink_by_year integer;
    v_as_of_year integer := extract(year from current_date)::integer;
    v_state text;
    v_state_label text;
    v_urgency text;
    v_urgency_score integer;
    v_headline text;
    v_message text;
    v_confidence numeric(4, 3);
    v_confidence_label text;
    v_specificity text;
    v_place_match text;
    v_cuvee_candidate_count integer := 0;
    v_cuvee_match_ambiguous boolean := false;
    v_profile_ids uuid[] := array[]::uuid[];
    v_reasons jsonb := '[]'::jsonb;
    v_warnings jsonb := '[]'::jsonb;
    v_contributions jsonb := '[]'::jsonb;
    v_traits jsonb := jsonb_build_object(
        'body', 0, 'acidity', 0, 'tannin', 0, 'sweetness', 0,
        'alcohol', 0, 'freshness', 0, 'savory', 0, 'concentration', 0
    );
begin
    select job.* into v_job
    from public.enrichment_jobs job
    where job.id = p_job_id
      and job.capability = 'maturity'
      and job.job_status = 'leased';

    if not found then
        raise exception using errcode = '22023', message = 'A leased maturity job is required';
    end if;

    select wine.* into v_wine
    from public.wines wine
    where wine.id = v_job.wine_id
      and wine.household_id = v_job.household_id;

    if not found then
        return jsonb_build_object('status', 'not-found', 'reason', 'wine-not-found');
    end if;
    if v_wine.vintage is null then
        return jsonb_build_object('status', 'needs-review', 'reason', 'missing-vintage');
    end if;

    -- Give optional record variables a stable row shape even when no canonical
    -- product or release is available. Raw producer/cuvee text must never make
    -- these records appear matched.
    select typed.*, profile.confidence as profile_confidence,
           profile.rationale as profile_rationale
    into v_cuvee
    from public.enrichment_cuvee_profiles typed
    join public.enrichment_profiles profile on false
    limit 0;

    select typed.*, profile.confidence as profile_confidence,
           profile.rationale as profile_rationale,
           producer.canonical_name as producer_name
    into v_producer
    from public.enrichment_producer_era_profiles typed
    join public.enrichment_profiles profile on false
    join public.wine_reference_producers producer on false
    limit 0;

    select typed.*, profile.confidence as profile_confidence,
           profile.rationale as profile_rationale
    into v_release
    from public.enrichment_release_profiles typed
    join public.enrichment_profiles profile on false
    limit 0;

    v_color := private.canonical_enrichment_wine_color(v_wine.color);

    if v_wine.wine_reference_type = 'product' then
        v_product_id := v_wine.wine_reference_id;
    elsif v_wine.wine_reference_type = 'release' then
        v_release_id := v_wine.wine_reference_id;
        select item.product_id into v_product_id
        from public.wine_reference_releases item where item.id = v_release_id;
    elsif v_wine.wine_reference_type = 'package' then
        select item.release_id, release.product_id into v_release_id, v_product_id
        from public.wine_reference_packages item
        join public.wine_reference_releases release on release.id = item.release_id
        where item.id = v_wine.wine_reference_id;
    end if;

    if v_product_id is not null then
        select product.producer_id into v_producer_id
        from public.wine_reference_products product where product.id = v_product_id;

        select typed.*, profile.confidence as profile_confidence,
               profile.rationale as profile_rationale
        into v_cuvee
        from public.enrichment_cuvee_profiles typed
        join public.enrichment_profiles profile on profile.id = typed.profile_id
        where typed.knowledge_version_id = v_job.knowledge_version_id
          and typed.product_id = v_product_id
          and typed.wine_color = v_color
        order by typed.profile_id limit 1;

    end if;

    -- A remembered household producer choice is explicit owner evidence. It
    -- may identify the producer when this individual wine has no shared
    -- product link, while raw producer text by itself remains insufficient.
    if v_producer_id is null then
        select preference.producer_id
        into v_producer_id
        from public.wine_reference_household_producer_preferences preference
        where preference.household_id = v_wine.household_id
          and preference.source_producer_normalized =
              private.normalize_wine_reference_text(v_wine.producer);
    end if;

    -- A provider's product identity can differ from the reviewed maturity
    -- product identity. Once the producer is confirmed, a unique curated
    -- cuvee alias safely bridges those identities without replacing either.
    if v_cuvee.profile_id is null and v_producer_id is not null then
        select count(distinct typed.profile_id)::integer
        into v_cuvee_candidate_count
        from public.enrichment_cuvee_profiles typed
        join public.wine_reference_products product
          on product.id = typed.product_id
         and product.producer_id = v_producer_id
        join public.wine_reference_aliases alias
          on alias.entity_id = typed.product_id
         and alias.entity_type = 'product'
         and alias.normalized_value =
             private.normalize_wine_reference_text(v_wine.cuvee)
        where typed.knowledge_version_id = v_job.knowledge_version_id
          and typed.wine_color = v_color;

        if v_cuvee_candidate_count = 1 then
            select typed.*, profile.confidence as profile_confidence,
                   profile.rationale as profile_rationale
            into v_cuvee
            from public.enrichment_cuvee_profiles typed
            join public.enrichment_profiles profile on profile.id = typed.profile_id
            join public.wine_reference_products product
              on product.id = typed.product_id
             and product.producer_id = v_producer_id
            join public.wine_reference_aliases alias
              on alias.entity_id = typed.product_id
             and alias.entity_type = 'product'
             and alias.normalized_value =
                 private.normalize_wine_reference_text(v_wine.cuvee)
            where typed.knowledge_version_id = v_job.knowledge_version_id
              and typed.wine_color = v_color
            order by typed.profile_id
            limit 1;
        elsif v_cuvee_candidate_count > 1 then
            v_cuvee_match_ambiguous := true;
        end if;
    end if;

    -- Prefer an exact reviewed release belonging to the resolved cuvee. This
    -- also works when a provider-specific product was bridged by a curated
    -- alias above.
    if v_cuvee.profile_id is not null then
        select release.id into v_release_id
        from public.wine_reference_releases release
        join public.enrichment_release_profiles typed
          on typed.release_id = release.id
         and typed.knowledge_version_id = v_job.knowledge_version_id
         and typed.wine_color = v_color
        where release.product_id = v_cuvee.product_id
          and release.vintage_year = v_wine.vintage
        order by release.id limit 1;
    end if;

    if v_cuvee.profile_id is not null and v_cuvee.place_id is not null then
        v_leaf_place_id := v_cuvee.place_id;
        v_place_match := 'confirmed-cuvee-place';
    else
        select alias.place_id into v_leaf_place_id
        from public.enrichment_place_aliases alias
        where alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
        order by alias.id limit 1;
        v_place_match := 'exact-appellation';
    end if;

    if v_leaf_place_id is null then
        return jsonb_build_object('status', 'needs-review', 'reason', 'unsupported-place-profile');
    end if;

    if v_cuvee.profile_id is null
       and not exists (
           select 1
           from public.enrichment_place_profiles typed
           where typed.knowledge_version_id = v_job.knowledge_version_id
             and typed.place_id = v_leaf_place_id
             and typed.wine_color = v_color

           union all

           select 1
           from public.enrichment_place_adjustment_profiles typed
           where typed.knowledge_version_id = v_job.knowledge_version_id
             and typed.place_id = v_leaf_place_id
             and typed.wine_color = v_color
       )
    then
        select exists (
            select 1
            from public.enrichment_place_profiles typed
            where typed.knowledge_version_id = v_job.knowledge_version_id
              and typed.place_id = v_leaf_place_id
              and typed.wine_color <> v_color

            union all

            select 1
            from public.enrichment_place_adjustment_profiles typed
            where typed.knowledge_version_id = v_job.knowledge_version_id
              and typed.place_id = v_leaf_place_id
              and typed.wine_color <> v_color
        ) into v_color_conflict;
        return jsonb_build_object(
            'status', 'needs-review',
            'reason', case when v_color_conflict then 'appellation-color-conflict'
                           else 'unsupported-place-profile' end
        );
    end if;

    with recursive ancestors(place_id) as (
        select v_leaf_place_id
        union all
        select place.parent_id
        from ancestors
        join public.enrichment_places place on place.id = ancestors.place_id
        where place.parent_id is not null
    )
    select exists (
        select 1 from ancestors
        join public.enrichment_place_adjustment_profiles typed
          on typed.place_id = ancestors.place_id
         and typed.knowledge_version_id = v_job.knowledge_version_id
         and typed.wine_color = v_color
    ) into v_has_adjustments;

    with recursive ancestors(place_id, depth) as (
        select v_leaf_place_id, 0
        union all
        select place.parent_id, ancestors.depth + 1
        from ancestors
        join public.enrichment_places place on place.id = ancestors.place_id
        where place.parent_id is not null
    )
    select typed.*, profile.confidence as profile_confidence,
           profile.rationale as profile_rationale,
           place.canonical_name as place_name, place.place_type
    into v_place
    from ancestors
    join public.enrichment_place_profiles typed
      on typed.place_id = ancestors.place_id
     and typed.knowledge_version_id = v_job.knowledge_version_id
     and typed.wine_color = v_color
    join public.enrichment_profiles profile on profile.id = typed.profile_id
    join public.enrichment_places place on place.id = typed.place_id
    order by
        case when v_has_adjustments then ancestors.depth else -ancestors.depth end desc,
        typed.profile_id
    limit 1;

    if not found then
        select exists (
            select 1
            from public.enrichment_place_aliases alias
            join public.enrichment_place_profiles typed on typed.place_id = alias.place_id
            where alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
              and typed.knowledge_version_id = v_job.knowledge_version_id
              and typed.wine_color <> v_color
        ) into v_color_conflict;
        return jsonb_build_object(
            'status', 'needs-review',
            'reason', case when v_color_conflict then 'appellation-color-conflict'
                           else 'unsupported-place-profile' end
        );
    end if;

    v_first_age := v_place.first_trial_age;
    v_best_start_age := v_place.best_start_age;
    v_best_end_age := v_place.best_end_age;
    v_drink_by_age := v_place.outer_horizon_age;
    v_confidence := v_place.profile_confidence;
    v_profile_ids := array_append(v_profile_ids, v_place.profile_id);
    v_reasons := v_reasons || jsonb_build_array(v_place.profile_rationale);
    v_traits := jsonb_build_object(
        'body', v_place.body, 'acidity', v_place.acidity,
        'tannin', v_place.tannin, 'sweetness', v_place.sweetness,
        'alcohol', v_place.alcohol, 'freshness', v_place.freshness,
        'savory', v_place.savory, 'concentration', v_place.concentration
    );
    v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
        'layer', 'region', 'profile_id', v_place.profile_id,
        'label', v_place.place_name, 'rationale', v_place.profile_rationale,
        'adjustment', jsonb_build_object('first', 0, 'best_start', 0, 'best_end', 0, 'drink_by', 0)
    ));

    if v_has_adjustments then
        v_place_match := 'hierarchical-place';
        for v_layer in
            with recursive ancestors(place_id, depth) as (
                select v_leaf_place_id, 0
                union all
                select place.parent_id, ancestors.depth + 1
                from ancestors
                join public.enrichment_places place on place.id = ancestors.place_id
                where place.parent_id is not null
            )
            select typed.*, profile.confidence as profile_confidence,
                   profile.rationale as profile_rationale,
                   place.canonical_name as place_name, place.place_type
            from ancestors
            join public.enrichment_place_adjustment_profiles typed
              on typed.place_id = ancestors.place_id
             and typed.knowledge_version_id = v_job.knowledge_version_id
             and typed.wine_color = v_color
            join public.enrichment_profiles profile on profile.id = typed.profile_id
            join public.enrichment_places place on place.id = typed.place_id
            order by ancestors.depth desc, typed.profile_id
        loop
            v_first_age := v_first_age + v_layer.first_trial_age_adjustment;
            v_best_start_age := v_best_start_age + v_layer.best_start_age_adjustment;
            v_best_end_age := v_best_end_age + v_layer.best_end_age_adjustment;
            v_drink_by_age := v_drink_by_age + v_layer.outer_horizon_age_adjustment;
            v_confidence := least(v_confidence, v_layer.profile_confidence);
            v_profile_ids := array_append(v_profile_ids, v_layer.profile_id);
            v_reasons := v_reasons || jsonb_build_array(v_layer.profile_rationale);
            v_traits := private.adjust_maturity_traits(
                v_traits,
                v_layer.body_adjustment,
                v_layer.acidity_adjustment,
                v_layer.tannin_adjustment,
                v_layer.sweetness_adjustment,
                v_layer.alcohol_adjustment,
                v_layer.freshness_adjustment,
                v_layer.savory_adjustment,
                v_layer.concentration_adjustment
            );
            v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
                'layer', v_layer.place_type, 'profile_id', v_layer.profile_id,
                'label', v_layer.place_name, 'rationale', v_layer.profile_rationale,
                'adjustment', jsonb_build_object(
                    'first', v_layer.first_trial_age_adjustment,
                    'best_start', v_layer.best_start_age_adjustment,
                    'best_end', v_layer.best_end_age_adjustment,
                    'drink_by', v_layer.outer_horizon_age_adjustment
                )
            ));
        end loop;
    end if;

    with recursive ancestors(place_id, depth) as (
        select v_leaf_place_id, 0
        union all
        select place.parent_id, ancestors.depth + 1
        from ancestors
        join public.enrichment_places place on place.id = ancestors.place_id
        where place.parent_id is not null
    )
    select typed.*, profile.confidence as profile_confidence,
           profile.rationale as profile_rationale
    into v_vintage
    from ancestors
    join public.enrichment_vintage_profiles typed
      on typed.place_id = ancestors.place_id
     and typed.knowledge_version_id = v_job.knowledge_version_id
     and typed.vintage_year = v_wine.vintage
     and typed.wine_color = v_color
    join public.enrichment_profiles profile on profile.id = typed.profile_id
    order by ancestors.depth, typed.profile_id limit 1;

    if v_vintage.profile_id is not null then
        v_first_age := v_first_age + v_vintage.first_trial_age_adjustment;
        v_best_start_age := v_best_start_age + v_vintage.best_start_age_adjustment;
        v_best_end_age := v_best_end_age + v_vintage.best_end_age_adjustment;
        v_drink_by_age := v_drink_by_age + v_vintage.outer_horizon_age_adjustment;
        v_confidence := least(v_confidence, v_vintage.profile_confidence);
        v_profile_ids := array_append(v_profile_ids, v_vintage.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_vintage.profile_rationale);
        v_traits := private.adjust_maturity_traits(
            v_traits,
            v_vintage.body_adjustment,
            v_vintage.acidity_adjustment,
            v_vintage.tannin_adjustment,
            v_vintage.sweetness_adjustment,
            v_vintage.alcohol_adjustment,
            v_vintage.freshness_adjustment,
            v_vintage.savory_adjustment,
            v_vintage.concentration_adjustment
        );
        v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
            'layer', 'vintage', 'profile_id', v_vintage.profile_id,
            'label', v_wine.vintage::text, 'rationale', v_vintage.profile_rationale,
            'condition_tags', to_jsonb(v_vintage.condition_tags),
            'adjustment', jsonb_build_object(
                'first', v_vintage.first_trial_age_adjustment,
                'best_start', v_vintage.best_start_age_adjustment,
                'best_end', v_vintage.best_end_age_adjustment,
                'drink_by', v_vintage.outer_horizon_age_adjustment
            )
        ));
    else
        v_warnings := v_warnings || jsonb_build_array('No reviewed local vintage profile was available.');
    end if;

    if v_producer_id is not null then
        select typed.*, profile.confidence as profile_confidence,
               profile.rationale as profile_rationale,
               producer.canonical_name as producer_name
        into v_producer
        from public.enrichment_producer_era_profiles typed
        join public.enrichment_profiles profile on profile.id = typed.profile_id
        join public.wine_reference_producers producer on producer.id = typed.producer_id
        where typed.knowledge_version_id = v_job.knowledge_version_id
          and typed.producer_id = v_producer_id
          and v_wine.vintage between typed.first_vintage_year and typed.final_vintage_year
          and typed.wine_color = v_color
        order by typed.final_vintage_year - typed.first_vintage_year, typed.profile_id
        limit 1;
    end if;

    if v_producer.profile_id is not null then
        v_first_age := v_first_age + v_producer.first_trial_age_adjustment;
        v_best_start_age := v_best_start_age + v_producer.best_start_age_adjustment;
        v_best_end_age := v_best_end_age + v_producer.best_end_age_adjustment;
        v_drink_by_age := v_drink_by_age + v_producer.outer_horizon_age_adjustment;
        v_confidence := least(v_confidence, v_producer.profile_confidence);
        v_profile_ids := array_append(v_profile_ids, v_producer.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_producer.profile_rationale);
        v_traits := private.adjust_maturity_traits(
            v_traits,
            v_producer.body_adjustment,
            v_producer.acidity_adjustment,
            v_producer.tannin_adjustment,
            v_producer.sweetness_adjustment,
            v_producer.alcohol_adjustment,
            v_producer.freshness_adjustment,
            v_producer.savory_adjustment,
            v_producer.concentration_adjustment
        );
        v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
            'layer', 'producer-era', 'profile_id', v_producer.profile_id,
            'label', v_producer.producer_name, 'rationale', v_producer.profile_rationale,
            'first_vintage', v_producer.first_vintage_year,
            'final_vintage', v_producer.final_vintage_year,
            'adjustment', jsonb_build_object(
                'first', v_producer.first_trial_age_adjustment,
                'best_start', v_producer.best_start_age_adjustment,
                'best_end', v_producer.best_end_age_adjustment,
                'drink_by', v_producer.outer_horizon_age_adjustment
            )
        ));

        for v_layer in
            select typed.*, profile.confidence as profile_confidence,
                   profile.rationale as profile_rationale
            from public.enrichment_producer_vintage_interaction_profiles typed
            join public.enrichment_profiles profile on profile.id = typed.profile_id
            where typed.knowledge_version_id = v_job.knowledge_version_id
              and typed.producer_era_profile_id = v_producer.profile_id
              and typed.required_condition_tags <@ coalesce(v_vintage.condition_tags, '{}'::text[])
            order by typed.profile_id
        loop
            v_first_age := v_first_age + v_layer.first_trial_age_adjustment;
            v_best_start_age := v_best_start_age + v_layer.best_start_age_adjustment;
            v_best_end_age := v_best_end_age + v_layer.best_end_age_adjustment;
            v_drink_by_age := v_drink_by_age + v_layer.outer_horizon_age_adjustment;
            v_confidence := least(v_confidence, v_layer.profile_confidence);
            v_profile_ids := array_append(v_profile_ids, v_layer.profile_id);
            v_reasons := v_reasons || jsonb_build_array(v_layer.profile_rationale);
            v_traits := private.adjust_maturity_traits(
                v_traits,
                v_layer.body_adjustment,
                v_layer.acidity_adjustment,
                v_layer.tannin_adjustment,
                v_layer.sweetness_adjustment,
                v_layer.alcohol_adjustment,
                v_layer.freshness_adjustment,
                v_layer.savory_adjustment,
                v_layer.concentration_adjustment
            );
            v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
                'layer', 'interaction', 'profile_id', v_layer.profile_id,
                'label', array_to_string(v_layer.required_condition_tags, ' + '),
                'rationale', v_layer.profile_rationale,
                'adjustment', jsonb_build_object(
                    'first', v_layer.first_trial_age_adjustment,
                    'best_start', v_layer.best_start_age_adjustment,
                    'best_end', v_layer.best_end_age_adjustment,
                    'drink_by', v_layer.outer_horizon_age_adjustment
                )
            ));
        end loop;
    else
        v_warnings := v_warnings || jsonb_build_array('No confirmed producer-era profile was used.');
    end if;

    if v_cuvee.profile_id is not null then
        v_first_age := v_first_age + v_cuvee.first_trial_age_adjustment;
        v_best_start_age := v_best_start_age + v_cuvee.best_start_age_adjustment;
        v_best_end_age := v_best_end_age + v_cuvee.best_end_age_adjustment;
        v_drink_by_age := v_drink_by_age + v_cuvee.outer_horizon_age_adjustment;
        v_confidence := least(v_confidence, v_cuvee.profile_confidence);
        v_profile_ids := array_append(v_profile_ids, v_cuvee.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_cuvee.profile_rationale);
        v_traits := private.adjust_maturity_traits(
            v_traits,
            v_cuvee.body_adjustment,
            v_cuvee.acidity_adjustment,
            v_cuvee.tannin_adjustment,
            v_cuvee.sweetness_adjustment,
            v_cuvee.alcohol_adjustment,
            v_cuvee.freshness_adjustment,
            v_cuvee.savory_adjustment,
            v_cuvee.concentration_adjustment
        );
        v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
            'layer', 'cuvee', 'profile_id', v_cuvee.profile_id,
            'label', v_wine.cuvee, 'rationale', v_cuvee.profile_rationale,
            'adjustment', jsonb_build_object(
                'first', v_cuvee.first_trial_age_adjustment,
                'best_start', v_cuvee.best_start_age_adjustment,
                'best_end', v_cuvee.best_end_age_adjustment,
                'drink_by', v_cuvee.outer_horizon_age_adjustment
            )
        ));
    else
        v_warnings := v_warnings || jsonb_build_array(
            case when v_cuvee_match_ambiguous
                 then 'More than one reviewed cuvee matched; confirm the exact wine identity before using that layer.'
                 else 'No confirmed cuvee or climat profile was used.' end
        );
    end if;

    if v_release_id is not null then
        select typed.*, profile.confidence as profile_confidence,
               profile.rationale as profile_rationale
        into v_release
        from public.enrichment_release_profiles typed
        join public.enrichment_profiles profile on profile.id = typed.profile_id
        where typed.knowledge_version_id = v_job.knowledge_version_id
          and typed.release_id = v_release_id
          and typed.wine_color = v_color
        order by typed.profile_id limit 1;
    end if;

    if v_release.profile_id is not null then
        v_first_age := v_first_age + v_release.first_trial_age_adjustment;
        v_best_start_age := v_best_start_age + v_release.best_start_age_adjustment;
        v_best_end_age := v_best_end_age + v_release.best_end_age_adjustment;
        v_drink_by_age := v_drink_by_age + v_release.outer_horizon_age_adjustment;
        v_confidence := least(v_confidence, v_release.profile_confidence);
        v_profile_ids := array_append(v_profile_ids, v_release.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_release.profile_rationale);
        v_traits := private.adjust_maturity_traits(
            v_traits,
            v_release.body_adjustment,
            v_release.acidity_adjustment,
            v_release.tannin_adjustment,
            v_release.sweetness_adjustment,
            v_release.alcohol_adjustment,
            v_release.freshness_adjustment,
            v_release.savory_adjustment,
            v_release.concentration_adjustment
        );
        v_contributions := v_contributions || jsonb_build_array(jsonb_build_object(
            'layer', 'release', 'profile_id', v_release.profile_id,
            'label', v_wine.vintage::text, 'rationale', v_release.profile_rationale,
            'adjustment', jsonb_build_object(
                'first', v_release.first_trial_age_adjustment,
                'best_start', v_release.best_start_age_adjustment,
                'best_end', v_release.best_end_age_adjustment,
                'drink_by', v_release.outer_horizon_age_adjustment
            )
        ));
    end if;

    v_first_age := greatest(0, v_first_age);
    v_best_start_age := greatest(v_first_age, v_best_start_age);
    v_best_end_age := greatest(v_best_start_age, v_best_end_age);
    v_drink_by_age := greatest(v_best_end_age, v_drink_by_age);
    v_first_year := v_wine.vintage + v_first_age;
    v_best_start_year := v_wine.vintage + v_best_start_age;
    v_best_end_year := v_wine.vintage + v_best_end_age;
    v_drink_by_year := v_wine.vintage + v_drink_by_age;

    if v_as_of_year < v_first_year then
        v_state := 'hold'; v_state_label := 'Hold'; v_urgency := 'later';
        v_urgency_score := 10; v_headline := 'Keep aging';
        v_message := format('Wait about %s years before the first assessment; the likely best period starts around %s.', v_first_year - v_as_of_year, v_best_start_year);
    elsif v_as_of_year < v_best_start_year then
        v_state := 'assess'; v_state_label := 'Start assessing'; v_urgency := 'watch';
        v_urgency_score := 35; v_headline := 'Start assessing';
        v_message := format('A first bottle can be assessed now; the likely best period starts around %s.', v_best_start_year);
    elsif v_as_of_year <= v_best_end_year then
        v_state := 'ready'; v_state_label := 'Likely ready'; v_urgency := 'ready';
        v_urgency_score := 55; v_headline := 'Likely ready';
        v_message := format('This wine is inside its likely best period; reassess before the suggested drink-by year of %s.', v_drink_by_year);
    elsif v_as_of_year <= v_drink_by_year then
        v_state := 'priority'; v_state_label := 'Prioritize'; v_urgency := 'priority';
        v_urgency_score := 85; v_headline := 'Drink sooner rather than later';
        v_message := format('The central estimate has passed; prioritize an assessment and aim to drink by about %s.', v_drink_by_year);
    else
        v_state := 'assess-now'; v_state_label := 'Assess now'; v_urgency := 'overdue';
        v_urgency_score := 100; v_headline := 'Assess immediately';
        v_message := 'This wine is past the suggested drink-by year; assess a bottle now rather than assuming it is lost.';
    end if;

    v_confidence_label := case when v_confidence >= 0.75 then 'high'
                               when v_confidence >= 0.50 then 'medium'
                               else 'low' end;
    v_specificity := case when v_release.profile_id is not null then 'release'
                          when v_cuvee.profile_id is not null then 'cuvee'
                          when v_producer.profile_id is not null then 'producer-era'
                          when v_has_adjustments then 'place'
                          else 'region' end;

    return jsonb_build_object(
        'status', 'projected',
        'confidence', v_confidence,
        'specificity', v_specificity,
        'profile_ids', to_jsonb(v_profile_ids),
        'state', v_state,
        'recommendation', jsonb_build_object(
            'schema_version', 1,
            'as_of_year', v_as_of_year,
            'state', v_state,
            'state_label', v_state_label,
            'urgency', v_urgency,
            'urgency_score', v_urgency_score,
            'first_trial_year', v_first_year,
            'best_start_year', v_best_start_year,
            'best_end_year', v_best_end_year,
            'drink_by_year', v_drink_by_year,
            'headline', v_headline,
            'message', v_message,
            'confidence_label', v_confidence_label,
            'place_match', v_place_match,
            'warnings', v_warnings,
            'reasons', v_reasons,
            'contributions', v_contributions,
            'traits', v_traits
        )
    );
end;
$$;

revoke execute on function private.resolve_hierarchical_maturity(uuid)
from public, anon, authenticated;
grant execute on function private.resolve_hierarchical_maturity(uuid) to service_role;

create or replace function private.hierarchical_storage_recommendation(
    p_wine_id uuid,
    p_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_total integer;
    v_aging integer;
    v_service integer;
    v_purpose text;
    v_quantity integer := 0;
    v_to_purpose text;
    v_needed boolean;
    v_possible boolean := false;
    v_message text;
begin
    select * into v_wine from public.wines where id = p_wine_id;
    select
        coalesce(sum(holding.quantity), 0)::integer,
        coalesce(sum(holding.quantity) filter (where location.storage_purpose = 'aging'), 0)::integer,
        coalesce(sum(holding.quantity) filter (where location.storage_purpose = 'service'), 0)::integer
    into v_total, v_aging, v_service
    from public.holdings holding
    join public.locations location on location.id = holding.location_id
    where holding.household_id = v_wine.household_id
      and holding.wine_id = v_wine.id
      and holding.quantity > 0;

    if p_state = 'hold' then
        v_purpose := 'aging'; v_quantity := greatest(0, v_total - v_aging); v_to_purpose := 'aging';
    elsif p_state in ('assess', 'ready') and v_total > 1 then
        v_purpose := 'split-service-and-aging';
        if v_service = 0 then v_quantity := 1; v_to_purpose := 'service';
        elsif v_aging = 0 and v_service > 1 then v_quantity := v_service - 1; v_to_purpose := 'aging'; end if;
    elsif p_state in ('assess', 'ready') then
        v_purpose := 'service'; v_quantity := greatest(0, v_total - v_service); v_to_purpose := 'service';
    else
        v_purpose := 'service-priority'; v_quantity := greatest(0, v_total - v_service); v_to_purpose := 'service';
    end if;

    v_needed := v_quantity > 0;
    if v_needed then
        select exists (
            select 1 from public.locations location
            join public.cellars cellar on cellar.id = location.cellar_id
            where location.household_id = v_wine.household_id
              and location.is_active and cellar.is_active
              and location.storage_purpose = v_to_purpose
        ) into v_possible;
        v_message := case
            when not v_possible then format('Classify or create an active %s location before moving %s bottle%s.', v_to_purpose, v_quantity, case when v_quantity = 1 then '' else 's' end)
            when v_to_purpose = 'service' then format('Move %s bottle%s to service storage.', v_quantity, case when v_quantity = 1 then '' else 's' end)
            else format('Move %s bottle%s to aging storage.', v_quantity, case when v_quantity = 1 then '' else 's' end)
        end;
    elsif v_total = 0 then v_message := 'No bottles are currently in stock.';
    elsif v_purpose = 'aging' then v_message := 'The current aging placement matches this estimate.';
    elsif v_purpose = 'split-service-and-aging' then v_message := 'Keep one assessment bottle in service and the remaining bottles in aging storage.';
    else v_message := 'The current service placement matches this estimate.';
    end if;

    return jsonb_build_object(
        'schema_version', 1, 'purpose', v_purpose, 'message', v_message,
        'current', jsonb_build_object('total_bottles', v_total, 'aging_bottles', v_aging, 'service_bottles', v_service),
        'move', jsonb_build_object('needed', v_needed, 'possible', v_possible, 'quantity', v_quantity, 'to_purpose', v_to_purpose, 'message', v_message)
    );
end;
$$;

revoke execute on function private.hierarchical_storage_recommendation(uuid, text)
from public, anon, authenticated;
grant execute on function private.hierarchical_storage_recommendation(uuid, text) to service_role;

create or replace function private.calculate_maturity_projection(
    p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job public.enrichment_jobs%rowtype;
    v_model_key text;
    v_resolved jsonb;
    v_flat jsonb;
    v_maturity_id uuid;
    v_storage_id uuid;
    v_profile_ids uuid[];
begin
    select job.*
    into v_job
    from public.enrichment_jobs job
    where job.id = p_job_id;

    if not found then
        return private.calculate_flat_maturity_projection(p_job_id);
    end if;

    select version.model_key
    into v_model_key
    from public.enrichment_knowledge_versions version
    where version.id = v_job.knowledge_version_id;

    if v_model_key <> 'hierarchical-maturity' then
        return private.calculate_flat_maturity_projection(p_job_id);
    end if;

    v_resolved := private.resolve_hierarchical_maturity(p_job_id);
    if v_resolved ->> 'status' <> 'projected' then
        return v_resolved;
    end if;

    v_flat := private.calculate_flat_maturity_projection(p_job_id);
    if v_flat ->> 'status' <> 'complete' then
        return v_flat;
    end if;

    v_maturity_id := (v_flat ->> 'maturity_projection_id')::uuid;
    v_storage_id := (v_flat ->> 'storage_projection_id')::uuid;
    select coalesce(array_agg(value::uuid), array[]::uuid[]) into v_profile_ids
    from jsonb_array_elements_text(v_resolved -> 'profile_ids') item(value);

    update public.wine_enrichment_projections projection
    set confidence = (v_resolved ->> 'confidence')::numeric,
        specificity = v_resolved ->> 'specificity',
        recommendation = v_resolved -> 'recommendation'
    where projection.id = v_maturity_id;

    update public.wine_enrichment_projections projection
    set confidence = (v_resolved ->> 'confidence')::numeric,
        specificity = v_resolved ->> 'specificity',
        recommendation = private.hierarchical_storage_recommendation(
            projection.wine_id,
            v_resolved ->> 'state'
        )
    where projection.id = v_storage_id;

    delete from public.wine_enrichment_projection_evidence link
    where link.projection_id in (v_maturity_id, v_storage_id);
    delete from public.wine_enrichment_projection_profiles link
    where link.projection_id in (v_maturity_id, v_storage_id);

    insert into public.wine_enrichment_projection_profiles (
        projection_id, knowledge_version_id, profile_id, contribution_order
    )
    select projection.id, v_job.knowledge_version_id,
           profile.profile_id, profile.ordinality::integer
    from unnest(v_profile_ids) with ordinality profile(profile_id, ordinality)
    cross join (values (v_maturity_id), (v_storage_id)) projection(id);

    insert into public.wine_enrichment_projection_evidence (projection_id, evidence_id)
    select distinct projection.id, link.evidence_id
    from unnest(v_profile_ids) profile(profile_id)
    join public.enrichment_profile_evidence link on link.profile_id = profile.profile_id
    cross join (values (v_maturity_id), (v_storage_id)) projection(id);

    return jsonb_build_object(
        'status', 'complete',
        'maturity_projection_id', v_maturity_id,
        'storage_projection_id', v_storage_id,
        'state', v_resolved ->> 'state',
        'confidence', (v_resolved ->> 'confidence')::numeric
    );
end;
$$;

revoke execute on function private.calculate_maturity_projection(uuid)
from public, anon, authenticated;
grant execute on function private.calculate_maturity_projection(uuid) to service_role;

commit;
