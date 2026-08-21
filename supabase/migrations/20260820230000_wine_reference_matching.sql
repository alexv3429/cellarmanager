begin;

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;


create or replace function private.normalize_wine_reference_text(
    p_value text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
    select pg_catalog.btrim(
        pg_catalog.regexp_replace(
            pg_catalog.lower(
                extensions.unaccent(
                    'extensions.unaccent'::pg_catalog.regdictionary,
                    coalesce(p_value, '')
                )
            ),
            '[^[:alnum:]]+',
            ' ',
            'g'
        )
    );
$$;

revoke execute
on function private.normalize_wine_reference_text(text)
from public, anon, authenticated;

grant execute
on function private.normalize_wine_reference_text(text)
to service_role;


alter table public.wine_reference_lwin_entries
    add column producer_search text
        generated always as (
            private.normalize_wine_reference_text(producer_name)
        ) stored,
    add column product_search text
        generated always as (
            private.normalize_wine_reference_text(
                coalesce(wine_name, '') || ' '
                || coalesce(sub_region, '') || ' '
                || coalesce(site, '') || ' '
                || coalesce(parcel, '') || ' '
                || coalesce(designation, '') || ' '
                || coalesce(classification, '') || ' '
                || case
                    when wine_name is null
                      and sub_region is null
                      and site is null
                      and parcel is null
                    then coalesce(display_name, '')
                    else ''
                end
            )
        ) stored,
    add column geography_search text
        generated always as (
            private.normalize_wine_reference_text(
                coalesce(country, '') || ' '
                || coalesce(region, '') || ' '
                || coalesce(sub_region, '') || ' '
                || coalesce(site, '') || ' '
                || coalesce(designation, '') || ' '
                || coalesce(classification, '')
            )
        ) stored;

create index wine_reference_lwin_entries_producer_trgm_idx
    on public.wine_reference_lwin_entries
    using gin (producer_search extensions.gin_trgm_ops);

create index wine_reference_lwin_entries_product_trgm_idx
    on public.wine_reference_lwin_entries
    using gin (product_search extensions.gin_trgm_ops);


create table public.wine_reference_match_runs (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    source_fingerprint text not null,
    source_key text not null
        references public.wine_reference_sources(source_key),
    snapshot_id uuid not null
        references public.wine_reference_lwin_snapshots(id),
    candidate_count integer not null,
    generated_at timestamptz not null default now(),

    constraint wine_reference_match_runs_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,

    constraint wine_reference_match_runs_fingerprint_check
        check (source_fingerprint ~ '^[0-9a-f]{32}$'),

    constraint wine_reference_match_runs_count_check
        check (candidate_count between 0 and 5),

    constraint wine_reference_match_runs_unique
        unique (
            household_id,
            wine_id,
            source_fingerprint,
            source_key
        )
);

create index wine_reference_match_runs_wine_idx
    on public.wine_reference_match_runs(
        household_id,
        wine_id,
        source_fingerprint
    );

comment on table public.wine_reference_match_runs is
    'Versioned completion record for positive and zero-result candidate searches; prevents repeated scans until the source snapshot changes.';


create table public.wine_reference_match_candidates (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    source_fingerprint text not null,
    source_snapshot jsonb not null,
    source_key text not null
        references public.wine_reference_sources(source_key),
    identifier_scheme text not null default 'LWIN7',
    identifier_value text not null,
    candidate_rank integer not null,
    score numeric(6, 5) not null,
    match_strength text not null,
    evidence jsonb not null,
    blockers text[] not null default array[]::text[],
    candidate_snapshot jsonb not null,
    generated_at timestamptz not null default now(),

    constraint wine_reference_match_candidates_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,

    constraint wine_reference_match_candidates_fingerprint_check
        check (source_fingerprint ~ '^[0-9a-f]{32}$'),

    constraint wine_reference_match_candidates_identifier_check
        check (
            identifier_scheme = 'LWIN7'
            and identifier_value ~ '^[0-9]{7}$'
        ),

    constraint wine_reference_match_candidates_rank_check
        check (candidate_rank between 1 and 5),

    constraint wine_reference_match_candidates_score_check
        check (score between 0 and 1),

    constraint wine_reference_match_candidates_strength_check
        check (match_strength in ('strong', 'possible')),

    constraint wine_reference_match_candidates_unique
        unique (
            household_id,
            wine_id,
            source_fingerprint,
            source_key,
            identifier_scheme,
            identifier_value
        )
);

create index wine_reference_match_candidates_wine_idx
    on public.wine_reference_match_candidates(
        household_id,
        wine_id,
        source_fingerprint,
        candidate_rank
    );

comment on table public.wine_reference_match_candidates is
    'Review-only household candidates with preserved scoring evidence; no candidate links a wine automatically.';


create table public.wine_reference_match_decisions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    source_fingerprint text not null,
    source_snapshot jsonb not null,
    source_key text not null
        references public.wine_reference_sources(source_key),
    identifier_scheme text not null default 'LWIN7',
    identifier_value text not null,
    decision text not null,
    reference_id uuid,
    reference_type text,
    candidate_snapshot jsonb not null,
    remember_producer boolean not null default false,
    decided_by uuid not null
        references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint wine_reference_match_decisions_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,

    constraint wine_reference_match_decisions_reference_fk
        foreign key (reference_id, reference_type)
        references public.wine_reference_entities(id, entity_type),

    constraint wine_reference_match_decisions_fingerprint_check
        check (source_fingerprint ~ '^[0-9a-f]{32}$'),

    constraint wine_reference_match_decisions_identifier_check
        check (
            identifier_scheme = 'LWIN7'
            and identifier_value ~ '^[0-9]{7}$'
        ),

    constraint wine_reference_match_decisions_decision_check
        check (decision in ('confirmed', 'rejected')),

    constraint wine_reference_match_decisions_reference_check
        check (
            (
                decision = 'confirmed'
                and reference_id is not null
                and reference_type in ('product', 'release', 'package')
            )
            or (
                decision = 'rejected'
                and reference_id is null
                and reference_type is null
                and not remember_producer
            )
        ),

    constraint wine_reference_match_decisions_unique
        unique (
            household_id,
            wine_id,
            source_fingerprint,
            source_key,
            identifier_scheme,
            identifier_value
        )
);

create unique index wine_reference_match_decisions_one_confirmation_idx
    on public.wine_reference_match_decisions(
        household_id,
        wine_id,
        source_fingerprint
    )
    where decision = 'confirmed';

create index wine_reference_match_decisions_rejections_idx
    on public.wine_reference_match_decisions(
        household_id,
        wine_id,
        source_fingerprint,
        identifier_value
    )
    where decision = 'rejected';

comment on table public.wine_reference_match_decisions is
    'Current household confirmation or rejection evidence for one source fingerprint and candidate.';


create table public.wine_reference_household_producer_preferences (
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    source_producer_normalized text not null,
    source_producer_text text not null,
    producer_id uuid not null
        references public.wine_reference_producers(id),
    decided_by uuid not null
        references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (household_id, source_producer_normalized),

    constraint wine_reference_household_producer_preferences_source_check
        check (
            length(source_producer_normalized) > 0
            and source_producer_normalized =
                private.normalize_wine_reference_text(source_producer_text)
        )
);

create index wine_reference_household_producer_preferences_producer_idx
    on public.wine_reference_household_producer_preferences(producer_id);

comment on table public.wine_reference_household_producer_preferences is
    'Explicit household-only producer shorthand decisions; never promoted into global aliases automatically.';


create or replace function private.wine_reference_source_snapshot(
    p_wine public.wines
)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select pg_catalog.jsonb_build_object(
        'producer', p_wine.producer,
        'cuvee', p_wine.cuvee,
        'vintage', p_wine.vintage,
        'color', p_wine.color,
        'appellation', p_wine.appellation,
        'area', p_wine.area,
        'format_ml', p_wine.format_ml
    );
$$;

revoke execute
on function private.wine_reference_source_snapshot(public.wines)
from public, anon, authenticated;


create or replace function private.wine_reference_source_fingerprint(
    p_wine public.wines
)
returns text
language sql
stable
set search_path = ''
as $$
    select pg_catalog.md5(
        pg_catalog.jsonb_build_array(
            private.normalize_wine_reference_text(p_wine.producer),
            private.normalize_wine_reference_text(p_wine.cuvee),
            p_wine.vintage,
            private.normalize_wine_reference_text(p_wine.color),
            private.normalize_wine_reference_text(p_wine.appellation),
            private.normalize_wine_reference_text(p_wine.area),
            p_wine.format_ml
        )::text
    );
$$;

revoke execute
on function private.wine_reference_source_fingerprint(public.wines)
from public, anon, authenticated;


create or replace function private.refresh_wine_reference_candidates(
    p_wine public.wines
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fingerprint text :=
        private.wine_reference_source_fingerprint(p_wine);
    v_source_snapshot jsonb :=
        private.wine_reference_source_snapshot(p_wine);
    v_producer text :=
        private.normalize_wine_reference_text(p_wine.producer);
    v_cuvee text :=
        private.normalize_wine_reference_text(p_wine.cuvee);
    v_color text :=
        private.normalize_wine_reference_text(p_wine.color);
    v_appellation text :=
        private.normalize_wine_reference_text(p_wine.appellation);
    v_area text :=
        private.normalize_wine_reference_text(p_wine.area);
    v_preferred_producer text;
    v_count integer;
    v_snapshot_id uuid;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'wine-reference-candidates|' || p_wine.id::text,
            0
        )
    );

    select private.normalize_wine_reference_text(producer.canonical_name)
    into v_preferred_producer
    from public.wine_reference_household_producer_preferences preference
    join public.wine_reference_producers producer
      on producer.id = preference.producer_id
    where preference.household_id = p_wine.household_id
      and preference.source_producer_normalized = v_producer;

    delete from public.wine_reference_match_candidates candidate
    where candidate.household_id = p_wine.household_id
      and candidate.wine_id = p_wine.id
      and candidate.source_fingerprint = v_fingerprint;

    select snapshot.id
    into v_snapshot_id
    from public.wine_reference_lwin_snapshots snapshot
    where snapshot.source_key = 'liv-ex-lwin'
      and snapshot.import_status = 'active';

    if v_snapshot_id is null then
        return 0;
    end if;

    with pool as (
        select
            entry.*,
            greatest(
                extensions.similarity(v_producer, entry.producer_search),
                extensions.word_similarity(v_producer, entry.producer_search),
                extensions.word_similarity(entry.producer_search, v_producer)
            ) as producer_score,
            greatest(
                extensions.similarity(v_cuvee, entry.product_search),
                extensions.word_similarity(v_cuvee, entry.product_search),
                extensions.word_similarity(entry.product_search, v_cuvee)
            ) as product_score,
            case
                when v_appellation = '' then 0::real
                else greatest(
                    extensions.similarity(
                        v_appellation,
                        entry.product_search
                    ),
                    extensions.word_similarity(
                        v_appellation,
                        entry.product_search
                    ),
                    extensions.word_similarity(
                        v_appellation,
                        entry.geography_search
                    )
                )
            end as appellation_score,
            case
                when v_area = '' then 0::real
                else greatest(
                    extensions.similarity(v_area, entry.geography_search),
                    extensions.word_similarity(v_area, entry.geography_search)
                )
            end as area_score,
            case
                when v_color = ''
                  or entry.colour is null then null
                when v_color = private.normalize_wine_reference_text(
                    entry.colour
                ) then true
                when v_color = 'sparkling'
                  and private.normalize_wine_reference_text(
                      coalesce(entry.product_type, '') || ' '
                      || coalesce(entry.product_sub_type, '')
                  ) like '%sparkling%'
                then true
                else false
            end as color_compatible,
            case
                when p_wine.vintage is null then null
                when entry.first_vintage = 1000
                  and entry.final_vintage = 1000 then false
                when entry.first_vintage is null
                  and entry.final_vintage is null then null
                else
                    p_wine.vintage >= coalesce(
                        nullif(entry.first_vintage, 1000),
                        p_wine.vintage
                    )
                    and p_wine.vintage <= coalesce(
                        nullif(entry.final_vintage, 1000),
                        p_wine.vintage
                    )
            end as vintage_compatible,
            (
                v_preferred_producer is not null
                and entry.producer_search = v_preferred_producer
            ) as producer_preferred,
            (
                v_preferred_producer is not null
                and entry.producer_search <> v_preferred_producer
            ) as producer_preference_conflict
        from public.wine_reference_lwin_entries entry
        join public.wine_reference_lwin_snapshots snapshot
          on snapshot.id = entry.snapshot_id
        where snapshot.source_key = 'liv-ex-lwin'
          and snapshot.import_status = 'active'
          and entry.source_status = 'live'
          and (
              entry.producer_search OPERATOR(extensions.%) v_producer
              or entry.product_search OPERATOR(extensions.%) v_cuvee
              or entry.producer_search like '%' || v_producer || '%'
              or v_producer like '%' || entry.producer_search || '%'
              or entry.product_search like '%' || v_cuvee || '%'
          )
    ),
    scored as (
        select
            pool.*,
            least(
                1::real,
                (
                    case
                        when producer_preferred then 0.45
                        else 0.45 * producer_score
                    end
                    + 0.40 * product_score
                    + 0.06 * appellation_score
                    + 0.04 * area_score
                    + case
                        when color_compatible then 0.05
                        else 0
                    end
                )::real
            ) as total_score,
            pg_catalog.array_remove(
                array[
                    case
                        when color_compatible = false
                        then 'color_conflict'
                    end,
                    case
                        when vintage_compatible = false
                        then 'vintage_outside_known_range'
                    end,
                    case
                        when v_appellation <> ''
                          and appellation_score < 0.20
                        then 'appellation_conflict'
                    end,
                    case
                        when producer_preference_conflict
                        then 'producer_preference_conflict'
                    end
                ],
                null
            ) as hard_blockers
        from pool
        where producer_score >= 0.18
          and product_score >= 0.16
          and not (
              v_appellation <> ''
              and appellation_score < 0.20
              and product_score < 0.70
          )
    ),
    shortlisted as (
        select
            scored.*,
            pg_catalog.row_number() over (
                order by
                    total_score desc,
                    cardinality(hard_blockers),
                    lwin7
            )::integer as candidate_rank,
            pg_catalog.lead(total_score) over (
                order by
                    total_score desc,
                    cardinality(hard_blockers),
                    lwin7
            ) as next_score
        from scored
        where total_score >= 0.42
        order by
            total_score desc,
            cardinality(hard_blockers),
            lwin7
        limit 5
    )
    insert into public.wine_reference_match_candidates (
        household_id,
        wine_id,
        source_fingerprint,
        source_snapshot,
        source_key,
        identifier_scheme,
        identifier_value,
        candidate_rank,
        score,
        match_strength,
        evidence,
        blockers,
        candidate_snapshot
    )
    select
        p_wine.household_id,
        p_wine.id,
        v_fingerprint,
        v_source_snapshot,
        'liv-ex-lwin',
        'LWIN7',
        shortlisted.lwin7,
        shortlisted.candidate_rank,
        pg_catalog.round(shortlisted.total_score::numeric, 5),
        case
            when shortlisted.total_score >= 0.72
              and cardinality(shortlisted.hard_blockers) = 0
              and shortlisted.producer_score >= 0.40
              and shortlisted.product_score >= 0.40
            then 'strong'
            else 'possible'
        end,
        pg_catalog.jsonb_build_object(
            'producer_score',
                pg_catalog.round(shortlisted.producer_score::numeric, 3),
            'product_score',
                pg_catalog.round(shortlisted.product_score::numeric, 3),
            'appellation_score',
                pg_catalog.round(shortlisted.appellation_score::numeric, 3),
            'area_score',
                pg_catalog.round(shortlisted.area_score::numeric, 3),
            'color_compatible', shortlisted.color_compatible,
            'vintage_compatible', shortlisted.vintage_compatible,
            'producer_preferred', shortlisted.producer_preferred,
            'review_required', true
        ),
        shortlisted.hard_blockers
            || case
                when shortlisted.candidate_rank = 1
                  and shortlisted.next_score is not null
                  and shortlisted.total_score - shortlisted.next_score < 0.05
                then array['close_runner_up']::text[]
                else array[]::text[]
            end,
        pg_catalog.jsonb_build_object(
            'lwin7', shortlisted.lwin7,
            'display_name', shortlisted.display_name,
            'producer_name', shortlisted.producer_name,
            'wine_name', shortlisted.wine_name,
            'country', shortlisted.country,
            'region', shortlisted.region,
            'sub_region', shortlisted.sub_region,
            'site', shortlisted.site,
            'parcel', shortlisted.parcel,
            'colour', shortlisted.colour,
            'designation', shortlisted.designation,
            'classification', shortlisted.classification,
            'first_vintage', shortlisted.first_vintage,
            'final_vintage', shortlisted.final_vintage
        )
    from shortlisted;

    get diagnostics v_count = row_count;

    insert into public.wine_reference_match_runs (
        household_id,
        wine_id,
        source_fingerprint,
        source_key,
        snapshot_id,
        candidate_count
    )
    values (
        p_wine.household_id,
        p_wine.id,
        v_fingerprint,
        'liv-ex-lwin',
        v_snapshot_id,
        v_count
    )
    on conflict (
        household_id,
        wine_id,
        source_fingerprint,
        source_key
    )
    do update set
        snapshot_id = excluded.snapshot_id,
        candidate_count = excluded.candidate_count,
        generated_at = now();

    return v_count;
end;
$$;

revoke execute
on function private.refresh_wine_reference_candidates(public.wines)
from public, anon, authenticated;


create or replace function private.describe_wine_reference(
    p_reference_id uuid,
    p_reference_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_product_id uuid;
    v_producer_name text;
    v_product_name text;
    v_lwin7 text;
begin
    if p_reference_type = 'product' then
        v_product_id := p_reference_id;
    elsif p_reference_type = 'release' then
        select release.product_id
        into v_product_id
        from public.wine_reference_releases release
        where release.id = p_reference_id;
    elsif p_reference_type = 'package' then
        select release.product_id
        into v_product_id
        from public.wine_reference_packages package
        join public.wine_reference_releases release
          on release.id = package.release_id
        where package.id = p_reference_id;
    end if;

    select
        producer.canonical_name,
        product.canonical_name
    into
        v_producer_name,
        v_product_name
    from public.wine_reference_products product
    join public.wine_reference_producers producer
      on producer.id = product.producer_id
    where product.id = v_product_id;

    select identifier.identifier_value
    into v_lwin7
    from public.wine_reference_external_identifiers identifier
    where identifier.entity_id = v_product_id
      and identifier.entity_type = 'product'
      and identifier.authority = 'liv-ex'
      and identifier.identifier_scheme = 'LWIN7';

    return pg_catalog.jsonb_build_object(
        'reference_id', p_reference_id,
        'reference_type', p_reference_type,
        'producer_name', v_producer_name,
        'product_name', v_product_name,
        'lwin7', v_lwin7
    );
end;
$$;

revoke execute
on function private.describe_wine_reference(uuid, text)
from public, anon, authenticated;


create or replace function public.get_wine_reference_review(
    p_wine_id uuid,
    p_refresh boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_fingerprint text;
    v_candidates jsonb;
    v_rejected_candidates jsonb;
    v_matched_reference jsonb;
    v_active_snapshot_id uuid;
    v_source_updated_through timestamp;
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

    v_fingerprint :=
        private.wine_reference_source_fingerprint(v_wine);

    if v_wine.wine_reference_id is not null then
        v_matched_reference := private.describe_wine_reference(
            v_wine.wine_reference_id,
            v_wine.wine_reference_type
        );
    elsif p_refresh or not exists (
        select 1
        from public.wine_reference_match_runs match_run
        join public.wine_reference_lwin_snapshots snapshot
          on snapshot.id = match_run.snapshot_id
         and snapshot.source_key = match_run.source_key
         and snapshot.import_status = 'active'
        where match_run.household_id = v_wine.household_id
          and match_run.wine_id = v_wine.id
          and match_run.source_fingerprint = v_fingerprint
          and match_run.source_key = 'liv-ex-lwin'
    ) then
        perform private.refresh_wine_reference_candidates(v_wine);
    end if;

    select
        snapshot.id,
        snapshot.source_updated_through
    into
        v_active_snapshot_id,
        v_source_updated_through
    from public.wine_reference_lwin_snapshots snapshot
    where snapshot.source_key = 'liv-ex-lwin'
      and snapshot.import_status = 'active';

    select coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'lwin7', candidate.identifier_value,
                'rank', candidate.candidate_rank,
                'score', candidate.score,
                'match_strength', candidate.match_strength,
                'evidence', candidate.evidence,
                'blockers', candidate.blockers,
                'details', candidate.candidate_snapshot,
                'generated_at', candidate.generated_at
            )
            order by candidate.candidate_rank
        ),
        '[]'::jsonb
    )
    into v_candidates
    from public.wine_reference_match_candidates candidate
    left join public.wine_reference_match_decisions decision
      on decision.household_id = candidate.household_id
     and decision.wine_id = candidate.wine_id
     and decision.source_fingerprint = candidate.source_fingerprint
     and decision.source_key = candidate.source_key
     and decision.identifier_scheme = candidate.identifier_scheme
     and decision.identifier_value = candidate.identifier_value
    where candidate.household_id = v_wine.household_id
      and candidate.wine_id = v_wine.id
      and candidate.source_fingerprint = v_fingerprint
      and decision.decision is distinct from 'rejected';

    select coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'lwin7', candidate.identifier_value,
                'rank', candidate.candidate_rank,
                'score', candidate.score,
                'match_strength', candidate.match_strength,
                'evidence', candidate.evidence,
                'blockers', candidate.blockers,
                'details', candidate.candidate_snapshot,
                'generated_at', candidate.generated_at
            )
            order by candidate.candidate_rank
        ),
        '[]'::jsonb
    )
    into v_rejected_candidates
    from public.wine_reference_match_candidates candidate
    join public.wine_reference_match_decisions decision
      on decision.household_id = candidate.household_id
     and decision.wine_id = candidate.wine_id
     and decision.source_fingerprint = candidate.source_fingerprint
     and decision.source_key = candidate.source_key
     and decision.identifier_scheme = candidate.identifier_scheme
     and decision.identifier_value = candidate.identifier_value
     and decision.decision = 'rejected'
    where candidate.household_id = v_wine.household_id
      and candidate.wine_id = v_wine.id
      and candidate.source_fingerprint = v_fingerprint;

    return pg_catalog.jsonb_build_object(
        'status', case
            when v_matched_reference is not null then 'matched'
            when v_active_snapshot_id is null then 'unavailable'
            else 'unmatched'
        end,
        'source_fingerprint', v_fingerprint,
        'source_updated_through', v_source_updated_through,
        'matched_reference', v_matched_reference,
        'candidates', v_candidates,
        'rejected_candidates', v_rejected_candidates
    );
end;
$$;

revoke all
on function public.get_wine_reference_review(uuid, boolean)
from public, anon;

grant execute
on function public.get_wine_reference_review(uuid, boolean)
to authenticated;


create or replace function private.promote_lwin_reference(
    p_wine public.wines,
    p_lwin7 text,
    p_remember_producer boolean,
    p_user_id uuid
)
returns table (
    reference_id uuid,
    reference_type text,
    product_id uuid,
    producer_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_entry public.wine_reference_lwin_entries%rowtype;
    v_product_id uuid;
    v_producer_id uuid;
    v_release_id uuid;
    v_package_id uuid;
    v_candidate_producer text;
    v_source_producer text :=
        private.normalize_wine_reference_text(p_wine.producer);
    v_product_name text;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'promote-lwin|' || p_lwin7,
            0
        )
    );

    select entry.*
    into v_entry
    from public.wine_reference_lwin_entries entry
    join public.wine_reference_lwin_snapshots snapshot
      on snapshot.id = entry.snapshot_id
    where snapshot.source_key = 'liv-ex-lwin'
      and snapshot.import_status = 'active'
      and entry.source_status = 'live'
      and entry.lwin7 = p_lwin7;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'The selected LWIN is not in the active reference snapshot';
    end if;

    select identifier.entity_id
    into v_product_id
    from public.wine_reference_external_identifiers identifier
    where identifier.authority = 'liv-ex'
      and identifier.identifier_scheme = 'LWIN7'
      and identifier.identifier_value = p_lwin7;

    if found then
        select product.producer_id
        into v_producer_id
        from public.wine_reference_products product
        where product.id = v_product_id;
    else
        v_candidate_producer := coalesce(
            nullif(pg_catalog.btrim(v_entry.producer_name), ''),
            'Unknown producer'
        );

        select preference.producer_id
        into v_producer_id
        from public.wine_reference_household_producer_preferences preference
        join public.wine_reference_producers producer
          on producer.id = preference.producer_id
        where preference.household_id = p_wine.household_id
          and preference.source_producer_normalized = v_source_producer
          and private.normalize_wine_reference_text(
              producer.canonical_name
          ) = private.normalize_wine_reference_text(
              v_candidate_producer
          );

        if v_producer_id is null then
            v_producer_id := gen_random_uuid();

            insert into public.wine_reference_entities (id, entity_type)
            values (v_producer_id, 'producer');

            insert into public.wine_reference_producers (
                id,
                canonical_name
            )
            values (
                v_producer_id,
                v_candidate_producer
            );
        end if;

        v_product_id := gen_random_uuid();
        v_product_name := coalesce(
            nullif(pg_catalog.btrim(v_entry.display_name), ''),
            nullif(pg_catalog.btrim(v_entry.wine_name), ''),
            'LWIN ' || p_lwin7
        );

        insert into public.wine_reference_entities (id, entity_type)
        values (v_product_id, 'product');

        insert into public.wine_reference_products (
            id,
            producer_id,
            canonical_name
        )
        values (
            v_product_id,
            v_producer_id,
            v_product_name
        );

        insert into public.wine_reference_external_identifiers (
            entity_id,
            entity_type,
            authority,
            identifier_scheme,
            identifier_value
        )
        values (
            v_product_id,
            'product',
            'liv-ex',
            'LWIN7',
            p_lwin7
        );
    end if;

    if p_remember_producer then
        insert into public.wine_reference_household_producer_preferences (
            household_id,
            source_producer_normalized,
            source_producer_text,
            producer_id,
            decided_by
        )
        values (
            p_wine.household_id,
            v_source_producer,
            p_wine.producer,
            v_producer_id,
            p_user_id
        )
        on conflict (household_id, source_producer_normalized)
        do update set
            source_producer_text = excluded.source_producer_text,
            producer_id = excluded.producer_id,
            decided_by = excluded.decided_by,
            updated_at = now();
    end if;

    if p_wine.vintage is null then
        return query
        select
            v_product_id,
            'product'::text,
            v_product_id,
            v_producer_id;
        return;
    end if;

    select release.id
    into v_release_id
    from public.wine_reference_releases release
    where release.product_id = v_product_id
      and release.vintage_year = p_wine.vintage
    order by release.id
    limit 1;

    if v_release_id is null then
        v_release_id := gen_random_uuid();

        insert into public.wine_reference_entities (id, entity_type)
        values (v_release_id, 'release');

        insert into public.wine_reference_releases (
            id,
            product_id,
            vintage_year
        )
        values (
            v_release_id,
            v_product_id,
            p_wine.vintage
        );
    end if;

    insert into public.wine_reference_identifier_demands (
        entity_id,
        entity_type,
        authority,
        identifier_scheme
    )
    values (
        v_release_id,
        'release',
        'liv-ex',
        'LWIN11'
    )
    on conflict (entity_id, authority, identifier_scheme)
    do nothing;

    select package.id
    into v_package_id
    from public.wine_reference_packages package
    where package.release_id = v_release_id
      and package.container_type = 'bottle'
      and package.volume_ml = p_wine.format_ml
      and package.unit_count = 1
    order by package.id
    limit 1;

    if v_package_id is null then
        v_package_id := gen_random_uuid();

        insert into public.wine_reference_entities (id, entity_type)
        values (v_package_id, 'package');

        insert into public.wine_reference_packages (
            id,
            release_id,
            container_type,
            volume_ml,
            unit_count
        )
        values (
            v_package_id,
            v_release_id,
            'bottle',
            p_wine.format_ml,
            1
        );
    end if;

    insert into public.wine_reference_identifier_demands (
        entity_id,
        entity_type,
        authority,
        identifier_scheme
    )
    values (
        v_package_id,
        'package',
        'liv-ex',
        'LWIN16'
    )
    on conflict (entity_id, authority, identifier_scheme)
    do nothing;

    return query
    select
        v_package_id,
        'package'::text,
        v_product_id,
        v_producer_id;
end;
$$;

revoke execute
on function private.promote_lwin_reference(
    public.wines,
    text,
    boolean,
    uuid
)
from public, anon, authenticated;


create or replace function public.decide_wine_reference_match(
    p_wine_id uuid,
    p_lwin7 text,
    p_decision text,
    p_remember_producer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_candidate public.wine_reference_match_candidates%rowtype;
    v_fingerprint text;
    v_promoted record;
    v_current_lwin7 text;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_lwin7 is null or p_lwin7 !~ '^[0-9]{7}$' then
        raise exception using
            errcode = '22023',
            message = 'A valid LWIN7 is required';
    end if;

    if p_decision not in ('confirmed', 'rejected') then
        raise exception using
            errcode = '22023',
            message = 'Decision must be confirmed or rejected';
    end if;

    if p_decision = 'rejected' and p_remember_producer then
        raise exception using
            errcode = '22023',
            message = 'A rejected match cannot remember its producer';
    end if;

    select wine.*
    into v_wine
    from public.wines wine
    where wine.id = p_wine_id
    for update;

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
          and member.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can review wine matches';
    end if;

    v_fingerprint :=
        private.wine_reference_source_fingerprint(v_wine);

    select candidate.*
    into v_candidate
    from public.wine_reference_match_candidates candidate
    where candidate.household_id = v_wine.household_id
      and candidate.wine_id = v_wine.id
      and candidate.source_fingerprint = v_fingerprint
      and candidate.source_key = 'liv-ex-lwin'
      and candidate.identifier_scheme = 'LWIN7'
      and candidate.identifier_value = p_lwin7;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'The candidate is stale or was not generated for this wine';
    end if;

    if p_decision = 'confirmed' then
        select *
        into v_promoted
        from private.promote_lwin_reference(
            v_wine,
            p_lwin7,
            p_remember_producer,
            v_user_id
        );

        update public.wine_reference_match_decisions decision
        set
            decision = 'rejected',
            reference_id = null,
            reference_type = null,
            remember_producer = false,
            decided_by = v_user_id,
            updated_at = now()
        where decision.household_id = v_wine.household_id
          and decision.wine_id = v_wine.id
          and decision.source_fingerprint = v_fingerprint
          and decision.decision = 'confirmed'
          and decision.identifier_value <> p_lwin7;

        insert into public.wine_reference_match_decisions (
            household_id,
            wine_id,
            source_fingerprint,
            source_snapshot,
            source_key,
            identifier_scheme,
            identifier_value,
            decision,
            reference_id,
            reference_type,
            candidate_snapshot,
            remember_producer,
            decided_by
        )
        values (
            v_wine.household_id,
            v_wine.id,
            v_fingerprint,
            v_candidate.source_snapshot,
            v_candidate.source_key,
            v_candidate.identifier_scheme,
            v_candidate.identifier_value,
            'confirmed',
            v_promoted.reference_id,
            v_promoted.reference_type,
            v_candidate.candidate_snapshot,
            p_remember_producer,
            v_user_id
        )
        on conflict (
            household_id,
            wine_id,
            source_fingerprint,
            source_key,
            identifier_scheme,
            identifier_value
        )
        do update set
            decision = excluded.decision,
            reference_id = excluded.reference_id,
            reference_type = excluded.reference_type,
            candidate_snapshot = excluded.candidate_snapshot,
            remember_producer = excluded.remember_producer,
            decided_by = excluded.decided_by,
            updated_at = now();

        update public.wines
        set
            wine_reference_id = v_promoted.reference_id,
            wine_reference_type = v_promoted.reference_type
        where id = v_wine.id;
    else
        insert into public.wine_reference_match_decisions (
            household_id,
            wine_id,
            source_fingerprint,
            source_snapshot,
            source_key,
            identifier_scheme,
            identifier_value,
            decision,
            reference_id,
            reference_type,
            candidate_snapshot,
            remember_producer,
            decided_by
        )
        values (
            v_wine.household_id,
            v_wine.id,
            v_fingerprint,
            v_candidate.source_snapshot,
            v_candidate.source_key,
            v_candidate.identifier_scheme,
            v_candidate.identifier_value,
            'rejected',
            null,
            null,
            v_candidate.candidate_snapshot,
            false,
            v_user_id
        )
        on conflict (
            household_id,
            wine_id,
            source_fingerprint,
            source_key,
            identifier_scheme,
            identifier_value
        )
        do update set
            decision = excluded.decision,
            reference_id = null,
            reference_type = null,
            candidate_snapshot = excluded.candidate_snapshot,
            remember_producer = false,
            decided_by = excluded.decided_by,
            updated_at = now();

        if v_wine.wine_reference_id is not null then
            v_current_lwin7 := private.describe_wine_reference(
                v_wine.wine_reference_id,
                v_wine.wine_reference_type
            ) ->> 'lwin7';

            if v_current_lwin7 = p_lwin7 then
                update public.wines
                set
                    wine_reference_id = null,
                    wine_reference_type = null
                where id = v_wine.id;
            end if;
        end if;
    end if;

    return public.get_wine_reference_review(p_wine_id, false);
end;
$$;

revoke all
on function public.decide_wine_reference_match(
    uuid,
    text,
    text,
    boolean
)
from public, anon;

grant execute
on function public.decide_wine_reference_match(
    uuid,
    text,
    text,
    boolean
)
to authenticated;


create or replace function private.invalidate_changed_wine_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.wine_reference_id is not null
       and (
           private.normalize_wine_reference_text(new.producer)
               is distinct from
               private.normalize_wine_reference_text(old.producer)
           or private.normalize_wine_reference_text(new.cuvee)
               is distinct from
               private.normalize_wine_reference_text(old.cuvee)
           or new.vintage is distinct from old.vintage
           or private.normalize_wine_reference_text(new.color)
               is distinct from
               private.normalize_wine_reference_text(old.color)
           or private.normalize_wine_reference_text(new.appellation)
               is distinct from
               private.normalize_wine_reference_text(old.appellation)
           or private.normalize_wine_reference_text(new.area)
               is distinct from
               private.normalize_wine_reference_text(old.area)
           or new.format_ml is distinct from old.format_ml
       )
    then
        new.wine_reference_id := null;
        new.wine_reference_type := null;
    end if;

    return new;
end;
$$;

revoke execute
on function private.invalidate_changed_wine_reference()
from public, anon, authenticated;

create trigger wines_invalidate_changed_reference
before update of
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml
on public.wines
for each row
execute function private.invalidate_changed_wine_reference();


alter table public.wine_reference_match_candidates enable row level security;
alter table public.wine_reference_match_decisions enable row level security;
alter table public.wine_reference_household_producer_preferences enable row level security;
alter table public.wine_reference_match_runs enable row level security;

revoke all privileges on table
    public.wine_reference_match_runs,
    public.wine_reference_match_candidates,
    public.wine_reference_match_decisions,
    public.wine_reference_household_producer_preferences
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.wine_reference_match_runs,
    public.wine_reference_match_candidates,
    public.wine_reference_match_decisions,
    public.wine_reference_household_producer_preferences
to service_role;

commit;
