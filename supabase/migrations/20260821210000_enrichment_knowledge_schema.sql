begin;

-- Enrichment sources are distinct from identity dictionaries: one source may
-- support a regulatory fact, vintage assessment, producer/cuvee profile, or
-- provider claim without becoming the canonical wine identity.
create table public.enrichment_sources (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique,
    source_name text not null,
    source_kind text not null,
    homepage_url text,
    created_at timestamptz not null default now(),

    constraint enrichment_sources_key_check
        check (
            length(source_key) > 0
            and source_key = lower(trim(source_key))
            and source_key ~ '^[a-z0-9][a-z0-9-]*$'
        ),
    constraint enrichment_sources_name_check
        check (length(trim(source_name)) > 0),
    constraint enrichment_sources_kind_check
        check (
            source_kind in (
                'regulatory',
                'producer',
                'vintage-report',
                'critic',
                'provider',
                'owner',
                'cellarmanager'
            )
        ),
    constraint enrichment_sources_url_check
        check (homepage_url is null or homepage_url like 'https://%')
);

comment on table public.enrichment_sources is
    'Service-managed provenance sources for enrichment facts and model inputs; they do not own CellarManager wine identities.';


-- Policies are versioned independently from sources because provider terms
-- and contracts can change while historical evidence and projections must
-- retain the policy that applied when they were created.
create table public.enrichment_source_policies (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null
        references public.enrichment_sources(id)
        on delete cascade,
    policy_version integer not null,
    status text not null default 'draft',
    effective_from date not null,
    effective_to date,
    terms_checked_on date,
    evidence_url text,
    display_right text not null default 'unknown',
    normalized_storage_right text not null default 'unknown',
    raw_payload_storage_right text not null default 'unknown',
    offline_sync_right text not null default 'unknown',
    retention_right text not null default 'unknown',
    cross_household_reuse_right text not null default 'unknown',
    attribution_text text,
    retention_days integer,
    notes text,
    created_at timestamptz not null default now(),

    constraint enrichment_source_policies_source_version_unique
        unique (source_id, policy_version),
    constraint enrichment_source_policies_identity_unique
        unique (id, source_id),
    constraint enrichment_source_policies_version_check
        check (policy_version > 0),
    constraint enrichment_source_policies_status_check
        check (status in ('draft', 'reviewed', 'retired')),
    constraint enrichment_source_policies_dates_check
        check (effective_to is null or effective_to >= effective_from),
    constraint enrichment_source_policies_evidence_url_check
        check (evidence_url is null or evidence_url like 'https://%'),
    constraint enrichment_source_policies_rights_check
        check (
            display_right in ('allowed', 'prohibited', 'contract-required', 'unknown')
            and normalized_storage_right in ('allowed', 'prohibited', 'contract-required', 'unknown')
            and raw_payload_storage_right in ('allowed', 'prohibited', 'contract-required', 'unknown')
            and offline_sync_right in ('allowed', 'prohibited', 'contract-required', 'unknown')
            and retention_right in ('allowed', 'prohibited', 'contract-required', 'unknown')
            and cross_household_reuse_right in ('allowed', 'prohibited', 'contract-required', 'unknown')
        ),
    constraint enrichment_source_policies_retention_check
        check (retention_days is null or retention_days > 0),
    constraint enrichment_source_policies_review_check
        check (
            status <> 'reviewed'
            or (
                terms_checked_on is not null
                and evidence_url is not null
                and display_right not in ('unknown', 'contract-required')
                and normalized_storage_right not in ('unknown', 'contract-required')
                and raw_payload_storage_right not in ('unknown', 'contract-required')
                and offline_sync_right not in ('unknown', 'contract-required')
                and retention_right not in ('unknown', 'contract-required')
                and cross_household_reuse_right not in ('unknown', 'contract-required')
            )
        )
);

create unique index enrichment_source_policies_one_current_idx
    on public.enrichment_source_policies(source_id)
    where status = 'reviewed' and effective_to is null;


-- Geographic identities are stable and hierarchical. Profiles are versioned
-- separately so a reviewed appellation definition does not receive a new UUID
-- every time a maturity parameter changes.
create table public.enrichment_places (
    id uuid primary key default gen_random_uuid(),
    parent_id uuid
        references public.enrichment_places(id),
    place_type text not null,
    canonical_name text not null,
    normalized_name text generated always as (
        private.normalize_wine_reference_text(canonical_name)
    ) stored,
    country_code text,
    created_at timestamptz not null default now(),

    constraint enrichment_places_type_check
        check (
            place_type in (
                'country',
                'region',
                'subregion',
                'appellation',
                'classification',
                'site',
                'parcel',
                'other'
            )
        ),
    constraint enrichment_places_name_check
        check (length(trim(canonical_name)) > 0),
    constraint enrichment_places_country_check
        check (
            country_code is null
            or (
                length(country_code) = 2
                and country_code = upper(country_code)
            )
        ),
    constraint enrichment_places_parent_check
        check (parent_id is null or parent_id <> id)
);

create unique index enrichment_places_identity_unique
    on public.enrichment_places(
        coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
        place_type,
        normalized_name
    );

create index enrichment_places_parent_idx
    on public.enrichment_places(parent_id);

create or replace function private.prevent_enrichment_place_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.parent_id is null then
        return new;
    end if;

    if exists (
        with recursive ancestors(id) as (
            select new.parent_id

            union

            select place.parent_id
            from public.enrichment_places place
            join ancestors on ancestors.id = place.id
            where place.parent_id is not null
        )
        select 1
        from ancestors
        where id = new.id
    ) then
        raise exception using
            errcode = '23514',
            message = 'Enrichment place hierarchy would create a cycle';
    end if;

    return new;
end;
$$;

revoke execute
on function private.prevent_enrichment_place_cycle()
from public, anon, authenticated;

create trigger enrichment_places_prevent_cycle
before insert or update on public.enrichment_places
for each row
execute function private.prevent_enrichment_place_cycle();


create table public.enrichment_knowledge_versions (
    id uuid primary key default gen_random_uuid(),
    version_number integer not null unique,
    label text not null,
    status text not null default 'draft',
    model_key text not null,
    model_version text not null,
    content_sha256 text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    published_at timestamptz,

    constraint enrichment_knowledge_versions_number_check
        check (version_number > 0),
    constraint enrichment_knowledge_versions_label_check
        check (length(trim(label)) > 0),
    constraint enrichment_knowledge_versions_model_check
        check (
            length(trim(model_key)) > 0
            and length(trim(model_version)) > 0
        ),
    constraint enrichment_knowledge_versions_status_check
        check (status in ('draft', 'active', 'superseded', 'retired')),
    constraint enrichment_knowledge_versions_hash_check
        check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
    constraint enrichment_knowledge_versions_publication_check
        check (
            (status = 'draft' and published_at is null)
            or (
                status in ('active', 'superseded', 'retired')
                and published_at is not null
                and content_sha256 is not null
            )
        )
);

create unique index enrichment_knowledge_versions_one_active_idx
    on public.enrichment_knowledge_versions(status)
    where status = 'active';

create or replace function private.protect_published_enrichment_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.status = 'draft' then
        return case when tg_op = 'DELETE' then old else new end;
    end if;

    if tg_op = 'DELETE' then
        raise exception using
            errcode = '23514',
            message = 'Published enrichment knowledge versions are immutable';
    end if;

    if new.version_number is distinct from old.version_number
       or new.label is distinct from old.label
       or new.model_key is distinct from old.model_key
       or new.model_version is distinct from old.model_version
       or new.content_sha256 is distinct from old.content_sha256
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.published_at is distinct from old.published_at
       or not (
           new.status = old.status
           or (old.status = 'active' and new.status in ('superseded', 'retired'))
           or (old.status = 'superseded' and new.status = 'retired')
       ) then
        raise exception using
            errcode = '23514',
            message = 'Published enrichment knowledge versions are immutable';
    end if;

    return new;
end;
$$;

revoke execute
on function private.protect_published_enrichment_version()
from public, anon, authenticated;

create trigger enrichment_knowledge_versions_protect_published
before update or delete on public.enrichment_knowledge_versions
for each row
execute function private.protect_published_enrichment_version();


-- A profile root supplies common review/provenance fields. Its deferred shape
-- trigger requires exactly one matching typed profile row at commit time.
create table public.enrichment_profiles (
    id uuid primary key default gen_random_uuid(),
    knowledge_version_id uuid not null
        references public.enrichment_knowledge_versions(id)
        on delete cascade,
    profile_type text not null,
    review_status text not null default 'draft',
    confidence numeric(4, 3) not null,
    rationale text not null,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint enrichment_profiles_type_check
        check (
            profile_type in (
                'place',
                'vintage',
                'producer-era',
                'cuvee'
            )
        ),
    constraint enrichment_profiles_review_status_check
        check (review_status in ('draft', 'reviewed', 'rejected')),
    constraint enrichment_profiles_confidence_check
        check (confidence between 0 and 1),
    constraint enrichment_profiles_rationale_check
        check (length(trim(rationale)) > 0),
    constraint enrichment_profiles_review_check
        check (
            (review_status = 'draft' and reviewed_at is null)
            or (
                review_status in ('reviewed', 'rejected')
                and reviewed_at is not null
            )
        ),
    constraint enrichment_profiles_typed_identity_unique
        unique (id, knowledge_version_id, profile_type),
    constraint enrichment_profiles_version_identity_unique
        unique (id, knowledge_version_id)
);


create table public.enrichment_place_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'place',
    place_id uuid not null
        references public.enrichment_places(id),
    wine_color text not null,
    first_trial_age integer not null,
    best_start_age integer not null,
    best_end_age integer not null,
    outer_horizon_age integer not null,
    body numeric(3, 2) not null,
    acidity numeric(3, 2) not null,
    tannin numeric(3, 2) not null,
    sweetness numeric(3, 2) not null,
    alcohol numeric(3, 2) not null,
    freshness numeric(3, 2) not null,
    savory numeric(3, 2) not null,

    constraint enrichment_place_profiles_type_check
        check (profile_type = 'place'),
    constraint enrichment_place_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(
            id,
            knowledge_version_id,
            profile_type
        )
        on delete cascade,
    constraint enrichment_place_profiles_unique
        unique (knowledge_version_id, place_id, wine_color),
    constraint enrichment_place_profiles_color_check
        check (wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    constraint enrichment_place_profiles_ages_check
        check (
            first_trial_age >= 0
            and first_trial_age <= best_start_age
            and best_start_age <= best_end_age
            and best_end_age <= outer_horizon_age
            and outer_horizon_age <= 100
        ),
    constraint enrichment_place_profiles_attributes_check
        check (
            body between 0 and 5
            and acidity between 0 and 5
            and tannin between 0 and 5
            and sweetness between 0 and 5
            and alcohol between 0 and 5
            and freshness between 0 and 5
            and savory between 0 and 5
        )
);


create table public.enrichment_vintage_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'vintage',
    place_id uuid not null
        references public.enrichment_places(id),
    vintage_year integer not null,
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

    constraint enrichment_vintage_profiles_type_check
        check (profile_type = 'vintage'),
    constraint enrichment_vintage_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(id, knowledge_version_id, profile_type)
        on delete cascade,
    constraint enrichment_vintage_profiles_unique
        unique (knowledge_version_id, place_id, vintage_year, wine_color),
    constraint enrichment_vintage_profiles_year_check
        check (vintage_year between 1800 and 2200),
    constraint enrichment_vintage_profiles_color_check
        check (wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    constraint enrichment_vintage_profiles_age_adjustments_check
        check (
            first_trial_age_adjustment between -50 and 50
            and best_start_age_adjustment between -50 and 50
            and best_end_age_adjustment between -50 and 50
            and outer_horizon_age_adjustment between -50 and 50
        ),
    constraint enrichment_vintage_profiles_attribute_adjustments_check
        check (
            body_adjustment between -5 and 5
            and acidity_adjustment between -5 and 5
            and tannin_adjustment between -5 and 5
            and sweetness_adjustment between -5 and 5
            and alcohol_adjustment between -5 and 5
            and freshness_adjustment between -5 and 5
            and savory_adjustment between -5 and 5
        )
);


create table public.enrichment_producer_era_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'producer-era',
    producer_id uuid not null
        references public.wine_reference_producers(id),
    first_vintage_year integer not null,
    final_vintage_year integer not null,
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

    constraint enrichment_producer_era_profiles_type_check
        check (profile_type = 'producer-era'),
    constraint enrichment_producer_era_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(id, knowledge_version_id, profile_type)
        on delete cascade,
    constraint enrichment_producer_era_profiles_unique
        unique (
            knowledge_version_id,
            producer_id,
            first_vintage_year,
            final_vintage_year,
            wine_color
        ),
    constraint enrichment_producer_era_profiles_years_check
        check (
            first_vintage_year between 1800 and 2200
            and final_vintage_year between first_vintage_year and 2200
        ),
    constraint enrichment_producer_era_profiles_color_check
        check (wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    constraint enrichment_producer_era_profiles_age_adjustments_check
        check (
            first_trial_age_adjustment between -50 and 50
            and best_start_age_adjustment between -50 and 50
            and best_end_age_adjustment between -50 and 50
            and outer_horizon_age_adjustment between -50 and 50
        ),
    constraint enrichment_producer_era_profiles_attribute_adjustments_check
        check (
            body_adjustment between -5 and 5
            and acidity_adjustment between -5 and 5
            and tannin_adjustment between -5 and 5
            and sweetness_adjustment between -5 and 5
            and alcohol_adjustment between -5 and 5
            and freshness_adjustment between -5 and 5
            and savory_adjustment between -5 and 5
        )
);

create index enrichment_producer_era_profiles_lookup_idx
    on public.enrichment_producer_era_profiles(
        producer_id,
        first_vintage_year,
        final_vintage_year,
        wine_color
    );


create table public.enrichment_cuvee_profiles (
    profile_id uuid primary key,
    knowledge_version_id uuid not null,
    profile_type text not null default 'cuvee',
    product_id uuid not null
        references public.wine_reference_products(id),
    place_id uuid references public.enrichment_places(id),
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

    constraint enrichment_cuvee_profiles_type_check
        check (profile_type = 'cuvee'),
    constraint enrichment_cuvee_profiles_root_fk
        foreign key (profile_id, knowledge_version_id, profile_type)
        references public.enrichment_profiles(id, knowledge_version_id, profile_type)
        on delete cascade,
    constraint enrichment_cuvee_profiles_unique
        unique (knowledge_version_id, product_id, wine_color),
    constraint enrichment_cuvee_profiles_color_check
        check (wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    constraint enrichment_cuvee_profiles_age_adjustments_check
        check (
            first_trial_age_adjustment between -50 and 50
            and best_start_age_adjustment between -50 and 50
            and best_end_age_adjustment between -50 and 50
            and outer_horizon_age_adjustment between -50 and 50
        ),
    constraint enrichment_cuvee_profiles_attribute_adjustments_check
        check (
            body_adjustment between -5 and 5
            and acidity_adjustment between -5 and 5
            and tannin_adjustment between -5 and 5
            and sweetness_adjustment between -5 and 5
            and alcohol_adjustment between -5 and 5
            and freshness_adjustment between -5 and 5
            and savory_adjustment between -5 and 5
        )
);


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

    select profile.profile_type
    into v_profile_type
    from public.enrichment_profiles profile
    where profile.id = v_profile_id;

    if not found then
        return null;
    end if;

    select
        (case when exists (
            select 1 from public.enrichment_place_profiles typed where typed.profile_id = v_profile_id
        ) then 1 else 0 end)
        + (case when exists (
            select 1 from public.enrichment_vintage_profiles typed where typed.profile_id = v_profile_id
        ) then 1 else 0 end)
        + (case when exists (
            select 1 from public.enrichment_producer_era_profiles typed where typed.profile_id = v_profile_id
        ) then 1 else 0 end)
        + (case when exists (
            select 1 from public.enrichment_cuvee_profiles typed where typed.profile_id = v_profile_id
        ) then 1 else 0 end)
    into v_typed_rows;

    if v_typed_rows <> 1
       or not (
           (v_profile_type = 'place' and exists (
               select 1 from public.enrichment_place_profiles typed where typed.profile_id = v_profile_id
           ))
           or (v_profile_type = 'vintage' and exists (
               select 1 from public.enrichment_vintage_profiles typed where typed.profile_id = v_profile_id
           ))
           or (v_profile_type = 'producer-era' and exists (
               select 1 from public.enrichment_producer_era_profiles typed where typed.profile_id = v_profile_id
           ))
           or (v_profile_type = 'cuvee' and exists (
               select 1 from public.enrichment_cuvee_profiles typed where typed.profile_id = v_profile_id
           ))
       ) then
        raise exception using
            errcode = '23514',
            message = 'Enrichment profile requires exactly one matching typed row';
    end if;

    return null;
end;
$$;

revoke execute
on function private.validate_enrichment_profile_shape()
from public, anon, authenticated;

create constraint trigger enrichment_profiles_shape
after insert or update on public.enrichment_profiles
deferrable initially deferred
for each row
execute function private.validate_enrichment_profile_shape();

create constraint trigger enrichment_place_profiles_shape
after delete on public.enrichment_place_profiles
deferrable initially deferred
for each row
execute function private.validate_enrichment_profile_shape();

create constraint trigger enrichment_vintage_profiles_shape
after delete on public.enrichment_vintage_profiles
deferrable initially deferred
for each row
execute function private.validate_enrichment_profile_shape();

create constraint trigger enrichment_producer_era_profiles_shape
after delete on public.enrichment_producer_era_profiles
deferrable initially deferred
for each row
execute function private.validate_enrichment_profile_shape();

create constraint trigger enrichment_cuvee_profiles_shape
after delete on public.enrichment_cuvee_profiles
deferrable initially deferred
for each row
execute function private.validate_enrichment_profile_shape();


-- Evidence stores either a citation pointer or a normalized claim. There is
-- deliberately no raw provider payload column.
create table public.enrichment_evidence (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null
        references public.enrichment_sources(id),
    source_policy_id uuid not null,
    source_record_id text,
    source_record_url text,
    content_mode text not null,
    claim_type text not null,
    scope_level text not null,
    place_id uuid references public.enrichment_places(id),
    producer_id uuid references public.wine_reference_producers(id),
    product_id uuid references public.wine_reference_products(id),
    release_id uuid references public.wine_reference_releases(id),
    package_id uuid references public.wine_reference_packages(id),
    vintage_year integer,
    wine_color text,
    claim_value jsonb,
    review_status text not null default 'pending',
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    source_published_on date,
    retrieved_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint enrichment_evidence_source_policy_fk
        foreign key (source_policy_id, source_id)
        references public.enrichment_source_policies(id, source_id),
    constraint enrichment_evidence_record_check
        check (
            (source_record_id is not null and length(trim(source_record_id)) > 0)
            or source_record_url is not null
        ),
    constraint enrichment_evidence_record_url_check
        check (source_record_url is null or source_record_url like 'https://%'),
    constraint enrichment_evidence_content_mode_check
        check (content_mode in ('pointer-only', 'normalized-claim')),
    constraint enrichment_evidence_claim_type_check
        check (
            claim_type in (
                'legal-definition',
                'vintage-conditions',
                'producer-style',
                'cuvee-site',
                'wine-structure',
                'maturity-window',
                'food-pairing',
                'methodology'
            )
        ),
    constraint enrichment_evidence_scope_level_check
        check (scope_level in ('place', 'vintage', 'producer', 'product', 'release', 'package', 'methodology')),
    constraint enrichment_evidence_scope_check
        check (
            (scope_level = 'place' and place_id is not null and vintage_year is null
                and producer_id is null and product_id is null and release_id is null and package_id is null)
            or (scope_level = 'vintage' and place_id is not null and vintage_year is not null
                and producer_id is null and product_id is null and release_id is null and package_id is null)
            or (scope_level = 'producer' and producer_id is not null and place_id is null
                and vintage_year is null and product_id is null and release_id is null and package_id is null)
            or (scope_level = 'product' and product_id is not null and place_id is null
                and vintage_year is null and producer_id is null and release_id is null and package_id is null)
            or (scope_level = 'release' and release_id is not null and place_id is null
                and vintage_year is null and producer_id is null and product_id is null and package_id is null)
            or (scope_level = 'package' and package_id is not null and place_id is null
                and vintage_year is null and producer_id is null and product_id is null and release_id is null)
            or (scope_level = 'methodology' and place_id is null and vintage_year is null
                and producer_id is null and product_id is null and release_id is null and package_id is null)
        ),
    constraint enrichment_evidence_vintage_check
        check (vintage_year is null or vintage_year between 1800 and 2200),
    constraint enrichment_evidence_color_check
        check (
            wine_color is null
            or wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
        ),
    constraint enrichment_evidence_claim_value_check
        check (
            (content_mode = 'pointer-only' and claim_value is null)
            or (
                content_mode = 'normalized-claim'
                and claim_value is not null
                and jsonb_typeof(claim_value) = 'object'
            )
        ),
    constraint enrichment_evidence_review_status_check
        check (review_status in ('pending', 'reviewed', 'rejected')),
    constraint enrichment_evidence_review_check
        check (
            (review_status = 'pending' and reviewed_at is null)
            or (review_status in ('reviewed', 'rejected') and reviewed_at is not null)
        )
);

create index enrichment_evidence_scope_idx
    on public.enrichment_evidence(scope_level, claim_type, review_status);

create or replace function private.enforce_enrichment_evidence_rights()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_storage_right text;
    v_policy_status text;
begin
    select
        policy.normalized_storage_right,
        policy.status
    into
        v_storage_right,
        v_policy_status
    from public.enrichment_source_policies policy
    where policy.id = new.source_policy_id
      and policy.source_id = new.source_id;

    if not found then
        raise exception using
            errcode = '23503',
            message = 'Enrichment evidence requires a policy for the same source';
    end if;

    if new.content_mode = 'normalized-claim'
       and (
           v_policy_status <> 'reviewed'
           or v_storage_right <> 'allowed'
       ) then
        raise exception using
            errcode = '23514',
            message = 'A reviewed source policy must permit normalized claim storage';
    end if;

    return new;
end;
$$;

revoke execute
on function private.enforce_enrichment_evidence_rights()
from public, anon, authenticated;

create trigger enrichment_evidence_enforce_rights
before insert or update on public.enrichment_evidence
for each row
execute function private.enforce_enrichment_evidence_rights();


create table public.enrichment_profile_evidence (
    profile_id uuid not null
        references public.enrichment_profiles(id)
        on delete cascade,
    evidence_id uuid not null
        references public.enrichment_evidence(id),
    evidence_role text not null default 'supports',
    created_at timestamptz not null default now(),

    primary key (profile_id, evidence_id),
    constraint enrichment_profile_evidence_role_check
        check (evidence_role in ('supports', 'contradicts', 'context'))
);

create or replace function private.require_draft_enrichment_profile_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_profile_id uuid;
    v_version_id uuid;
    v_version_status text;
begin
    if tg_table_name = 'enrichment_profile_evidence' then
        v_profile_id := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;

        select profile.knowledge_version_id
        into v_version_id
        from public.enrichment_profiles profile
        where profile.id = v_profile_id;
    else
        v_version_id := case
            when tg_op = 'DELETE' then old.knowledge_version_id
            else new.knowledge_version_id
        end;
    end if;

    if v_version_id is null then
        return case when tg_op = 'DELETE' then old else new end;
    end if;

    select version.status
    into v_version_status
    from public.enrichment_knowledge_versions version
    where version.id = v_version_id;

    if found and v_version_status <> 'draft' then
        raise exception using
            errcode = '23514',
            message = 'Published enrichment profiles are immutable';
    end if;

    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute
on function private.require_draft_enrichment_profile_version()
from public, anon, authenticated;

create trigger enrichment_profiles_require_draft
before insert or update or delete on public.enrichment_profiles
for each row
execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_place_profiles_require_draft
before insert or update or delete on public.enrichment_place_profiles
for each row
execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_vintage_profiles_require_draft
before insert or update or delete on public.enrichment_vintage_profiles
for each row
execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_producer_era_profiles_require_draft
before insert or update or delete on public.enrichment_producer_era_profiles
for each row
execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_cuvee_profiles_require_draft
before insert or update or delete on public.enrichment_cuvee_profiles
for each row
execute function private.require_draft_enrichment_profile_version();

create trigger enrichment_profile_evidence_require_draft
before insert or update or delete on public.enrichment_profile_evidence
for each row
execute function private.require_draft_enrichment_profile_version();


-- Private observations can refine later projections without turning one
-- household's tasting note into shared global truth.
create table public.household_wine_observations (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    wine_id uuid not null,
    recorded_by uuid not null
        references auth.users(id)
        on delete cascade,
    visibility text not null default 'household',
    observation_type text not null,
    observed_on date not null,
    maturity_assessment text,
    pairing_dish text,
    pairing_verdict text,
    body_rating integer,
    acidity_rating integer,
    tannin_rating integer,
    freshness_rating integer,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint household_wine_observations_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint household_wine_observations_member_fk
        foreign key (household_id, recorded_by)
        references public.household_members(household_id, user_id)
        on delete cascade,
    constraint household_wine_observations_identity_unique
        unique (id, household_id),
    constraint household_wine_observations_visibility_check
        check (visibility in ('household', 'personal')),
    constraint household_wine_observations_type_check
        check (observation_type in ('tasting', 'producer-guidance', 'maturity', 'pairing', 'storage', 'other')),
    constraint household_wine_observations_date_check
        check (observed_on >= date '1900-01-01'),
    constraint household_wine_observations_maturity_check
        check (
            maturity_assessment is null
            or maturity_assessment in ('too-young', 'youthful', 'ready', 'declining', 'past')
        ),
    constraint household_wine_observations_pairing_check
        check (
            pairing_verdict is null
            or pairing_verdict in ('excellent', 'good', 'neutral', 'poor')
        ),
    constraint household_wine_observations_pairing_shape_check
        check (
            (pairing_dish is null and pairing_verdict is null)
            or (
                pairing_dish is not null
                and length(trim(pairing_dish)) > 0
                and pairing_verdict is not null
            )
        ),
    constraint household_wine_observations_ratings_check
        check (
            (body_rating is null or body_rating between 1 and 5)
            and (acidity_rating is null or acidity_rating between 1 and 5)
            and (tannin_rating is null or tannin_rating between 1 and 5)
            and (freshness_rating is null or freshness_rating between 1 and 5)
        ),
    constraint household_wine_observations_note_check
        check (note is null or length(trim(note)) > 0),
    constraint household_wine_observations_content_check
        check (
            num_nonnulls(
                maturity_assessment,
                pairing_verdict,
                body_rating,
                acidity_rating,
                tannin_rating,
                freshness_rating,
                note
            ) > 0
        )
);

create index household_wine_observations_wine_idx
    on public.household_wine_observations(household_id, wine_id, observed_on desc);


-- A projection is household display state, not a source claim. It preserves
-- the exact knowledge/model version and input fingerprint used to derive it.
create table public.wine_enrichment_projections (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    wine_id uuid not null,
    reference_id uuid,
    reference_type text,
    knowledge_version_id uuid not null
        references public.enrichment_knowledge_versions(id),
    projection_type text not null,
    context_key text not null default '',
    method text not null,
    specificity text not null,
    status text not null default 'current',
    confidence numeric(4, 3) not null,
    input_fingerprint text not null,
    recommendation jsonb not null,
    calculated_at timestamptz not null default now(),
    valid_until timestamptz,
    created_at timestamptz not null default now(),

    constraint wine_enrichment_projections_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint wine_enrichment_projections_reference_fk
        foreign key (reference_id, reference_type)
        references public.wine_reference_entities(id, entity_type),
    constraint wine_enrichment_projections_reference_check
        check (
            (reference_id is null and reference_type is null)
            or (
                reference_id is not null
                and reference_type in ('product', 'release', 'package')
            )
        ),
    constraint wine_enrichment_projections_type_check
        check (projection_type in ('maturity', 'storage', 'pairing')),
    constraint wine_enrichment_projections_context_check
        check (
            length(context_key) <= 128
            and context_key = trim(context_key)
            and (
                (projection_type in ('maturity', 'storage') and context_key = '')
                or (projection_type = 'pairing' and length(context_key) > 0)
            )
        ),
    constraint wine_enrichment_projections_method_check
        check (method in ('curated-inference', 'source-claim', 'manual')),
    constraint wine_enrichment_projections_specificity_check
        check (
            specificity in (
                'exact-release',
                'exact-product',
                'nearby-vintage',
                'comparable-profile',
                'regional-style',
                'owner-maintained'
            )
        ),
    constraint wine_enrichment_projections_status_check
        check (status in ('current', 'superseded', 'withdrawn')),
    constraint wine_enrichment_projections_confidence_check
        check (confidence between 0 and 1),
    constraint wine_enrichment_projections_fingerprint_check
        check (input_fingerprint ~ '^[0-9a-f]{64}$'),
    constraint wine_enrichment_projections_recommendation_check
        check (jsonb_typeof(recommendation) = 'object'),
    constraint wine_enrichment_projections_validity_check
        check (valid_until is null or valid_until > calculated_at),
    constraint wine_enrichment_projections_household_identity_unique
        unique (id, household_id),
    constraint wine_enrichment_projections_version_identity_unique
        unique (id, knowledge_version_id)
);

create unique index wine_enrichment_projections_one_current_idx
    on public.wine_enrichment_projections(
        household_id,
        wine_id,
        projection_type,
        context_key
    )
    where status = 'current';

create index wine_enrichment_projections_wine_idx
    on public.wine_enrichment_projections(household_id, wine_id, calculated_at desc);

create or replace function private.enforce_enrichment_projection_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_version_status text;
begin
    select version.status
    into v_version_status
    from public.enrichment_knowledge_versions version
    where version.id = new.knowledge_version_id;

    if not found then
        raise exception using
            errcode = '23503',
            message = 'Enrichment projection requires a knowledge version';
    end if;

    if new.status = 'current' and v_version_status <> 'active' then
        raise exception using
            errcode = '23514',
            message = 'A current projection requires an active knowledge version';
    end if;

    return new;
end;
$$;

revoke execute
on function private.enforce_enrichment_projection_version()
from public, anon, authenticated;

create trigger wine_enrichment_projections_enforce_version
before insert or update on public.wine_enrichment_projections
for each row
execute function private.enforce_enrichment_projection_version();


create table public.wine_enrichment_projection_profiles (
    projection_id uuid not null,
    knowledge_version_id uuid not null,
    profile_id uuid not null,
    contribution_order integer not null,
    created_at timestamptz not null default now(),

    primary key (projection_id, profile_id),
    constraint wine_enrichment_projection_profiles_projection_fk
        foreign key (projection_id, knowledge_version_id)
        references public.wine_enrichment_projections(id, knowledge_version_id)
        on delete cascade,
    constraint wine_enrichment_projection_profiles_profile_fk
        foreign key (profile_id, knowledge_version_id)
        references public.enrichment_profiles(id, knowledge_version_id),
    constraint wine_enrichment_projection_profiles_order_check
        check (contribution_order > 0),
    constraint wine_enrichment_projection_profiles_order_unique
        unique (projection_id, contribution_order)
);

create table public.wine_enrichment_projection_evidence (
    projection_id uuid not null
        references public.wine_enrichment_projections(id)
        on delete cascade,
    evidence_id uuid not null
        references public.enrichment_evidence(id),
    created_at timestamptz not null default now(),

    primary key (projection_id, evidence_id)
);

create table public.wine_enrichment_projection_observations (
    projection_id uuid not null,
    household_id uuid not null,
    observation_id uuid not null,
    created_at timestamptz not null default now(),

    primary key (projection_id, observation_id),
    constraint wine_enrichment_projection_observations_projection_fk
        foreign key (projection_id, household_id)
        references public.wine_enrichment_projections(id, household_id)
        on delete cascade,
    constraint wine_enrichment_projection_observations_observation_fk
        foreign key (observation_id, household_id)
        references public.household_wine_observations(id, household_id)
);


-- Shared knowledge is service-only. Household observations and projections
-- may be read online by their household, but are not yet browser-writable or
-- copied to PowerSync; later roadmap steps add the required mutation workflows.
alter table public.enrichment_sources enable row level security;
alter table public.enrichment_source_policies enable row level security;
alter table public.enrichment_places enable row level security;
alter table public.enrichment_knowledge_versions enable row level security;
alter table public.enrichment_profiles enable row level security;
alter table public.enrichment_place_profiles enable row level security;
alter table public.enrichment_vintage_profiles enable row level security;
alter table public.enrichment_producer_era_profiles enable row level security;
alter table public.enrichment_cuvee_profiles enable row level security;
alter table public.enrichment_evidence enable row level security;
alter table public.enrichment_profile_evidence enable row level security;
alter table public.household_wine_observations enable row level security;
alter table public.wine_enrichment_projections enable row level security;
alter table public.wine_enrichment_projection_profiles enable row level security;
alter table public.wine_enrichment_projection_evidence enable row level security;
alter table public.wine_enrichment_projection_observations enable row level security;

create policy household_wine_observations_select_member
on public.household_wine_observations
for select
to authenticated
using (
    (select private.is_household_member(household_id))
    and (
        visibility = 'household'
        or recorded_by = (select auth.uid())
    )
);

create policy wine_enrichment_projections_select_member
on public.wine_enrichment_projections
for select
to authenticated
using ((select private.is_household_member(household_id)));

revoke all privileges on table
    public.enrichment_sources,
    public.enrichment_source_policies,
    public.enrichment_places,
    public.enrichment_knowledge_versions,
    public.enrichment_profiles,
    public.enrichment_place_profiles,
    public.enrichment_vintage_profiles,
    public.enrichment_producer_era_profiles,
    public.enrichment_cuvee_profiles,
    public.enrichment_evidence,
    public.enrichment_profile_evidence,
    public.household_wine_observations,
    public.wine_enrichment_projections,
    public.wine_enrichment_projection_profiles,
    public.wine_enrichment_projection_evidence,
    public.wine_enrichment_projection_observations
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.enrichment_sources,
    public.enrichment_source_policies,
    public.enrichment_places,
    public.enrichment_knowledge_versions,
    public.enrichment_profiles,
    public.enrichment_place_profiles,
    public.enrichment_vintage_profiles,
    public.enrichment_producer_era_profiles,
    public.enrichment_cuvee_profiles,
    public.enrichment_evidence,
    public.enrichment_profile_evidence,
    public.household_wine_observations,
    public.wine_enrichment_projections,
    public.wine_enrichment_projection_profiles,
    public.wine_enrichment_projection_evidence,
    public.wine_enrichment_projection_observations
to service_role;

grant select on table
    public.household_wine_observations,
    public.wine_enrichment_projections
to authenticated;

commit;
