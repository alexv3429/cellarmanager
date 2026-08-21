begin;

create extension if not exists pgcrypto with schema extensions;

-- Reviewed evidence is historical input. Corrections create a new evidence
-- row and a new knowledge version instead of changing what an old projection
-- meant after the fact.
create or replace function private.protect_reviewed_enrichment_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.review_status <> 'pending' then
        raise exception using
            errcode = '23514',
            message = 'Reviewed enrichment evidence is immutable';
    end if;

    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute
on function private.protect_reviewed_enrichment_evidence()
from public, anon, authenticated;

create trigger enrichment_evidence_protect_reviewed
before update or delete on public.enrichment_evidence
for each row
when (old.review_status <> 'pending')
execute function private.protect_reviewed_enrichment_evidence();


-- A demand records desired household advice. It is created only after a wine
-- has reached PostgreSQL, so offline inventory writes never wait for it.
create table public.enrichment_demands (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    capability text not null,
    input_fingerprint text not null,
    demand_status text not null default 'queued',
    priority integer not null default 100,
    attempt_count integer not null default 0,
    next_attempt_at timestamptz,
    last_attempted_at timestamptz,
    last_completed_at timestamptz,
    last_error_code text,
    requested_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint enrichment_demands_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint enrichment_demands_identity_unique
        unique (household_id, wine_id, capability),
    constraint enrichment_demands_capability_check
        check (capability in ('maturity', 'pairing-profile')),
    constraint enrichment_demands_fingerprint_check
        check (input_fingerprint ~ '^[0-9a-f]{64}$'),
    constraint enrichment_demands_status_check
        check (
            demand_status in (
                'queued',
                'matching',
                'needs-review',
                'partial',
                'complete',
                'not-found',
                'retrying',
                'failed'
            )
        ),
    constraint enrichment_demands_priority_check
        check (priority between 0 and 1000),
    constraint enrichment_demands_attempts_check
        check (attempt_count >= 0),
    constraint enrichment_demands_next_attempt_check
        check (
            (demand_status = 'retrying' and next_attempt_at is not null)
            or (demand_status <> 'retrying' and next_attempt_at is null)
        ),
    constraint enrichment_demands_error_check
        check (last_error_code is null or length(trim(last_error_code)) > 0),
    constraint enrichment_demands_completion_check
        check (
            (demand_status in ('complete', 'partial', 'not-found') and last_completed_at is not null)
            or (demand_status not in ('complete', 'partial', 'not-found') and last_completed_at is null)
        )
);

create index enrichment_demands_queue_idx
    on public.enrichment_demands(
        demand_status,
        next_attempt_at,
        priority desc,
        requested_at
    )
    where demand_status in ('queued', 'retrying');

comment on table public.enrichment_demands is
    'Idempotent desired enrichment state created after a household wine synchronizes; the cellar remains usable while work is queued or retrying.';


create table public.enrichment_jobs (
    id uuid primary key default gen_random_uuid(),
    demand_id uuid not null
        references public.enrichment_demands(id)
        on delete cascade,
    household_id uuid not null,
    wine_id uuid not null,
    capability text not null,
    input_fingerprint text not null,
    knowledge_version_id uuid not null
        references public.enrichment_knowledge_versions(id),
    provider_source_id uuid,
    provider_policy_id uuid,
    job_status text not null default 'queued',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    next_attempt_at timestamptz,
    lease_token uuid,
    leased_by text,
    lease_expires_at timestamptz,
    last_error_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,

    constraint enrichment_jobs_provider_policy_fk
        foreign key (provider_policy_id, provider_source_id)
        references public.enrichment_source_policies(id, source_id),
    constraint enrichment_jobs_snapshot_check
        check (
            capability in ('maturity', 'pairing-profile')
            and input_fingerprint ~ '^[0-9a-f]{64}$'
        ),
    constraint enrichment_jobs_provider_check
        check (
            (provider_source_id is null and provider_policy_id is null)
            or (provider_source_id is not null and provider_policy_id is not null)
        ),
    constraint enrichment_jobs_status_check
        check (
            job_status in (
                'queued',
                'leased',
                'retrying',
                'succeeded',
                'not-found',
                'failed',
                'cancelled'
            )
        ),
    constraint enrichment_jobs_attempts_check
        check (
            attempt_count >= 0
            and max_attempts between 1 and 20
            and attempt_count <= max_attempts
        ),
    constraint enrichment_jobs_lease_check
        check (
            (
                job_status = 'leased'
                and lease_token is not null
                and leased_by is not null
                and length(trim(leased_by)) > 0
                and lease_expires_at is not null
            )
            or (
                job_status <> 'leased'
                and lease_token is null
                and leased_by is null
                and lease_expires_at is null
            )
        ),
    constraint enrichment_jobs_next_attempt_check
        check (
            (job_status = 'retrying' and next_attempt_at is not null)
            or (job_status <> 'retrying' and next_attempt_at is null)
        ),
    constraint enrichment_jobs_error_check
        check (last_error_code is null or length(trim(last_error_code)) > 0),
    constraint enrichment_jobs_completion_check
        check (
            (job_status in ('succeeded', 'not-found', 'failed', 'cancelled') and completed_at is not null)
            or (job_status not in ('succeeded', 'not-found', 'failed', 'cancelled') and completed_at is null)
        ),
    constraint enrichment_jobs_idempotency_unique
        unique (demand_id, knowledge_version_id, input_fingerprint)
);

create unique index enrichment_jobs_one_active_idx
    on public.enrichment_jobs(demand_id)
    where job_status in ('queued', 'leased', 'retrying');

create index enrichment_jobs_queue_idx
    on public.enrichment_jobs(job_status, next_attempt_at, created_at)
    where job_status in ('queued', 'retrying', 'leased');

comment on table public.enrichment_jobs is
    'Provider-neutral server jobs with bounded attempts, renewable ownership tokens, and stale-input snapshots.';


-- Cache entries contain only result metadata and an optional normalized
-- evidence link. Provider credentials and raw responses have no database
-- column and remain in the server secret store.
create table public.enrichment_provider_cache_entries (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null
        references public.enrichment_sources(id),
    source_policy_id uuid not null,
    cache_key_sha256 text not null,
    result_status text not null,
    evidence_id uuid references public.enrichment_evidence(id),
    request_count integer not null default 1,
    first_requested_at timestamptz not null default now(),
    last_requested_at timestamptz not null default now(),
    expires_at timestamptz not null,
    retry_after timestamptz,
    last_error_code text,

    constraint enrichment_provider_cache_policy_fk
        foreign key (source_policy_id, source_id)
        references public.enrichment_source_policies(id, source_id),
    constraint enrichment_provider_cache_unique
        unique (source_id, cache_key_sha256),
    constraint enrichment_provider_cache_key_check
        check (cache_key_sha256 ~ '^[0-9a-f]{64}$'),
    constraint enrichment_provider_cache_status_check
        check (result_status in ('found', 'not-found', 'pending', 'error')),
    constraint enrichment_provider_cache_result_check
        check (
            (result_status = 'found' and evidence_id is not null)
            or (result_status <> 'found' and evidence_id is null)
        ),
    constraint enrichment_provider_cache_request_count_check
        check (request_count > 0),
    constraint enrichment_provider_cache_dates_check
        check (
            last_requested_at >= first_requested_at
            and expires_at > last_requested_at
            and (retry_after is null or retry_after >= last_requested_at)
        ),
    constraint enrichment_provider_cache_error_check
        check (last_error_code is null or length(trim(last_error_code)) > 0)
);

create index enrichment_provider_cache_expiry_idx
    on public.enrichment_provider_cache_entries(expires_at);


create table public.enrichment_provider_rate_limits (
    source_id uuid not null
        references public.enrichment_sources(id)
        on delete cascade,
    bucket_key text not null,
    window_started_at timestamptz not null,
    window_ends_at timestamptz not null,
    request_count integer not null default 0,
    request_limit integer not null,
    updated_at timestamptz not null default now(),

    primary key (source_id, bucket_key, window_started_at),
    constraint enrichment_provider_rate_limits_bucket_check
        check (length(trim(bucket_key)) > 0),
    constraint enrichment_provider_rate_limits_window_check
        check (window_ends_at > window_started_at),
    constraint enrichment_provider_rate_limits_count_check
        check (
            request_count >= 0
            and request_limit > 0
            and request_count <= request_limit
        )
);


create or replace function private.enforce_enrichment_cache_rights()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_policy_status text;
    v_retention_right text;
begin
    select
        policy.status,
        policy.retention_right
    into
        v_policy_status,
        v_retention_right
    from public.enrichment_source_policies policy
    where policy.id = new.source_policy_id
      and policy.source_id = new.source_id;

    if not found
       or v_policy_status <> 'reviewed'
       or v_retention_right <> 'allowed' then
        raise exception using
            errcode = '23514',
            message = 'A reviewed source policy must permit cache retention';
    end if;

    return new;
end;
$$;

revoke execute
on function private.enforce_enrichment_cache_rights()
from public, anon, authenticated;

create trigger enrichment_provider_cache_enforce_rights
before insert or update on public.enrichment_provider_cache_entries
for each row
execute function private.enforce_enrichment_cache_rights();


create or replace function private.wine_enrichment_input_fingerprint(
    p_wine public.wines
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
    select pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(
                pg_catalog.concat_ws(
                    '|',
                    private.normalize_wine_reference_text(p_wine.producer),
                    private.normalize_wine_reference_text(p_wine.cuvee),
                    coalesce(p_wine.vintage::text, 'NV'),
                    private.normalize_wine_reference_text(p_wine.color),
                    private.normalize_wine_reference_text(p_wine.appellation),
                    private.normalize_wine_reference_text(p_wine.area),
                    p_wine.format_ml::text,
                    coalesce(p_wine.wine_reference_id::text, ''),
                    coalesce(p_wine.wine_reference_type, '')
                ),
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    );
$$;

revoke execute
on function private.wine_enrichment_input_fingerprint(public.wines)
from public, anon, authenticated;

grant execute
on function private.wine_enrichment_input_fingerprint(public.wines)
to service_role;


create or replace function private.queue_wine_enrichment_demands()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_capability text;
    v_demand_id uuid;
    v_fingerprint text := private.wine_enrichment_input_fingerprint(new);
begin
    foreach v_capability in array array['maturity', 'pairing-profile']::text[]
    loop
        v_demand_id := null;

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

revoke execute
on function private.queue_wine_enrichment_demands()
from public, anon, authenticated;

create trigger wines_queue_enrichment_demands
after insert or update of
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml,
    wine_reference_id,
    wine_reference_type
on public.wines
for each row
execute function private.queue_wine_enrichment_demands();

-- Existing cellar rows enter the same idempotent path as future synchronized
-- wines. No provider call or projection is made by this backfill.
insert into public.enrichment_demands (
    household_id,
    wine_id,
    capability,
    input_fingerprint
)
select
    wine.household_id,
    wine.id,
    capability.value,
    private.wine_enrichment_input_fingerprint(wine)
from public.wines wine
cross join unnest(array['maturity', 'pairing-profile']::text[]) capability(value)
on conflict (household_id, wine_id, capability) do nothing;


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
                select jsonb_agg(profile_payload.payload order by profile_payload.profile_type, profile_payload.profile_id)
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
                                    select to_jsonb(typed)
                                        - 'profile_id'
                                        - 'knowledge_version_id'
                                        - 'profile_type'
                                    from public.enrichment_place_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'vintage' then (
                                    select to_jsonb(typed)
                                        - 'profile_id'
                                        - 'knowledge_version_id'
                                        - 'profile_type'
                                    from public.enrichment_vintage_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'producer-era' then (
                                    select to_jsonb(typed)
                                        - 'profile_id'
                                        - 'knowledge_version_id'
                                        - 'profile_type'
                                    from public.enrichment_producer_era_profiles typed
                                    where typed.profile_id = profile.id
                                )
                                when 'cuvee' then (
                                    select to_jsonb(typed)
                                        - 'profile_id'
                                        - 'knowledge_version_id'
                                        - 'profile_type'
                                    from public.enrichment_cuvee_profiles typed
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


create or replace function public.publish_enrichment_knowledge_version(
    p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version public.enrichment_knowledge_versions%rowtype;
    v_profile_count integer;
    v_payload jsonb;
    v_content_sha256 text;
begin
    select version.*
    into v_version
    from public.enrichment_knowledge_versions version
    where version.id = p_version_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Enrichment knowledge version does not exist';
    end if;

    if v_version.status <> 'draft' then
        raise exception using
            errcode = '22023',
            message = 'Only a draft enrichment knowledge version can be published';
    end if;

    select count(*)::integer
    into v_profile_count
    from public.enrichment_profiles profile
    where profile.knowledge_version_id = p_version_id;

    if v_profile_count = 0 then
        raise exception using
            errcode = '23514',
            message = 'An enrichment knowledge version requires at least one profile';
    end if;

    if not exists (
        select 1
        from public.enrichment_place_profiles place_profile
        where place_profile.knowledge_version_id = p_version_id
    ) then
        raise exception using
            errcode = '23514',
            message = 'An enrichment knowledge version requires a place baseline';
    end if;

    if exists (
        select 1
        from public.enrichment_profiles profile
        where profile.knowledge_version_id = p_version_id
          and profile.review_status <> 'reviewed'
    ) then
        raise exception using
            errcode = '23514',
            message = 'Every enrichment profile must be reviewed before publication';
    end if;

    if exists (
        select 1
        from public.enrichment_profiles profile
        where profile.knowledge_version_id = p_version_id
          and not exists (
              select 1
              from public.enrichment_profile_evidence link
              join public.enrichment_evidence evidence
                on evidence.id = link.evidence_id
              where link.profile_id = profile.id
                and link.evidence_role = 'supports'
                and evidence.review_status = 'reviewed'
          )
    ) then
        raise exception using
            errcode = '23514',
            message = 'Every enrichment profile requires reviewed supporting evidence';
    end if;

    if exists (
        select 1
        from public.enrichment_profiles profile
        join public.enrichment_profile_evidence link
          on link.profile_id = profile.id
        join public.enrichment_evidence evidence
          on evidence.id = link.evidence_id
        where profile.knowledge_version_id = p_version_id
          and evidence.review_status <> 'reviewed'
    ) then
        raise exception using
            errcode = '23514',
            message = 'Published profiles cannot link pending or rejected evidence';
    end if;

    v_payload := private.enrichment_knowledge_version_payload(p_version_id);
    v_content_sha256 := pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(v_payload::text, 'UTF8'),
            'sha256'
        ),
        'hex'
    );

    update public.enrichment_knowledge_versions version
    set status = 'superseded'
    where version.status = 'active';

    update public.enrichment_knowledge_versions version
    set
        status = 'active',
        content_sha256 = v_content_sha256,
        published_at = now()
    where version.id = p_version_id;

    update public.enrichment_jobs job
    set
        job_status = 'cancelled',
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        next_attempt_at = null,
        completed_at = now(),
        updated_at = now(),
        last_error_code = 'superseded-knowledge-version'
    where job.job_status in ('queued', 'leased', 'retrying')
      and job.knowledge_version_id <> p_version_id;

    update public.enrichment_demands demand
    set
        demand_status = 'queued',
        attempt_count = 0,
        next_attempt_at = null,
        last_attempted_at = null,
        last_completed_at = null,
        last_error_code = null,
        requested_at = now(),
        updated_at = now();

    return jsonb_build_object(
        'knowledge_version_id', p_version_id,
        'profile_count', v_profile_count,
        'content_sha256', v_content_sha256,
        'status', 'active'
    );
end;
$$;

comment on function public.publish_enrichment_knowledge_version(uuid) is
    'Validates, hashes, and atomically activates one reviewed knowledge version, then requeues household demands.';

revoke execute
on function public.publish_enrichment_knowledge_version(uuid)
from public, anon, authenticated;

grant execute
on function public.publish_enrichment_knowledge_version(uuid)
to service_role;


create or replace function public.enqueue_enrichment_jobs(
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
            message = 'Enrichment enqueue limit must be between 1 and 500';
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

    with candidates as (
        select demand.id
        from public.enrichment_demands demand
        where demand.demand_status = 'queued'
           or (
               demand.demand_status = 'retrying'
               and demand.next_attempt_at <= now()
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
on function public.enqueue_enrichment_jobs(integer)
from public, anon, authenticated;

grant execute
on function public.enqueue_enrichment_jobs(integer)
to service_role;


create or replace function public.claim_enrichment_jobs(
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
    capability text,
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
            message = 'Enrichment worker ID is required';
    end if;

    if p_limit not between 1 and 100 then
        raise exception using
            errcode = '22023',
            message = 'Enrichment claim limit must be between 1 and 100';
    end if;

    if p_lease_seconds not between 30 and 900 then
        raise exception using
            errcode = '22023',
            message = 'Enrichment lease must be between 30 and 900 seconds';
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
        where job.job_status = 'leased'
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

    perform public.enqueue_enrichment_jobs(p_limit);

    return query
    with candidates as (
        select job.id
        from public.enrichment_jobs job
        where (
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
        claimed.capability,
        claimed.knowledge_version_id,
        claimed.input_fingerprint,
        claimed.attempt_count,
        claimed.lease_expires_at
    from claimed
    join updated_demands on updated_demands.id = claimed.demand_id;
end;
$$;

revoke execute
on function public.claim_enrichment_jobs(text, integer, integer)
from public, anon, authenticated;

grant execute
on function public.claim_enrichment_jobs(text, integer, integer)
to service_role;


create or replace function public.complete_enrichment_job(
    p_job_id uuid,
    p_lease_token uuid,
    p_outcome text,
    p_error_code text default null,
    p_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_job public.enrichment_jobs%rowtype;
    v_demand public.enrichment_demands%rowtype;
    v_active_version_id uuid;
    v_job_status text;
    v_demand_status text;
    v_next_attempt_at timestamptz;
begin
    if p_outcome not in ('complete', 'partial', 'needs-review', 'not-found', 'retry', 'failed') then
        raise exception using
            errcode = '22023',
            message = 'Unsupported enrichment job outcome';
    end if;

    select job.*
    into v_job
    from public.enrichment_jobs job
    where job.id = p_job_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Enrichment job does not exist';
    end if;

    if v_job.job_status <> 'leased'
       or v_job.lease_token is distinct from p_lease_token
       or v_job.lease_expires_at <= now() then
        raise exception using
            errcode = '40001',
            message = 'Enrichment job lease is missing, expired, or owned by another worker';
    end if;

    select demand.*
    into v_demand
    from public.enrichment_demands demand
    where demand.id = v_job.demand_id
    for update;

    select version.id
    into v_active_version_id
    from public.enrichment_knowledge_versions version
    where version.status = 'active';

    if v_demand.input_fingerprint <> v_job.input_fingerprint
       or v_active_version_id is distinct from v_job.knowledge_version_id then
        update public.enrichment_jobs job
        set
            job_status = 'cancelled',
            lease_token = null,
            leased_by = null,
            lease_expires_at = null,
            next_attempt_at = null,
            last_error_code = 'stale-job-input',
            completed_at = now(),
            updated_at = now()
        where job.id = p_job_id;

        return jsonb_build_object(
            'job_id', p_job_id,
            'status', 'cancelled',
            'reason', 'stale-job-input'
        );
    end if;

    if p_outcome in ('retry', 'failed')
       and (p_error_code is null or length(trim(p_error_code)) = 0) then
        raise exception using
            errcode = '22023',
            message = 'Retry and failed outcomes require an error code';
    end if;

    if p_outcome = 'retry' and v_job.attempt_count < v_job.max_attempts then
        if p_retry_at is null or p_retry_at <= now() then
            raise exception using
                errcode = '22023',
                message = 'Retry outcome requires a future retry time';
        end if;

        v_job_status := 'retrying';
        v_demand_status := 'retrying';
        v_next_attempt_at := p_retry_at;
    elsif p_outcome = 'retry' or p_outcome = 'failed' then
        v_job_status := 'failed';
        v_demand_status := 'failed';
        v_next_attempt_at := null;
    elsif p_outcome = 'not-found' then
        v_job_status := 'not-found';
        v_demand_status := 'not-found';
        v_next_attempt_at := null;
    else
        v_job_status := 'succeeded';
        v_demand_status := p_outcome;
        v_next_attempt_at := null;
    end if;

    update public.enrichment_jobs job
    set
        job_status = v_job_status,
        next_attempt_at = v_next_attempt_at,
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        last_error_code = case
            when v_job_status in ('retrying', 'failed') then trim(p_error_code)
            else null
        end,
        completed_at = case
            when v_job_status in ('succeeded', 'not-found', 'failed') then now()
            else null
        end,
        updated_at = now()
    where job.id = p_job_id;

    update public.enrichment_demands demand
    set
        demand_status = v_demand_status,
        attempt_count = v_job.attempt_count,
        next_attempt_at = v_next_attempt_at,
        last_attempted_at = now(),
        last_completed_at = case
            when v_demand_status in ('complete', 'partial', 'not-found') then now()
            else null
        end,
        last_error_code = case
            when v_demand_status in ('retrying', 'failed') then trim(p_error_code)
            else null
        end,
        updated_at = now()
    where demand.id = v_job.demand_id;

    return jsonb_build_object(
        'job_id', p_job_id,
        'job_status', v_job_status,
        'demand_status', v_demand_status,
        'next_attempt_at', v_next_attempt_at
    );
end;
$$;

revoke execute
on function public.complete_enrichment_job(uuid, uuid, text, text, timestamptz)
from public, anon, authenticated;

grant execute
on function public.complete_enrichment_job(uuid, uuid, text, text, timestamptz)
to service_role;


alter table public.enrichment_demands enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_provider_cache_entries enable row level security;
alter table public.enrichment_provider_rate_limits enable row level security;

revoke all privileges on table
    public.enrichment_demands,
    public.enrichment_jobs,
    public.enrichment_provider_cache_entries,
    public.enrichment_provider_rate_limits
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.enrichment_demands,
    public.enrichment_jobs,
    public.enrichment_provider_cache_entries,
    public.enrichment_provider_rate_limits
to service_role;

commit;
