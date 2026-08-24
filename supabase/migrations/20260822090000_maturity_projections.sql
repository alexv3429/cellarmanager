begin;

create extension if not exists pg_cron;


-- Storage recommendations can only be actionable when physical locations have
-- an explicit role. Existing locations remain valid as mixed storage until the
-- owner classifies them more precisely.
alter table public.locations
    add column storage_purpose text not null default 'mixed',
    add constraint locations_storage_purpose_check
        check (storage_purpose in ('aging', 'service', 'overflow', 'mixed'));

comment on column public.locations.storage_purpose is
    'Physical role used by maturity projections: aging, service, overflow, or mixed.';


create function public.create_location(
    p_household_id uuid,
    p_cellar_id uuid,
    p_code text,
    p_capacity integer,
    p_storage_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_location_id uuid;
begin
    if p_storage_purpose not in ('aging', 'service', 'overflow', 'mixed') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported location storage purpose';
    end if;

    v_location_id := public.create_location(
        p_household_id,
        p_cellar_id,
        p_code,
        p_capacity
    );

    update public.locations
    set storage_purpose = p_storage_purpose
    where id = v_location_id;

    return v_location_id;
end;
$$;

create function public.update_location(
    p_location_id uuid,
    p_code text,
    p_capacity integer,
    p_storage_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_storage_purpose not in ('aging', 'service', 'overflow', 'mixed') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported location storage purpose';
    end if;

    perform public.update_location(
        p_location_id,
        p_code,
        p_capacity
    );

    update public.locations
    set storage_purpose = p_storage_purpose
    where id = p_location_id;

    return p_location_id;
end;
$$;

revoke execute
on function public.create_location(uuid, uuid, text, integer, text)
from public, anon;

revoke execute
on function public.update_location(uuid, text, integer, text)
from public, anon;

grant execute
on function public.create_location(uuid, uuid, text, integer, text)
to authenticated;

grant execute
on function public.update_location(uuid, text, integer, text)
to authenticated;


-- Place aliases belong to reviewed shared knowledge, not household wine text.
-- A normalized alias resolves to one place only; ambiguous geography must be
-- modeled more specifically instead of being selected arbitrarily.
create table public.enrichment_place_aliases (
    id uuid primary key default gen_random_uuid(),
    place_id uuid not null
        references public.enrichment_places(id)
        on delete cascade,
    alias_value text not null,
    normalized_value text generated always as (
        private.normalize_wine_reference_text(alias_value)
    ) stored,
    locale text,
    created_at timestamptz not null default now(),

    constraint enrichment_place_aliases_value_check
        check (length(trim(alias_value)) > 0),
    constraint enrichment_place_aliases_normalized_unique
        unique (normalized_value),
    constraint enrichment_place_aliases_place_unique
        unique (place_id, normalized_value),
    constraint enrichment_place_aliases_locale_check
        check (locale is null or length(trim(locale)) > 0)
);

create index enrichment_place_aliases_place_idx
    on public.enrichment_place_aliases(place_id);


-- Feedback repeats household and wine IDs so its access checks remain narrow.
-- Enforce that all three values identify the same model projection rather than
-- relying only on the RPC that currently writes reviews.
alter table public.wine_enrichment_projections
add constraint wine_enrichment_projections_household_wine_identity_unique
unique (id, household_id, wine_id);


-- Feedback evaluates one model projection. A later recalculation receives a
-- new projection ID and therefore cannot inherit approval for an old result.
create table public.wine_enrichment_projection_feedback (
    projection_id uuid not null,
    household_id uuid not null,
    wine_id uuid not null,
    reviewed_by uuid not null
        references auth.users(id)
        on delete cascade,
    verdict text not null,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (projection_id, reviewed_by),
    constraint wine_enrichment_projection_feedback_projection_fk
        foreign key (projection_id, household_id, wine_id)
        references public.wine_enrichment_projections(id, household_id, wine_id)
        on delete cascade,
    constraint wine_enrichment_projection_feedback_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint wine_enrichment_projection_feedback_verdict_check
        check (verdict in ('useful', 'questionable', 'wrong')),
    constraint wine_enrichment_projection_feedback_note_check
        check (note is null or length(trim(note)) > 0)
);


-- An owner override sits beside, rather than overwriting, the model result.
-- The raw projection and its evidence stay inspectable while the application
-- clearly presents the household-maintained window as effective advice.
create table public.wine_maturity_overrides (
    household_id uuid not null,
    wine_id uuid not null,
    first_trial_year integer not null,
    best_start_year integer not null,
    best_end_year integer not null,
    drink_by_year integer not null,
    storage_purpose text,
    note text,
    created_by uuid not null
        references auth.users(id)
        on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (household_id, wine_id),
    constraint wine_maturity_overrides_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint wine_maturity_overrides_years_check
        check (
            first_trial_year between 1800 and 2300
            and first_trial_year <= best_start_year
            and best_start_year <= best_end_year
            and best_end_year <= drink_by_year
            and drink_by_year <= 2300
        ),
    constraint wine_maturity_overrides_storage_check
        check (
            storage_purpose is null
            or storage_purpose in (
                'aging',
                'service',
                'overflow',
                'mixed'
            )
        ),
    constraint wine_maturity_overrides_note_check
        check (note is null or length(trim(note)) > 0)
);


alter table public.enrichment_place_aliases enable row level security;
alter table public.wine_enrichment_projection_feedback enable row level security;
alter table public.wine_maturity_overrides enable row level security;

create policy wine_enrichment_projection_feedback_select_member
on public.wine_enrichment_projection_feedback
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy wine_maturity_overrides_select_member
on public.wine_maturity_overrides
for select
to authenticated
using ((select private.is_household_member(household_id)));

revoke all privileges on table
    public.enrichment_place_aliases,
    public.wine_enrichment_projection_feedback,
    public.wine_maturity_overrides
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.enrichment_place_aliases,
    public.wine_enrichment_projection_feedback,
    public.wine_maturity_overrides
to service_role;

grant select on table
    public.wine_enrichment_projection_feedback,
    public.wine_maturity_overrides
to authenticated;


create or replace function private.enrichment_seed_uuid(p_key text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
    select pg_catalog.md5('cellarmanager-enrichment:' || p_key)::uuid;
$$;

revoke execute
on function private.enrichment_seed_uuid(text)
from public, anon, authenticated;

grant execute
on function private.enrichment_seed_uuid(text)
to service_role;


-- Install the exact maturity knowledge reviewed in the 0.4.5 POC. Calling
-- this function is an explicit production action: the schema migration alone
-- does not activate knowledge or start calculations.
create or replace function public.install_initial_maturity_knowledge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_source_id uuid := private.enrichment_seed_uuid('source:cellarmanager-maturity');
    v_policy_id uuid := private.enrichment_seed_uuid('policy:cellarmanager-maturity-v1');
    v_evidence_id uuid := private.enrichment_seed_uuid('evidence:inference-poc-accepted');
    v_version_id uuid := private.enrichment_seed_uuid('knowledge:maturity-v1');
    v_place record;
    v_profile record;
    v_parent_id uuid;
    v_place_id uuid;
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
        where version.version_number = 1
          and version.id <> v_version_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'Knowledge version 1 is already used by another model';
    end if;

    insert into public.enrichment_sources (
        id,
        source_key,
        source_name,
        source_kind
    )
    values (
        v_source_id,
        'cellarmanager-maturity-model',
        'CellarManager reviewed maturity model',
        'cellarmanager'
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
        '2026-08-21',
        '2026-08-21',
        'https://github.com/alexv3429/cellarmanager/blob/main/docs/enrichment-inference-poc.md',
        'allowed',
        'allowed',
        'prohibited',
        'allowed',
        'allowed',
        'allowed',
        'CellarManager reviewed maturity model',
        'CellarManager owns the derived model. External sources support profile inputs but do not claim the resulting drinking windows.'
    )
    on conflict (id) do nothing;

    for v_place in
        select *
        from jsonb_to_recordset($json$
        [
          {"key":"bourgogne","parent":null,"type":"region","name":"Bourgogne","country":"FR","aliases":["Bourgogne","Burgundy"]},
          {"key":"languedoc","parent":null,"type":"region","name":"Languedoc","country":"FR","aliases":["Languedoc","Languedoc-Roussillon"]},
          {"key":"piemonte","parent":null,"type":"region","name":"Piemonte","country":"IT","aliases":["Piemonte","Piedmont"]},
          {"key":"volnay-premier-cru","parent":"bourgogne","type":"appellation","name":"Volnay Premier Cru","country":"FR","aliases":["Volnay 1C","Volnay 1er Cru","Volnay Premier Cru"]},
          {"key":"chambolle-premier-cru","parent":"bourgogne","type":"appellation","name":"Chambolle-Musigny Premier Cru","country":"FR","aliases":["Chambolle-Musigny 1C","Chambolle Musigny 1C","Chambolle-Musigny 1er Cru","Chambolle-Musigny Premier Cru"]},
          {"key":"puligny-premier-cru","parent":"bourgogne","type":"appellation","name":"Puligny-Montrachet Premier Cru","country":"FR","aliases":["Puligny-Montrachet 1C","Puligny Montrachet 1C","Puligny-Montrachet 1er Cru","Puligny-Montrachet Premier Cru"]},
          {"key":"pic-saint-loup","parent":"languedoc","type":"appellation","name":"Pic Saint-Loup","country":"FR","aliases":["Pic Saint Loup","Pic-Saint-Loup"]},
          {"key":"barolo","parent":"piemonte","type":"appellation","name":"Barolo","country":"IT","aliases":["Barolo"]},
          {"key":"barbaresco","parent":"piemonte","type":"appellation","name":"Barbaresco","country":"IT","aliases":["Barbaresco"]}
        ]
        $json$::jsonb) as place_seed(
            key text,
            parent text,
            type text,
            name text,
            country text,
            aliases jsonb
        )
        order by case when parent is null then 0 else 1 end, key
    loop
        v_place_id := private.enrichment_seed_uuid('place:' || v_place.key);
        v_parent_id := case
            when v_place.parent is null then null
            else private.enrichment_seed_uuid('place:' || v_place.parent)
        end;

        insert into public.enrichment_places (
            id,
            parent_id,
            place_type,
            canonical_name,
            country_code
        )
        values (
            v_place_id,
            v_parent_id,
            v_place.type,
            v_place.name,
            v_place.country
        )
        on conflict (id) do nothing;

        insert into public.enrichment_place_aliases (
            place_id,
            alias_value
        )
        select
            v_place_id,
            alias.value
        from jsonb_array_elements_text(v_place.aliases) alias(value)
        on conflict (normalized_value) do nothing;
    end loop;

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
        'docs/enrichment-inference-poc.md',
        'https://github.com/alexv3429/cellarmanager/blob/main/docs/enrichment-inference-poc.md',
        'pointer-only',
        'methodology',
        'methodology',
        'reviewed',
        '2026-08-21T18:00:00Z',
        '2026-08-21'
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
        1,
        'Reviewed maturity POC baseline',
        'curated-inference',
        '1.0.0'
    )
    on conflict (id) do nothing;

    for v_profile in
        select *
        from jsonb_to_recordset($json$
        [
          {"key":"volnay-premier-cru-red","place":"volnay-premier-cru","color":"red","first":6,"best_start":10,"best_end":16,"outer_age":23,"body":3.2,"acidity":4.2,"tannin":3.5,"sweetness":0,"alcohol":3,"freshness":4.2,"savory":3.2,"confidence":0.76,"rationale":"Volnay Premier Cru red baseline; the age ranges are a curated model hypothesis, not an INAO drinking-window claim."},
          {"key":"chambolle-premier-cru-red","place":"chambolle-premier-cru","color":"red","first":7,"best_start":11,"best_end":18,"outer_age":25,"body":3,"acidity":4.2,"tannin":3.2,"sweetness":0,"alcohol":3,"freshness":4.2,"savory":3,"confidence":0.68,"rationale":"Chambolle-Musigny Premier Cru red baseline awaiting a dedicated regulatory or site source."},
          {"key":"puligny-premier-cru-white","place":"puligny-premier-cru","color":"white","first":4,"best_start":7,"best_end":12,"outer_age":18,"body":3.5,"acidity":4.5,"tannin":0,"sweetness":0,"alcohol":3.2,"freshness":4.5,"savory":3.3,"confidence":0.72,"rationale":"Puligny-Montrachet Premier Cru white baseline calibrated for a taut, mineral example."},
          {"key":"pic-saint-loup-red","place":"pic-saint-loup","color":"red","first":4,"best_start":7,"best_end":12,"outer_age":18,"body":4.1,"acidity":3.5,"tannin":4,"sweetness":0,"alcohol":4,"freshness":3.6,"savory":4.2,"confidence":0.82,"rationale":"Official Pic Saint-Loup red structure informs the profile; maturity ages remain a curated model hypothesis."},
          {"key":"languedoc-white","place":"languedoc","color":"white","first":2,"best_start":4,"best_end":7,"outer_age":11,"body":3.2,"acidity":3.6,"tannin":0,"sweetness":0,"alcohol":3.5,"freshness":3.7,"savory":2.8,"confidence":0.48,"rationale":"Broad white Languedoc fallback used only when a precise reviewed appellation profile is unavailable."},
          {"key":"barolo-red","place":"barolo","color":"red","first":9,"best_start":14,"best_end":22,"outer_age":32,"body":4,"acidity":4.5,"tannin":5,"sweetness":0,"alcohol":4,"freshness":4.2,"savory":4.8,"confidence":0.83,"rationale":"Nebbiolo and Barolo baseline built independently from Burgundy; maturity ages are a curated model hypothesis."},
          {"key":"barbaresco-red","place":"barbaresco","color":"red","first":7,"best_start":11,"best_end":18,"outer_age":26,"body":3.7,"acidity":4.5,"tannin":4.5,"sweetness":0,"alcohol":3.8,"freshness":4.2,"savory":4.5,"confidence":0.78,"rationale":"Nebbiolo and Barbaresco baseline built independently from Burgundy."}
        ]
        $json$::jsonb) as profile_seed(
            key text,
            place text,
            color text,
            first integer,
            best_start integer,
            best_end integer,
            outer_age integer,
            body numeric,
            acidity numeric,
            tannin numeric,
            sweetness numeric,
            alcohol numeric,
            freshness numeric,
            savory numeric,
            confidence numeric,
            rationale text
        )
    loop
        v_profile_id := private.enrichment_seed_uuid('profile:' || v_profile.key);
        v_place_id := private.enrichment_seed_uuid('place:' || v_profile.place);

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
            'place',
            'reviewed',
            v_profile.confidence,
            v_profile.rationale,
            '2026-08-21T18:00:00Z'
        )
        on conflict (id) do nothing;

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
            savory
        )
        values (
            v_profile_id,
            v_version_id,
            v_place_id,
            v_profile.color,
            v_profile.first,
            v_profile.best_start,
            v_profile.best_end,
            v_profile.outer_age,
            v_profile.body,
            v_profile.acidity,
            v_profile.tannin,
            v_profile.sweetness,
            v_profile.alcohol,
            v_profile.freshness,
            v_profile.savory
        )
        on conflict (profile_id) do nothing;

        insert into public.enrichment_profile_evidence (
            profile_id,
            evidence_id,
            evidence_role
        )
        values (v_profile_id, v_evidence_id, 'supports')
        on conflict do nothing;
    end loop;

    for v_profile in
        select *
        from jsonb_to_recordset($json$
        [
          {"key":"bourgogne-red-2017","place":"bourgogne","vintage":2017,"color":"red","opening":-1,"longevity":-1,"body":-0.2,"acidity":0,"tannin":-0.3,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.82,"rationale":"Elegant, expressive and harmonious rather than a deeply structured default year."},
          {"key":"bourgogne-red-2018","place":"bourgogne","vintage":2018,"color":"red","opening":1,"longevity":2,"body":0.4,"acidity":0,"tannin":0.4,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.86,"rationale":"Concentrated, structured and balanced red vintage with good keeping potential."},
          {"key":"bourgogne-red-2020","place":"bourgogne","vintage":2020,"color":"red","opening":2,"longevity":3,"body":0.4,"acidity":0.2,"tannin":0.5,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.88,"rationale":"Hot, dry season with retained acidity and impressive tannic structure."},
          {"key":"bourgogne-red-2022","place":"bourgogne","vintage":2022,"color":"red","opening":1,"longevity":2,"body":0.2,"acidity":0,"tannin":0.2,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.56,"rationale":"Preliminary profile requiring a more specific Cote de Beaune vintage source."},
          {"key":"bourgogne-white-2017","place":"bourgogne","vintage":2017,"color":"white","opening":0,"longevity":1,"body":0,"acidity":0.3,"tannin":0,"sweetness":0,"alcohol":0,"freshness":0.3,"savory":0,"confidence":0.82,"rationale":"Elegant, balanced and mineral white vintage."},
          {"key":"bourgogne-white-2021","place":"bourgogne","vintage":2021,"color":"white","opening":0,"longevity":1,"body":-0.2,"acidity":0.5,"tannin":0,"sweetness":0,"alcohol":0,"freshness":0.5,"savory":0,"confidence":0.70,"rationale":"Lively, delicate profile; producer and site acidity can still support ageing."},
          {"key":"languedoc-red-2013","place":"languedoc","vintage":2013,"color":"red","opening":-1,"longevity":-2,"body":-0.4,"acidity":0,"tannin":-0.3,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.50,"rationale":"Accepted owner seed observation: lighter profile intended for earlier drinking."},
          {"key":"languedoc-red-2017","place":"languedoc","vintage":2017,"color":"red","opening":1,"longevity":2,"body":0.4,"acidity":0,"tannin":0.4,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.52,"rationale":"Accepted owner seed observation: concentrated and structured."},
          {"key":"languedoc-red-2018","place":"languedoc","vintage":2018,"color":"red","opening":0,"longevity":1,"body":0.2,"acidity":0,"tannin":0,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.50,"rationale":"Accepted owner seed observation awaiting an official local vintage source."},
          {"key":"languedoc-red-2019","place":"languedoc","vintage":2019,"color":"red","opening":1,"longevity":2,"body":0.4,"acidity":0,"tannin":0.2,"sweetness":0,"alcohol":0.2,"freshness":0,"savory":0,"confidence":0.50,"rationale":"Accepted owner seed observation: rich, solar and powerful while balanced."},
          {"key":"languedoc-red-2020","place":"languedoc","vintage":2020,"color":"red","opening":1,"longevity":2,"body":0.3,"acidity":0,"tannin":0.4,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.50,"rationale":"Accepted owner seed observation: warm year with firm structure."},
          {"key":"languedoc-red-2022","place":"languedoc","vintage":2022,"color":"red","opening":0,"longevity":1,"body":0.2,"acidity":0,"tannin":0,"sweetness":0,"alcohol":0,"freshness":0.2,"savory":0,"confidence":0.48,"rationale":"Accepted owner seed observation awaiting an official local vintage source."},
          {"key":"languedoc-white-2020","place":"languedoc","vintage":2020,"color":"white","opening":0,"longevity":1,"body":0.2,"acidity":0,"tannin":0,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.46,"rationale":"Accepted owner seed observation; intentionally low confidence."},
          {"key":"piemonte-red-2006","place":"piemonte","vintage":2006,"color":"red","opening":2,"longevity":4,"body":0,"acidity":0.2,"tannin":0.4,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.70,"rationale":"Structured long-ageing Piemonte seed, backed by the regional vintage archive and owner history."},
          {"key":"piemonte-red-2008","place":"piemonte","vintage":2008,"color":"red","opening":0,"longevity":1,"body":0,"acidity":0.2,"tannin":0,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.68,"rationale":"Balanced Piemonte seed, independently sourced from the regional archive rather than Burgundy."},
          {"key":"piemonte-red-2017","place":"piemonte","vintage":2017,"color":"red","opening":0,"longevity":1,"body":0.2,"acidity":0,"tannin":0.2,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.74,"rationale":"Low-yield, fast-ripening year still assessed as excellent for important, long-lived reds."},
          {"key":"piemonte-red-2018","place":"piemonte","vintage":2018,"color":"red","opening":-1,"longevity":1,"body":0.2,"acidity":0,"tannin":-0.1,"sweetness":0,"alcohol":0,"freshness":0,"savory":0,"confidence":0.82,"rationale":"Four-star Piemonte vintage with a less severe opening hypothesis than 2006."}
        ]
        $json$::jsonb) as profile_seed(
            key text,
            place text,
            vintage integer,
            color text,
            opening integer,
            longevity integer,
            body numeric,
            acidity numeric,
            tannin numeric,
            sweetness numeric,
            alcohol numeric,
            freshness numeric,
            savory numeric,
            confidence numeric,
            rationale text
        )
    loop
        v_profile_id := private.enrichment_seed_uuid('profile:' || v_profile.key);
        v_place_id := private.enrichment_seed_uuid('place:' || v_profile.place);

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
            'vintage',
            'reviewed',
            v_profile.confidence,
            v_profile.rationale,
            '2026-08-21T18:00:00Z'
        )
        on conflict (id) do nothing;

        insert into public.enrichment_vintage_profiles (
            profile_id,
            knowledge_version_id,
            place_id,
            vintage_year,
            wine_color,
            first_trial_age_adjustment,
            best_start_age_adjustment,
            best_end_age_adjustment,
            outer_horizon_age_adjustment,
            body_adjustment,
            acidity_adjustment,
            tannin_adjustment,
            sweetness_adjustment,
            alcohol_adjustment,
            freshness_adjustment,
            savory_adjustment
        )
        values (
            v_profile_id,
            v_version_id,
            v_place_id,
            v_profile.vintage,
            v_profile.color,
            v_profile.opening,
            v_profile.opening,
            v_profile.longevity,
            v_profile.longevity,
            v_profile.body,
            v_profile.acidity,
            v_profile.tannin,
            v_profile.sweetness,
            v_profile.alcohol,
            v_profile.freshness,
            v_profile.savory
        )
        on conflict (profile_id) do nothing;

        insert into public.enrichment_profile_evidence (
            profile_id,
            evidence_id,
            evidence_role
        )
        values (v_profile_id, v_evidence_id, 'supports')
        on conflict do nothing;
    end loop;

    return public.publish_enrichment_knowledge_version(v_version_id)
        || jsonb_build_object('already_installed', false);
end;
$$;

comment on function public.install_initial_maturity_knowledge() is
    'Idempotently installs and atomically publishes the owner-accepted 0.4.5 maturity baseline.';

revoke execute
on function public.install_initial_maturity_knowledge()
from public, anon, authenticated;

grant execute
on function public.install_initial_maturity_knowledge()
to service_role;


create or replace function private.canonical_enrichment_wine_color(p_color text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when private.normalize_wine_reference_text(p_color) in ('red', 'rouge') then 'red'
        when private.normalize_wine_reference_text(p_color) in ('white', 'blanc') then 'white'
        when private.normalize_wine_reference_text(p_color) in ('rose', 'pink') then 'rose'
        when private.normalize_wine_reference_text(p_color) in ('sparkling', 'effervescent', 'champagne') then 'sparkling'
        when private.normalize_wine_reference_text(p_color) in ('sweet', 'doux', 'liquoreux') then 'sweet'
        when private.normalize_wine_reference_text(p_color) in ('fortified', 'fortifie') then 'fortified'
        else 'other'
    end;
$$;

revoke execute
on function private.canonical_enrichment_wine_color(text)
from public, anon, authenticated;

grant execute
on function private.canonical_enrichment_wine_color(text)
to service_role;


-- Maturity advice depends on the wine, the current calendar year, physical
-- quantities, and the available storage roles. Pairing keeps the narrower wine
-- identity fingerprint introduced in 0.4.7.
create or replace function private.maturity_enrichment_input_fingerprint(
    p_wine public.wines
)
returns text
language sql
stable
set search_path = ''
as $$
    select pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(
                pg_catalog.concat_ws(
                    '|',
                    private.wine_enrichment_input_fingerprint(p_wine),
                    extract(year from current_date)::integer::text,
                    coalesce((
                        select string_agg(
                            pg_catalog.concat_ws(
                                ':',
                                holding.location_id::text,
                                holding.quantity::text,
                                location.storage_purpose,
                                location.is_active::text,
                                cellar.is_active::text
                            ),
                            ','
                            order by holding.location_id
                        )
                        from public.holdings holding
                        join public.locations location
                          on location.id = holding.location_id
                        join public.cellars cellar
                          on cellar.id = location.cellar_id
                        where holding.household_id = p_wine.household_id
                          and holding.wine_id = p_wine.id
                          and holding.quantity > 0
                    ), 'no-holdings'),
                    coalesce((
                        select string_agg(
                            pg_catalog.concat_ws(
                                ':',
                                location.id::text,
                                location.storage_purpose,
                                location.is_active::text,
                                cellar.is_active::text
                            ),
                            ','
                            order by location.id
                        )
                        from public.locations location
                        join public.cellars cellar
                          on cellar.id = location.cellar_id
                        where location.household_id = p_wine.household_id
                    ), 'no-locations')
                ),
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    );
$$;

revoke execute
on function private.maturity_enrichment_input_fingerprint(public.wines)
from public, anon, authenticated;

grant execute
on function private.maturity_enrichment_input_fingerprint(public.wines)
to service_role;


create or replace function private.requeue_wine_maturity_demand(
    p_household_id uuid,
    p_wine_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_demand_id uuid;
    v_fingerprint text;
begin
    select wine.*
    into v_wine
    from public.wines wine
    where wine.id = p_wine_id
      and wine.household_id = p_household_id;

    if not found then
        return false;
    end if;

    v_fingerprint := private.maturity_enrichment_input_fingerprint(v_wine);

    insert into public.enrichment_demands (
        household_id,
        wine_id,
        capability,
        input_fingerprint
    )
    values (
        p_household_id,
        p_wine_id,
        'maturity',
        v_fingerprint
    )
    on conflict (household_id, wine_id, capability)
    do update set
        input_fingerprint = excluded.input_fingerprint,
        demand_status = 'queued',
        attempt_count = 0,
        next_attempt_at = null,
        last_attempted_at = null,
        last_completed_at = null,
        last_error_code = null,
        requested_at = now(),
        updated_at = now()
    where public.enrichment_demands.input_fingerprint
        is distinct from excluded.input_fingerprint
    returning id into v_demand_id;

    if v_demand_id is null then
        return false;
    end if;

    update public.enrichment_jobs job
    set
        job_status = 'cancelled',
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        next_attempt_at = null,
        completed_at = now(),
        updated_at = now(),
        last_error_code = 'stale-maturity-input'
    where job.demand_id = v_demand_id
      and job.job_status in ('queued', 'leased', 'retrying')
      and job.input_fingerprint <> v_fingerprint;

    return true;
end;
$$;

revoke execute
on function private.requeue_wine_maturity_demand(uuid, uuid)
from public, anon, authenticated;

grant execute
on function private.requeue_wine_maturity_demand(uuid, uuid)
to service_role;


create or replace function private.queue_wine_enrichment_demands()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_capability text;
    v_demand_id uuid;
    v_fingerprint text;
begin
    foreach v_capability in array array['maturity', 'pairing-profile']::text[]
    loop
        v_demand_id := null;
        v_fingerprint := case
            when v_capability = 'maturity'
                then private.maturity_enrichment_input_fingerprint(new)
            else private.wine_enrichment_input_fingerprint(new)
        end;

        insert into public.enrichment_demands (
            household_id,
            wine_id,
            capability,
            input_fingerprint
        )
        values (
            new.household_id,
            new.id,
            v_capability,
            v_fingerprint
        )
        on conflict (household_id, wine_id, capability)
        do update set
            input_fingerprint = excluded.input_fingerprint,
            demand_status = 'queued',
            attempt_count = 0,
            next_attempt_at = null,
            last_attempted_at = null,
            last_completed_at = null,
            last_error_code = null,
            requested_at = now(),
            updated_at = now()
        where public.enrichment_demands.input_fingerprint
            is distinct from excluded.input_fingerprint
        returning id into v_demand_id;

        if v_demand_id is not null then
            update public.enrichment_jobs job
            set
                job_status = 'cancelled',
                lease_token = null,
                leased_by = null,
                lease_expires_at = null,
                next_attempt_at = null,
                completed_at = now(),
                updated_at = now(),
                last_error_code = 'stale-wine-input'
            where job.demand_id = v_demand_id
              and job.job_status in ('queued', 'leased', 'retrying')
              and job.input_fingerprint <> v_fingerprint;
        end if;
    end loop;

    return new;
end;
$$;


create or replace function private.requeue_maturity_after_holding_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    perform private.requeue_wine_maturity_demand(
        coalesce(new.household_id, old.household_id),
        coalesce(new.wine_id, old.wine_id)
    );

    if tg_op = 'UPDATE'
       and (new.household_id, new.wine_id)
           is distinct from (old.household_id, old.wine_id)
    then
        perform private.requeue_wine_maturity_demand(
            old.household_id,
            old.wine_id
        );
    end if;

    return coalesce(new, old);
end;
$$;

revoke execute
on function private.requeue_maturity_after_holding_change()
from public, anon, authenticated;

create trigger holdings_requeue_maturity
after insert or update or delete on public.holdings
for each row
execute function private.requeue_maturity_after_holding_change();


create or replace function private.requeue_household_maturity_demands()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_household_id uuid := coalesce(new.household_id, old.household_id);
    v_wine record;
begin
    for v_wine in
        select wine.id
        from public.wines wine
        where wine.household_id = v_household_id
    loop
        perform private.requeue_wine_maturity_demand(
            v_household_id,
            v_wine.id
        );
    end loop;

    if tg_op = 'UPDATE'
       and new.household_id is distinct from old.household_id
    then
        for v_wine in
            select wine.id
            from public.wines wine
            where wine.household_id = old.household_id
        loop
            perform private.requeue_wine_maturity_demand(
                old.household_id,
                v_wine.id
            );
        end loop;
    end if;

    return coalesce(new, old);
end;
$$;

revoke execute
on function private.requeue_household_maturity_demands()
from public, anon, authenticated;

create trigger locations_requeue_maturity
after insert or delete or update of
    household_id,
    cellar_id,
    is_active,
    storage_purpose
on public.locations
for each row
execute function private.requeue_household_maturity_demands();

create trigger cellars_requeue_maturity
after update of is_active on public.cellars
for each row
when (old.is_active is distinct from new.is_active)
execute function private.requeue_household_maturity_demands();


-- Replace the 0.4.7 wine-only maturity fingerprints with the complete
-- wine/holdings/storage/year input before any knowledge version is activated.
do $$
declare
    v_wine record;
begin
    for v_wine in
        select wine.household_id, wine.id
        from public.wines wine
    loop
        perform private.requeue_wine_maturity_demand(
            v_wine.household_id,
            v_wine.id
        );
    end loop;
end
$$;


create or replace function private.maturity_state_from_window(
    p_as_of_year integer,
    p_first_trial_year integer,
    p_best_start_year integer,
    p_best_end_year integer,
    p_drink_by_year integer
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select case
        when p_as_of_year < p_first_trial_year then 'hold'
        when p_as_of_year < p_best_start_year then 'assess'
        when p_as_of_year <= p_best_end_year then 'ready'
        when p_as_of_year <= p_drink_by_year then 'priority'
        else 'assess-now'
    end;
$$;

create or replace function private.maturity_state_label(p_state text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select case p_state
        when 'hold' then 'Hold'
        when 'assess' then 'Start assessing'
        when 'ready' then 'Likely ready'
        when 'priority' then 'Prioritize'
        when 'assess-now' then 'Assess now'
    end;
$$;

create or replace function private.maturity_urgency(p_state text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select case p_state
        when 'hold' then 'later'
        when 'assess' then 'watch'
        when 'ready' then 'ready'
        when 'priority' then 'priority'
        when 'assess-now' then 'overdue'
    end;
$$;

create or replace function private.maturity_urgency_score(p_state text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
    select case p_state
        when 'hold' then 10
        when 'assess' then 35
        when 'ready' then 55
        when 'priority' then 85
        when 'assess-now' then 100
    end;
$$;

revoke execute
on function private.maturity_state_from_window(integer, integer, integer, integer, integer)
from public, anon, authenticated;

revoke execute
on function private.maturity_state_label(text)
from public, anon, authenticated;

revoke execute
on function private.maturity_urgency(text)
from public, anon, authenticated;

revoke execute
on function private.maturity_urgency_score(text)
from public, anon, authenticated;

grant execute
on function private.maturity_state_from_window(integer, integer, integer, integer, integer)
to service_role;

grant execute
on function private.maturity_state_label(text)
to service_role;

grant execute
on function private.maturity_urgency(text)
to service_role;

grant execute
on function private.maturity_urgency_score(text)
to service_role;


create or replace function public.get_household_maturity_overview(
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
    v_as_of_year integer := extract(year from current_date)::integer;
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

    with projection_rows as (
        select
            wine.id as wine_id,
            maturity.id as projection_id,
            maturity.confidence,
            maturity.calculated_at,
            maturity.recommendation as maturity_recommendation,
            storage.recommendation as storage_recommendation,
            override.first_trial_year as override_first_trial_year,
            override.best_start_year as override_best_start_year,
            override.best_end_year as override_best_end_year,
            override.drink_by_year as override_drink_by_year,
            override.storage_purpose as override_storage_purpose,
            override.updated_at as override_updated_at,
            demand.demand_status,
            feedback.verdict as feedback_verdict
        from public.wines wine
        left join public.wine_enrichment_projections maturity
          on maturity.household_id = wine.household_id
         and maturity.wine_id = wine.id
         and maturity.projection_type = 'maturity'
         and maturity.context_key = ''
         and maturity.status = 'current'
        left join public.wine_enrichment_projections storage
          on storage.household_id = wine.household_id
         and storage.wine_id = wine.id
         and storage.projection_type = 'storage'
         and storage.context_key = ''
         and storage.status = 'current'
        left join public.wine_maturity_overrides override
          on override.household_id = wine.household_id
         and override.wine_id = wine.id
        left join public.enrichment_demands demand
          on demand.household_id = wine.household_id
         and demand.wine_id = wine.id
         and demand.capability = 'maturity'
        left join public.wine_enrichment_projection_feedback feedback
          on feedback.projection_id = maturity.id
         and feedback.reviewed_by = v_user_id
        where wine.household_id = p_household_id
    ), effective_rows as (
        select
            projection_rows.*,
            projection_rows.override_first_trial_year is not null as is_override,
            case
                when projection_rows.override_first_trial_year is not null then
                    private.maturity_state_from_window(
                        v_as_of_year,
                        projection_rows.override_first_trial_year,
                        projection_rows.override_best_start_year,
                        projection_rows.override_best_end_year,
                        projection_rows.override_drink_by_year
                    )
                else projection_rows.maturity_recommendation ->> 'state'
            end as effective_state,
            coalesce(
                projection_rows.override_first_trial_year,
                (projection_rows.maturity_recommendation ->> 'first_trial_year')::integer
            ) as effective_first_trial_year,
            coalesce(
                projection_rows.override_best_start_year,
                (projection_rows.maturity_recommendation ->> 'best_start_year')::integer
            ) as effective_best_start_year,
            coalesce(
                projection_rows.override_best_end_year,
                (projection_rows.maturity_recommendation ->> 'best_end_year')::integer
            ) as effective_best_end_year,
            coalesce(
                projection_rows.override_drink_by_year,
                (projection_rows.maturity_recommendation ->> 'drink_by_year')::integer
            ) as effective_drink_by_year
        from projection_rows
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'wine_id', row.wine_id,
                'projection_id', row.projection_id,
                'is_override', row.is_override,
                'state', row.effective_state,
                'state_label', case
                    when row.effective_state is null then null
                    else private.maturity_state_label(row.effective_state)
                end,
                'urgency', case
                    when row.effective_state is null then null
                    else private.maturity_urgency(row.effective_state)
                end,
                'urgency_score', case
                    when row.effective_state is null then 0
                    else private.maturity_urgency_score(row.effective_state)
                end,
                'first_trial_year', row.effective_first_trial_year,
                'best_start_year', row.effective_best_start_year,
                'best_end_year', row.effective_best_end_year,
                'drink_by_year', row.effective_drink_by_year,
                'headline', case
                    when row.is_override then 'Owner-adjusted maturity window'
                    else row.maturity_recommendation ->> 'headline'
                end,
                'confidence', case
                    when row.is_override then 1
                    else row.confidence
                end,
                'confidence_label', case
                    when row.is_override then 'owner'
                    else row.maturity_recommendation ->> 'confidence_label'
                end,
                'storage_purpose', coalesce(
                    row.override_storage_purpose,
                    row.storage_recommendation ->> 'purpose'
                ),
                'move_needed', coalesce(
                    (row.storage_recommendation #>> '{move,needed}')::boolean,
                    false
                ),
                'move_message', row.storage_recommendation #>> '{move,message}',
                'demand_status', row.demand_status,
                'feedback_verdict', row.feedback_verdict,
                'calculated_at', row.calculated_at,
                'override_updated_at', row.override_updated_at
            )
            order by
                case
                    when row.effective_state is null then 0
                    else private.maturity_urgency_score(row.effective_state)
                end desc,
                row.effective_drink_by_year nulls last,
                row.wine_id
        ),
        '[]'::jsonb
    )
    into v_result
    from effective_rows row;

    return v_result;
end;
$$;


create or replace function public.get_wine_maturity(p_wine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_result jsonb;
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

    select jsonb_build_object(
        'wine_id', p_wine_id,
        'demand_status', demand.demand_status,
        'projection', case
            when maturity.id is null then null
            else jsonb_build_object(
                'id', maturity.id,
                'method', maturity.method,
                'specificity', maturity.specificity,
                'confidence', maturity.confidence,
                'calculated_at', maturity.calculated_at,
                'valid_until', maturity.valid_until,
                'maturity', maturity.recommendation,
                'storage', storage.recommendation
            )
        end,
        'override', case
            when override.wine_id is null then null
            else jsonb_build_object(
                'first_trial_year', override.first_trial_year,
                'best_start_year', override.best_start_year,
                'best_end_year', override.best_end_year,
                'drink_by_year', override.drink_by_year,
                'storage_purpose', override.storage_purpose,
                'note', override.note,
                'updated_at', override.updated_at
            )
        end,
        'feedback', case
            when feedback.projection_id is null then null
            else jsonb_build_object(
                'verdict', feedback.verdict,
                'note', feedback.note,
                'updated_at', feedback.updated_at
            )
        end
    )
    into v_result
    from public.wines wine
    left join public.enrichment_demands demand
      on demand.household_id = wine.household_id
     and demand.wine_id = wine.id
     and demand.capability = 'maturity'
    left join public.wine_enrichment_projections maturity
      on maturity.household_id = wine.household_id
     and maturity.wine_id = wine.id
     and maturity.projection_type = 'maturity'
     and maturity.context_key = ''
     and maturity.status = 'current'
    left join public.wine_enrichment_projections storage
      on storage.household_id = wine.household_id
     and storage.wine_id = wine.id
     and storage.projection_type = 'storage'
     and storage.context_key = ''
     and storage.status = 'current'
    left join public.wine_maturity_overrides override
      on override.household_id = wine.household_id
     and override.wine_id = wine.id
    left join public.wine_enrichment_projection_feedback feedback
      on feedback.projection_id = maturity.id
     and feedback.reviewed_by = v_user_id
    where wine.id = p_wine_id;

    return v_result;
end;
$$;


create or replace function public.review_wine_maturity_projection(
    p_projection_id uuid,
    p_verdict text,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_projection public.wine_enrichment_projections%rowtype;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_verdict not in ('useful', 'questionable', 'wrong') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported maturity review verdict';
    end if;

    select projection.*
    into v_projection
    from public.wine_enrichment_projections projection
    where projection.id = p_projection_id
      and projection.projection_type = 'maturity'
      and projection.status = 'current';

    if not found or not exists (
        select 1
        from public.household_members member
        where member.household_id = v_projection.household_id
          and member.user_id = v_user_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'A current household maturity projection is required';
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
        nullif(trim(p_note), '')
    )
    on conflict (projection_id, reviewed_by)
    do update set
        verdict = excluded.verdict,
        note = excluded.note,
        updated_at = now();

    return public.get_wine_maturity(v_projection.wine_id);
end;
$$;


create or replace function public.set_wine_maturity_override(
    p_wine_id uuid,
    p_first_trial_year integer,
    p_best_start_year integer,
    p_best_end_year integer,
    p_drink_by_year integer,
    p_storage_purpose text default null,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
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

    insert into public.wine_maturity_overrides (
        household_id,
        wine_id,
        first_trial_year,
        best_start_year,
        best_end_year,
        drink_by_year,
        storage_purpose,
        note,
        created_by
    )
    values (
        v_household_id,
        p_wine_id,
        p_first_trial_year,
        p_best_start_year,
        p_best_end_year,
        p_drink_by_year,
        p_storage_purpose,
        nullif(trim(p_note), ''),
        v_user_id
    )
    on conflict (household_id, wine_id)
    do update set
        first_trial_year = excluded.first_trial_year,
        best_start_year = excluded.best_start_year,
        best_end_year = excluded.best_end_year,
        drink_by_year = excluded.drink_by_year,
        storage_purpose = excluded.storage_purpose,
        note = excluded.note,
        created_by = excluded.created_by,
        updated_at = now();

    return public.get_wine_maturity(p_wine_id);
end;
$$;


create or replace function public.clear_wine_maturity_override(
    p_wine_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
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

    delete from public.wine_maturity_overrides override
    where override.household_id = v_household_id
      and override.wine_id = p_wine_id;

    return public.get_wine_maturity(p_wine_id);
end;
$$;


revoke execute
on function public.get_household_maturity_overview(uuid)
from public, anon;

revoke execute
on function public.get_wine_maturity(uuid)
from public, anon;

revoke execute
on function public.review_wine_maturity_projection(uuid, text, text)
from public, anon;

revoke execute
on function public.set_wine_maturity_override(uuid, integer, integer, integer, integer, text, text)
from public, anon;

revoke execute
on function public.clear_wine_maturity_override(uuid)
from public, anon;

grant execute
on function public.get_household_maturity_overview(uuid)
to authenticated;

grant execute
on function public.get_wine_maturity(uuid)
to authenticated;

grant execute
on function public.review_wine_maturity_projection(uuid, text, text)
to authenticated;

grant execute
on function public.set_wine_maturity_override(uuid, integer, integer, integer, integer, text, text)
to authenticated;

grant execute
on function public.clear_wine_maturity_override(uuid)
to authenticated;

create or replace function private.validate_maturity_projection_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_first integer;
    v_best_start integer;
    v_best_end integer;
    v_drink_by integer;
begin
    if new.projection_type = 'maturity' then
        if new.recommendation ->> 'schema_version' <> '1'
           or new.recommendation ->> 'state' not in (
               'hold',
               'assess',
               'ready',
               'priority',
               'assess-now'
           )
           or new.recommendation ->> 'urgency' not in (
               'later',
               'watch',
               'ready',
               'priority',
               'overdue'
           )
           or jsonb_typeof(new.recommendation -> 'warnings') <> 'array'
           or jsonb_typeof(new.recommendation -> 'reasons') <> 'array'
        then
            raise exception using
                errcode = '23514',
                message = 'Invalid maturity recommendation payload';
        end if;

        begin
            v_first := (new.recommendation ->> 'first_trial_year')::integer;
            v_best_start := (new.recommendation ->> 'best_start_year')::integer;
            v_best_end := (new.recommendation ->> 'best_end_year')::integer;
            v_drink_by := (new.recommendation ->> 'drink_by_year')::integer;
        exception
            when others then
                raise exception using
                    errcode = '23514',
                    message = 'Maturity recommendation years must be integers';
        end;

        if v_first not between 1800 and 2300
           or v_first > v_best_start
           or v_best_start > v_best_end
           or v_best_end > v_drink_by
           or v_drink_by > 2300
        then
            raise exception using
                errcode = '23514',
                message = 'Maturity recommendation years must be monotonic';
        end if;
    elsif new.projection_type = 'storage' then
        if new.recommendation ->> 'schema_version' <> '1'
           or new.recommendation ->> 'purpose' not in (
               'aging',
               'service',
               'split-service-and-aging',
               'service-priority'
           )
           or jsonb_typeof(new.recommendation -> 'move') <> 'object'
        then
            raise exception using
                errcode = '23514',
                message = 'Invalid storage recommendation payload';
        end if;
    end if;

    return new;
end;
$$;

revoke execute
on function private.validate_maturity_projection_payload()
from public, anon, authenticated;

create trigger wine_enrichment_projections_validate_maturity
before insert or update on public.wine_enrichment_projections
for each row
when (new.projection_type in ('maturity', 'storage'))
execute function private.validate_maturity_projection_payload();


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
    v_wine public.wines%rowtype;
    v_place record;
    v_vintage record;
    v_producer record;
    v_cuvee record;
    v_product_id uuid;
    v_producer_id uuid;
    v_color text;
    v_place_match text := 'appellation';
    v_color_conflict boolean := false;
    v_first_age integer;
    v_best_start_age integer;
    v_best_end_age integer;
    v_outer_age integer;
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
    v_warnings jsonb := '[]'::jsonb;
    v_reasons jsonb := '[]'::jsonb;
    v_profile_ids uuid[] := array[]::uuid[];
    v_maturity_projection_id uuid;
    v_storage_projection_id uuid;
    v_total_bottles integer;
    v_aging_bottles integer;
    v_service_bottles integer;
    v_storage_purpose text;
    v_move_needed boolean := false;
    v_move_possible boolean := false;
    v_move_quantity integer := 0;
    v_move_to_purpose text;
    v_storage_message text;
    v_has_target_location boolean;
    v_valid_until timestamptz;
begin
    select job.*
    into v_job
    from public.enrichment_jobs job
    where job.id = p_job_id
      and job.capability = 'maturity'
      and job.job_status = 'leased'
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'A leased maturity job is required';
    end if;

    select wine.*
    into v_wine
    from public.wines wine
    where wine.id = v_job.wine_id
      and wine.household_id = v_job.household_id;

    if not found then
        return jsonb_build_object(
            'status', 'not-found',
            'reason', 'wine-not-found'
        );
    end if;

    if v_wine.vintage is null then
        return jsonb_build_object(
            'status', 'needs-review',
            'reason', 'missing-vintage'
        );
    end if;

    v_color := private.canonical_enrichment_wine_color(v_wine.color);

    select exists (
        select 1
        from public.enrichment_place_aliases alias
        join public.enrichment_place_profiles typed
          on typed.place_id = alias.place_id
         and typed.knowledge_version_id = v_job.knowledge_version_id
        where alias.normalized_value =
            private.normalize_wine_reference_text(v_wine.appellation)
          and typed.wine_color <> v_color
    )
    into v_color_conflict;

    select
        typed.*,
        profile.confidence as profile_confidence,
        profile.rationale as profile_rationale,
        place.canonical_name as place_name,
        place.place_type
    into v_place
    from public.enrichment_place_aliases alias
    join public.enrichment_places place
      on place.id = alias.place_id
    join public.enrichment_place_profiles typed
      on typed.place_id = place.id
     and typed.knowledge_version_id = v_job.knowledge_version_id
     and typed.wine_color = v_color
    join public.enrichment_profiles profile
      on profile.id = typed.profile_id
    where alias.normalized_value =
        private.normalize_wine_reference_text(v_wine.appellation)
    order by
        case place.place_type
            when 'parcel' then 1
            when 'site' then 2
            when 'classification' then 3
            when 'appellation' then 4
            when 'subregion' then 5
            when 'region' then 6
            else 7
        end,
        typed.profile_id
    limit 1;

    if not found then
        v_place_match := 'area-fallback';

        select
            typed.*,
            profile.confidence as profile_confidence,
            profile.rationale as profile_rationale,
            place.canonical_name as place_name,
            place.place_type
        into v_place
        from public.enrichment_place_aliases alias
        join public.enrichment_places place
          on place.id = alias.place_id
        join public.enrichment_place_profiles typed
          on typed.place_id = place.id
         and typed.knowledge_version_id = v_job.knowledge_version_id
         and typed.wine_color = v_color
        join public.enrichment_profiles profile
          on profile.id = typed.profile_id
        where alias.normalized_value =
            private.normalize_wine_reference_text(v_wine.area)
          and place.place_type in ('region', 'subregion')
        order by
            case place.place_type when 'subregion' then 1 else 2 end,
            typed.profile_id
        limit 1;
    end if;

    if not found then
        return jsonb_build_object(
            'status', 'needs-review',
            'reason', case
                when v_color_conflict then 'appellation-color-conflict'
                else 'unsupported-place-profile'
            end
        );
    end if;

    if v_color_conflict then
        v_warnings := v_warnings || jsonb_build_array(
            'The stored appellation has no reviewed profile for this color; a broader compatible area profile was used.'
        );
    end if;

    if v_place_match = 'area-fallback' then
        v_warnings := v_warnings || jsonb_build_array(
            'No exact reviewed appellation profile was found; the area profile was used.'
        );
    end if;

    with recursive ancestors(place_id, depth) as (
        select v_place.place_id, 0

        union all

        select place.parent_id, ancestors.depth + 1
        from ancestors
        join public.enrichment_places place
          on place.id = ancestors.place_id
        where place.parent_id is not null
    )
    select
        typed.*,
        profile.confidence as profile_confidence,
        profile.rationale as profile_rationale
    into v_vintage
    from ancestors
    join public.enrichment_vintage_profiles typed
      on typed.place_id = ancestors.place_id
     and typed.knowledge_version_id = v_job.knowledge_version_id
     and typed.vintage_year = v_wine.vintage
     and typed.wine_color = v_color
    join public.enrichment_profiles profile
      on profile.id = typed.profile_id
    order by ancestors.depth, typed.profile_id
    limit 1;

    if not found then
        v_warnings := v_warnings || jsonb_build_array(
            'No reviewed local vintage profile was found; the place baseline was used.'
        );
    end if;

    select
        null::uuid as profile_id,
        null::integer as first_trial_age_adjustment,
        null::integer as best_start_age_adjustment,
        null::integer as best_end_age_adjustment,
        null::integer as outer_horizon_age_adjustment,
        null::numeric as profile_confidence,
        null::text as profile_rationale
    into v_producer;

    select
        null::uuid as profile_id,
        null::integer as first_trial_age_adjustment,
        null::integer as best_start_age_adjustment,
        null::integer as best_end_age_adjustment,
        null::integer as outer_horizon_age_adjustment,
        null::numeric as profile_confidence,
        null::text as profile_rationale
    into v_cuvee;

    if v_wine.wine_reference_type = 'product' then
        v_product_id := v_wine.wine_reference_id;
    elsif v_wine.wine_reference_type = 'release' then
        select release.product_id
        into v_product_id
        from public.wine_reference_releases release
        where release.id = v_wine.wine_reference_id;
    elsif v_wine.wine_reference_type = 'package' then
        select release.product_id
        into v_product_id
        from public.wine_reference_packages package
        join public.wine_reference_releases release
          on release.id = package.release_id
        where package.id = v_wine.wine_reference_id;
    end if;

    if v_product_id is not null then
        select product.producer_id
        into v_producer_id
        from public.wine_reference_products product
        where product.id = v_product_id;

        select
            typed.*,
            profile.confidence as profile_confidence,
            profile.rationale as profile_rationale
        into v_cuvee
        from public.enrichment_cuvee_profiles typed
        join public.enrichment_profiles profile
          on profile.id = typed.profile_id
        where typed.knowledge_version_id = v_job.knowledge_version_id
          and typed.product_id = v_product_id
          and typed.wine_color = v_color
        order by typed.profile_id
        limit 1;

        if v_producer_id is not null then
            select
                typed.*,
                profile.confidence as profile_confidence,
                profile.rationale as profile_rationale
            into v_producer
            from public.enrichment_producer_era_profiles typed
            join public.enrichment_profiles profile
              on profile.id = typed.profile_id
            where typed.knowledge_version_id = v_job.knowledge_version_id
              and typed.producer_id = v_producer_id
              and v_wine.vintage between
                    typed.first_vintage_year and typed.final_vintage_year
              and typed.wine_color = v_color
            order by
                typed.final_vintage_year - typed.first_vintage_year,
                typed.profile_id
            limit 1;
        end if;
    end if;

    if v_producer.profile_id is null then
        v_warnings := v_warnings || jsonb_build_array(
            'No reviewed producer-era profile was available.'
        );
    end if;

    if v_cuvee.profile_id is null then
        v_warnings := v_warnings || jsonb_build_array(
            'No reviewed cuvee profile was available.'
        );
    end if;

    v_first_age := greatest(
        0,
        v_place.first_trial_age
        + coalesce(v_vintage.first_trial_age_adjustment, 0)
        + coalesce(v_producer.first_trial_age_adjustment, 0)
        + coalesce(v_cuvee.first_trial_age_adjustment, 0)
    );
    v_best_start_age := greatest(
        v_first_age,
        v_place.best_start_age
        + coalesce(v_vintage.best_start_age_adjustment, 0)
        + coalesce(v_producer.best_start_age_adjustment, 0)
        + coalesce(v_cuvee.best_start_age_adjustment, 0)
    );
    v_best_end_age := greatest(
        v_best_start_age,
        v_place.best_end_age
        + coalesce(v_vintage.best_end_age_adjustment, 0)
        + coalesce(v_producer.best_end_age_adjustment, 0)
        + coalesce(v_cuvee.best_end_age_adjustment, 0)
    );
    v_outer_age := greatest(
        v_best_end_age,
        v_place.outer_horizon_age
        + coalesce(v_vintage.outer_horizon_age_adjustment, 0)
        + coalesce(v_producer.outer_horizon_age_adjustment, 0)
        + coalesce(v_cuvee.outer_horizon_age_adjustment, 0)
    );

    v_first_year := v_wine.vintage + v_first_age;
    v_best_start_year := v_wine.vintage + v_best_start_age;
    v_best_end_year := v_wine.vintage + v_best_end_age;
    v_drink_by_year := v_wine.vintage + v_outer_age;

    if v_as_of_year < v_first_year then
        v_state := 'hold';
        v_state_label := 'Hold';
        v_urgency := 'later';
        v_urgency_score := 10;
        v_headline := 'Keep aging';
        v_message := format(
            'Wait about %s years before the first assessment; the likely best period starts around %s.',
            v_first_year - v_as_of_year,
            v_best_start_year
        );
    elsif v_as_of_year < v_best_start_year then
        v_state := 'assess';
        v_state_label := 'Start assessing';
        v_urgency := 'watch';
        v_urgency_score := 35;
        v_headline := 'Start assessing';
        v_message := format(
            'A first bottle can be assessed now; the likely best period starts around %s.',
            v_best_start_year
        );
    elsif v_as_of_year <= v_best_end_year then
        v_state := 'ready';
        v_state_label := 'Likely ready';
        v_urgency := 'ready';
        v_urgency_score := 55;
        v_headline := 'Likely ready';
        v_message := format(
            'This wine is inside its likely best period; reassess before the suggested drink-by year of %s.',
            v_drink_by_year
        );
    elsif v_as_of_year <= v_drink_by_year then
        v_state := 'priority';
        v_state_label := 'Prioritize';
        v_urgency := 'priority';
        v_urgency_score := 85;
        v_headline := 'Drink sooner rather than later';
        v_message := format(
            'The central estimate has passed; prioritize an assessment and aim to drink by about %s.',
            v_drink_by_year
        );
    else
        v_state := 'assess-now';
        v_state_label := 'Assess now';
        v_urgency := 'overdue';
        v_urgency_score := 100;
        v_headline := 'Assess immediately';
        v_message := 'This wine is past the suggested drink-by year; assess a bottle now rather than assuming it is lost.';
    end if;

    v_confidence := round((
        v_place.profile_confidence * 0.45
        + coalesce(v_vintage.profile_confidence, 0.20) * 0.20
        + coalesce(v_producer.profile_confidence, 0.20) * 0.15
        + coalesce(v_cuvee.profile_confidence, 0.20) * 0.20
        - jsonb_array_length(v_warnings) * 0.06
    )::numeric, 3);
    v_confidence := greatest(0, least(1, v_confidence));
    v_confidence_label := case
        when v_confidence >= 0.80 then 'high'
        when v_confidence >= 0.60 then 'medium'
        else 'low'
    end;

    v_specificity := case
        when v_cuvee.profile_id is not null then 'exact-product'
        when v_producer.profile_id is not null then 'comparable-profile'
        when v_vintage.profile_id is not null then 'comparable-profile'
        else 'regional-style'
    end;

    v_profile_ids := array_append(v_profile_ids, v_place.profile_id);
    v_reasons := v_reasons || jsonb_build_array(v_place.profile_rationale);

    if v_vintage.profile_id is not null then
        v_profile_ids := array_append(v_profile_ids, v_vintage.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_vintage.profile_rationale);
    end if;

    if v_producer.profile_id is not null then
        v_profile_ids := array_append(v_profile_ids, v_producer.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_producer.profile_rationale);
    end if;

    if v_cuvee.profile_id is not null then
        v_profile_ids := array_append(v_profile_ids, v_cuvee.profile_id);
        v_reasons := v_reasons || jsonb_build_array(v_cuvee.profile_rationale);
    end if;

    select
        coalesce(sum(holding.quantity), 0)::integer,
        coalesce(sum(holding.quantity) filter (
            where location.storage_purpose = 'aging'
        ), 0)::integer,
        coalesce(sum(holding.quantity) filter (
            where location.storage_purpose = 'service'
        ), 0)::integer
    into
        v_total_bottles,
        v_aging_bottles,
        v_service_bottles
    from public.holdings holding
    join public.locations location
      on location.id = holding.location_id
    where holding.household_id = v_wine.household_id
      and holding.wine_id = v_wine.id
      and holding.quantity > 0;

    if v_state = 'hold' then
        v_storage_purpose := 'aging';
        v_move_quantity := greatest(0, v_total_bottles - v_aging_bottles);
        v_move_to_purpose := 'aging';
    elsif v_state in ('assess', 'ready') and v_total_bottles > 1 then
        v_storage_purpose := 'split-service-and-aging';
        if v_service_bottles = 0 then
            v_move_quantity := 1;
            v_move_to_purpose := 'service';
        elsif v_aging_bottles = 0 and v_service_bottles > 1 then
            v_move_quantity := v_service_bottles - 1;
            v_move_to_purpose := 'aging';
        end if;
    elsif v_state in ('assess', 'ready') then
        v_storage_purpose := 'service';
        v_move_quantity := greatest(0, v_total_bottles - v_service_bottles);
        v_move_to_purpose := 'service';
    else
        v_storage_purpose := 'service-priority';
        v_move_quantity := greatest(0, v_total_bottles - v_service_bottles);
        v_move_to_purpose := 'service';
    end if;

    v_move_needed := v_move_quantity > 0;

    if v_move_needed then
        select exists (
            select 1
            from public.locations location
            join public.cellars cellar
              on cellar.id = location.cellar_id
            where location.household_id = v_wine.household_id
              and location.is_active
              and cellar.is_active
              and location.storage_purpose = v_move_to_purpose
        )
        into v_has_target_location;

        v_move_possible := v_has_target_location;
        v_storage_message := case
            when not v_has_target_location then format(
                'Classify or create an active %s location before moving %s bottle%s.',
                v_move_to_purpose,
                v_move_quantity,
                case when v_move_quantity = 1 then '' else 's' end
            )
            when v_move_to_purpose = 'service' then format(
                'Move %s bottle%s to service storage.',
                v_move_quantity,
                case when v_move_quantity = 1 then '' else 's' end
            )
            else format(
                'Move %s bottle%s to aging storage.',
                v_move_quantity,
                case when v_move_quantity = 1 then '' else 's' end
            )
        end;
    elsif v_total_bottles = 0 then
        v_storage_message := 'No bottles are currently in stock.';
    elsif v_storage_purpose = 'aging' then
        v_storage_message := 'The current aging placement matches this estimate.';
    elsif v_storage_purpose = 'split-service-and-aging' then
        v_storage_message := 'Keep one assessment bottle in service and the remaining bottles in aging storage.';
    else
        v_storage_message := 'The current service placement matches this estimate.';
    end if;

    v_valid_until := pg_catalog.make_timestamptz(
        v_as_of_year + 1,
        1,
        1,
        0,
        0,
        0,
        'UTC'
    );

    update public.wine_enrichment_projections projection
    set status = 'superseded'
    where projection.household_id = v_wine.household_id
      and projection.wine_id = v_wine.id
      and projection.projection_type in ('maturity', 'storage')
      and projection.context_key = ''
      and projection.status = 'current';

    insert into public.wine_enrichment_projections (
        household_id,
        wine_id,
        reference_id,
        reference_type,
        knowledge_version_id,
        projection_type,
        method,
        specificity,
        confidence,
        input_fingerprint,
        recommendation,
        valid_until
    )
    values (
        v_wine.household_id,
        v_wine.id,
        v_wine.wine_reference_id,
        v_wine.wine_reference_type,
        v_job.knowledge_version_id,
        'maturity',
        'curated-inference',
        v_specificity,
        v_confidence,
        v_job.input_fingerprint,
        jsonb_build_object(
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
            'reasons', v_reasons
        ),
        v_valid_until
    )
    returning id into v_maturity_projection_id;

    insert into public.wine_enrichment_projections (
        household_id,
        wine_id,
        reference_id,
        reference_type,
        knowledge_version_id,
        projection_type,
        method,
        specificity,
        confidence,
        input_fingerprint,
        recommendation,
        valid_until
    )
    values (
        v_wine.household_id,
        v_wine.id,
        v_wine.wine_reference_id,
        v_wine.wine_reference_type,
        v_job.knowledge_version_id,
        'storage',
        'curated-inference',
        v_specificity,
        v_confidence,
        v_job.input_fingerprint,
        jsonb_build_object(
            'schema_version', 1,
            'purpose', v_storage_purpose,
            'message', v_storage_message,
            'current', jsonb_build_object(
                'total_bottles', v_total_bottles,
                'aging_bottles', v_aging_bottles,
                'service_bottles', v_service_bottles
            ),
            'move', jsonb_build_object(
                'needed', v_move_needed,
                'possible', v_move_possible,
                'quantity', v_move_quantity,
                'to_purpose', v_move_to_purpose,
                'message', v_storage_message
            )
        ),
        v_valid_until
    )
    returning id into v_storage_projection_id;

    insert into public.wine_enrichment_projection_profiles (
        projection_id,
        knowledge_version_id,
        profile_id,
        contribution_order
    )
    select
        projection.id,
        v_job.knowledge_version_id,
        profile.profile_id,
        profile.ordinality::integer
    from unnest(v_profile_ids) with ordinality profile(profile_id, ordinality)
    cross join (
        values (v_maturity_projection_id), (v_storage_projection_id)
    ) projection(id);

    insert into public.wine_enrichment_projection_evidence (
        projection_id,
        evidence_id
    )
    select distinct
        projection.id,
        link.evidence_id
    from unnest(v_profile_ids) profile(profile_id)
    join public.enrichment_profile_evidence link
      on link.profile_id = profile.profile_id
    cross join (
        values (v_maturity_projection_id), (v_storage_projection_id)
    ) projection(id);

    return jsonb_build_object(
        'status', 'complete',
        'maturity_projection_id', v_maturity_projection_id,
        'storage_projection_id', v_storage_projection_id,
        'state', v_state,
        'confidence', v_confidence
    );
end;
$$;

revoke execute
on function private.calculate_maturity_projection(uuid)
from public, anon, authenticated;

grant execute
on function private.calculate_maturity_projection(uuid)
to service_role;


create or replace function public.enqueue_maturity_enrichment_jobs(
    p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version_id uuid;
    v_wine record;
    v_enqueued integer;
begin
    if p_limit not between 1 and 500 then
        raise exception using
            errcode = '22023',
            message = 'Maturity enqueue limit must be between 1 and 500';
    end if;

    select version.id
    into v_version_id
    from public.enrichment_knowledge_versions version
    where version.status = 'active';

    if not found then
        return jsonb_build_object(
            'knowledge_version_id', null,
            'enqueued', 0,
            'reason', 'no-active-knowledge-version'
        );
    end if;

    -- This inexpensive refresh also rolls projections into a new calendar year
    -- even when no wine or holding row changed at midnight.
    for v_wine in
        select wine.household_id, wine.id
        from public.wines wine
        join public.enrichment_demands demand
          on demand.household_id = wine.household_id
         and demand.wine_id = wine.id
         and demand.capability = 'maturity'
    loop
        perform private.requeue_wine_maturity_demand(
            v_wine.household_id,
            v_wine.id
        );
    end loop;

    with candidates as (
        select demand.id
        from public.enrichment_demands demand
        where demand.capability = 'maturity'
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
    select count(*)::integer
    into v_enqueued
    from inserted;

    return jsonb_build_object(
        'knowledge_version_id', v_version_id,
        'enqueued', v_enqueued
    );
end;
$$;

revoke execute
on function public.enqueue_maturity_enrichment_jobs(integer)
from public, anon, authenticated;

grant execute
on function public.enqueue_maturity_enrichment_jobs(integer)
to service_role;


create or replace function public.claim_maturity_enrichment_jobs(
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
            message = 'Maturity worker ID is required';
    end if;

    if p_limit not between 1 and 100 then
        raise exception using
            errcode = '22023',
            message = 'Maturity claim limit must be between 1 and 100';
    end if;

    if p_lease_seconds not between 30 and 900 then
        raise exception using
            errcode = '22023',
            message = 'Maturity lease must be between 30 and 900 seconds';
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
        where job.capability = 'maturity'
          and job.job_status = 'leased'
          and job.lease_expires_at <= now()
        returning job.demand_id, job.job_status, job.next_attempt_at, job.attempt_count
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

    perform public.enqueue_maturity_enrichment_jobs(p_limit);

    return query
    with candidates as (
        select job.id
        from public.enrichment_jobs job
        where job.capability = 'maturity'
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

revoke execute
on function public.claim_maturity_enrichment_jobs(text, integer, integer)
from public, anon, authenticated;

grant execute
on function public.claim_maturity_enrichment_jobs(text, integer, integer)
to service_role;


create or replace function public.process_maturity_enrichment_jobs(
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
    v_processed integer := 0;
    v_completed integer := 0;
    v_needs_review integer := 0;
    v_not_found integer := 0;
    v_retried integer := 0;
begin
    if p_limit not between 1 and 100 then
        raise exception using
            errcode = '22023',
            message = 'Maturity processing limit must be between 1 and 100';
    end if;

    for v_claim in
        select *
        from public.claim_maturity_enrichment_jobs(
            p_worker_id,
            p_limit,
            300
        )
    loop
        v_processed := v_processed + 1;

        begin
            v_result := private.calculate_maturity_projection(v_claim.job_id);
            v_outcome := v_result ->> 'status';

            if v_outcome = 'complete' then
                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'complete'
                );
                v_completed := v_completed + 1;
            elsif v_outcome = 'not-found' then
                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'not-found'
                );
                v_not_found := v_not_found + 1;
            else
                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'needs-review'
                );
                v_needs_review := v_needs_review + 1;
            end if;
        exception
            when others then
                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'retry',
                    'maturity-calculation-error',
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

comment on function public.process_maturity_enrichment_jobs(text, integer) is
    'Claims and atomically publishes a bounded batch of maturity and storage projections.';

revoke execute
on function public.process_maturity_enrichment_jobs(text, integer)
from public, anon, authenticated;

grant execute
on function public.process_maturity_enrichment_jobs(text, integer)
to service_role;


do $$
declare
    v_existing_job_id bigint;
begin
    select job.jobid
    into v_existing_job_id
    from cron.job job
    where job.jobname = 'cellarmanager-maturity-enrichment';

    if found then
        perform cron.unschedule(v_existing_job_id);
    end if;

    perform cron.schedule(
        'cellarmanager-maturity-enrichment',
        '* * * * *',
        $cron$select public.process_maturity_enrichment_jobs('database-cron', 100);$cron$
    );
end
$$;


commit;
