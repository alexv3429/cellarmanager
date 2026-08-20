begin;

-- Liv-ex defines four complete LWIN forms. The identity migration already
-- accepted LWIN7, LWIN11, and LWIN16; add the pack-aware LWIN18 form at the
-- same package level before creating demands for missing identifiers.
alter table public.wine_reference_external_identifiers
    drop constraint wine_reference_external_identifiers_lwin_scope_check;

alter table public.wine_reference_external_identifiers
    add constraint wine_reference_external_identifiers_lwin_scope_check
        check (
            authority <> 'liv-ex'
            or identifier_scheme not in ('LWIN7', 'LWIN11', 'LWIN16', 'LWIN18')
            or (
                identifier_scheme = 'LWIN7'
                and entity_type = 'product'
                and identifier_value ~ '^[0-9]{7}$'
            )
            or (
                identifier_scheme = 'LWIN11'
                and entity_type = 'release'
                and identifier_value ~ '^[0-9]{11}$'
            )
            or (
                identifier_scheme = 'LWIN16'
                and entity_type = 'package'
                and identifier_value ~ '^[0-9]{16}$'
            )
            or (
                identifier_scheme = 'LWIN18'
                and entity_type = 'package'
                and identifier_value ~ '^[0-9]{18}$'
            )
        );

-- Identity-reference sources are distinct from later enrichment providers:
-- they describe how a shared identifier dictionary may be retrieved, retained,
-- and attributed without granting that provider ownership of CellarManager IDs.
create table public.wine_reference_sources (
    source_key text primary key,
    source_name text not null,
    authority text not null,
    homepage_url text not null,
    snapshot_url text not null,
    license_name text not null,
    license_url text not null,
    attribution_text text not null,
    created_at timestamptz not null default now(),

    constraint wine_reference_sources_key_check
        check (
            length(source_key) > 0
            and source_key = lower(trim(source_key))
        ),

    constraint wine_reference_sources_authority_check
        check (
            length(authority) > 0
            and authority = lower(trim(authority))
        ),

    constraint wine_reference_sources_name_check
        check (length(trim(source_name)) > 0),

    constraint wine_reference_sources_urls_check
        check (
            homepage_url like 'https://%'
            and snapshot_url like 'https://%'
            and license_url like 'https://%'
        ),

    constraint wine_reference_sources_license_check
        check (
            length(trim(license_name)) > 0
            and length(trim(attribution_text)) > 0
        )
);

insert into public.wine_reference_sources (
    source_key,
    source_name,
    authority,
    homepage_url,
    snapshot_url,
    license_name,
    license_url,
    attribution_text
)
values (
    'liv-ex-lwin',
    'Liv-ex LWIN Database',
    'liv-ex',
    'https://www.liv-ex.com/lwin/',
    'https://s3-eu-west-1.amazonaws.com/lwin-dictionary/latest/LWINdatabase.xlsx',
    'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    'https://creativecommons.org/licenses/by/4.0/',
    'Contains information from the Liv-ex LWIN Database, licensed under CC BY 4.0. CellarManager normalizes source values and does not imply Liv-ex endorsement.'
);

comment on table public.wine_reference_sources is
    'Retrieval and attribution policy for service-managed external identity dictionaries.';


-- A snapshot is visible to matching services only after every source row has
-- been uploaded and final validation atomically promotes it to active.
create table public.wine_reference_lwin_snapshots (
    id uuid primary key default gen_random_uuid(),
    source_key text not null
        references public.wine_reference_sources(source_key),
    content_sha256 text not null,
    source_file_name text not null,
    source_retrieved_at timestamptz not null,
    source_updated_through timestamp,
    expected_record_count integer not null,
    record_count integer,
    live_record_count integer,
    combined_record_count integer,
    deleted_record_count integer,
    import_status text not null default 'importing',
    rows_retained boolean not null default true,
    failure_reason text,
    started_at timestamptz not null default now(),
    completed_at timestamptz,

    constraint wine_reference_lwin_snapshots_hash_check
        check (content_sha256 ~ '^[0-9a-f]{64}$'),

    constraint wine_reference_lwin_snapshots_file_check
        check (length(trim(source_file_name)) > 0),

    constraint wine_reference_lwin_snapshots_expected_count_check
        check (expected_record_count > 0),

    constraint wine_reference_lwin_snapshots_counts_check
        check (
            (record_count is null or record_count >= 0)
            and (live_record_count is null or live_record_count >= 0)
            and (
                combined_record_count is null
                or combined_record_count >= 0
            )
            and (deleted_record_count is null or deleted_record_count >= 0)
        ),

    constraint wine_reference_lwin_snapshots_status_check
        check (
            import_status in (
                'importing',
                'active',
                'superseded',
                'failed'
            )
        ),

    constraint wine_reference_lwin_snapshots_completion_check
        check (
            (
                import_status in ('active', 'superseded')
                and completed_at is not null
                and record_count = expected_record_count
                and record_count =
                    live_record_count
                    + combined_record_count
                    + deleted_record_count
                and failure_reason is null
            )
            or (
                import_status = 'failed'
                and completed_at is not null
                and length(trim(failure_reason)) > 0
            )
            or (
                import_status = 'importing'
                and completed_at is null
                and source_updated_through is null
                and failure_reason is null
                and record_count is null
                and live_record_count is null
                and combined_record_count is null
                and deleted_record_count is null
            )
        ),

    constraint wine_reference_lwin_snapshots_active_rows_check
        check (import_status <> 'active' or rows_retained)
);

create unique index wine_reference_lwin_snapshots_one_active_idx
    on public.wine_reference_lwin_snapshots(source_key)
    where import_status = 'active';

create unique index wine_reference_lwin_snapshots_source_hash_idx
    on public.wine_reference_lwin_snapshots(source_key, content_sha256)
    where import_status <> 'failed';

create index wine_reference_lwin_snapshots_history_idx
    on public.wine_reference_lwin_snapshots(
        source_key,
        completed_at desc
    );

comment on table public.wine_reference_lwin_snapshots is
    'Auditable imports of the official LWIN7 workbook; only one fully validated snapshot is active per source.';


-- These rows are normalized source evidence, not CellarManager identities.
-- They are promoted into the UUID-backed identity library only after a later
-- matching workflow has enough evidence to do so.
create table public.wine_reference_lwin_entries (
    snapshot_id uuid not null
        references public.wine_reference_lwin_snapshots(id)
        on delete cascade,
    lwin7 text not null,
    source_row_number integer not null,
    source_status text not null,
    display_name text,
    producer_title text,
    producer_name text,
    wine_name text,
    country text,
    region text,
    sub_region text,
    site text,
    parcel text,
    colour text,
    product_type text,
    product_sub_type text,
    designation text,
    classification text,
    vintage_configuration text not null,
    first_vintage integer,
    final_vintage integer,
    source_added_at timestamp,
    source_updated_at timestamp,
    successor_lwin7 text,

    primary key (snapshot_id, lwin7),

    constraint wine_reference_lwin_entries_lwin_check
        check (lwin7 ~ '^[0-9]{7}$'),

    constraint wine_reference_lwin_entries_row_check
        check (source_row_number >= 2),

    constraint wine_reference_lwin_entries_status_check
        check (source_status in ('live', 'combined', 'deleted')),

    constraint wine_reference_lwin_entries_vintage_configuration_check
        check (
            vintage_configuration in (
                'sequential',
                'non_sequential',
                'single_vintage_only'
            )
        ),

    constraint wine_reference_lwin_entries_first_vintage_check
        check (
            first_vintage is null
            or first_vintage between 1000 and 9999
        ),

    constraint wine_reference_lwin_entries_final_vintage_check
        check (
            final_vintage is null
            or final_vintage between 1000 and 9999
        ),

    constraint wine_reference_lwin_entries_vintage_range_check
        check (
            first_vintage is null
            or final_vintage is null
            or first_vintage <= final_vintage
        ),

    constraint wine_reference_lwin_entries_successor_check
        check (
            successor_lwin7 is null
            or (
                successor_lwin7 ~ '^[0-9]{7}$'
                and successor_lwin7 <> lwin7
            )
        ),

    constraint wine_reference_lwin_entries_combined_check
        check (source_status <> 'combined' or successor_lwin7 is not null),

    constraint wine_reference_lwin_entries_live_check
        check (source_status <> 'live' or successor_lwin7 is null)
);

create index wine_reference_lwin_entries_status_idx
    on public.wine_reference_lwin_entries(snapshot_id, source_status);

create index wine_reference_lwin_entries_producer_idx
    on public.wine_reference_lwin_entries(
        snapshot_id,
        lower(producer_name)
    );

create index wine_reference_lwin_entries_display_idx
    on public.wine_reference_lwin_entries(
        snapshot_id,
        lower(display_name)
    );

create index wine_reference_lwin_entries_wine_idx
    on public.wine_reference_lwin_entries(
        snapshot_id,
        lower(wine_name)
    );

comment on table public.wine_reference_lwin_entries is
    'Normalized rows from an official LWIN7 snapshot. NA sentinels become null; source status and successor history are preserved.';


create or replace function public.finalize_wine_reference_lwin_snapshot(
    p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_snapshot public.wine_reference_lwin_snapshots%rowtype;
    v_record_count integer;
    v_live_count integer;
    v_combined_count integer;
    v_deleted_count integer;
    v_source_updated_through timestamp;
begin
    select snapshot.*
    into v_snapshot
    from public.wine_reference_lwin_snapshots snapshot
    where snapshot.id = p_snapshot_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'LWIN snapshot does not exist';
    end if;

    if v_snapshot.import_status <> 'importing' then
        raise exception using
            errcode = '22023',
            message = 'Only an importing LWIN snapshot can be finalized';
    end if;

    select
        count(*)::integer,
        count(*) filter (
            where entry.source_status = 'live'
        )::integer,
        count(*) filter (
            where entry.source_status = 'combined'
        )::integer,
        count(*) filter (
            where entry.source_status = 'deleted'
        )::integer,
        max(entry.source_updated_at)
    into
        v_record_count,
        v_live_count,
        v_combined_count,
        v_deleted_count,
        v_source_updated_through
    from public.wine_reference_lwin_entries entry
    where entry.snapshot_id = p_snapshot_id;

    if v_record_count <> v_snapshot.expected_record_count then
        raise exception using
            errcode = '23514',
            message = format(
                'LWIN snapshot expected %s rows but received %s',
                v_snapshot.expected_record_count,
                v_record_count
            );
    end if;

    if exists (
        select 1
        from public.wine_reference_lwin_entries entry
        left join public.wine_reference_lwin_entries successor
          on successor.snapshot_id = entry.snapshot_id
         and successor.lwin7 = entry.successor_lwin7
        where entry.snapshot_id = p_snapshot_id
          and entry.successor_lwin7 is not null
          and successor.lwin7 is null
    ) then
        raise exception using
            errcode = '23503',
            message = 'LWIN snapshot contains a missing successor reference';
    end if;

    if exists (
        with recursive paths(
            start_lwin7,
            current_lwin7,
            path,
            is_cycle
        ) as (
            select
                entry.lwin7,
                entry.successor_lwin7,
                array[entry.lwin7],
                false
            from public.wine_reference_lwin_entries entry
            where entry.snapshot_id = p_snapshot_id
              and entry.successor_lwin7 is not null

            union all

            select
                paths.start_lwin7,
                successor.successor_lwin7,
                paths.path || paths.current_lwin7,
                paths.current_lwin7 = any(paths.path)
            from paths
            join public.wine_reference_lwin_entries successor
              on successor.snapshot_id = p_snapshot_id
             and successor.lwin7 = paths.current_lwin7
            where paths.current_lwin7 is not null
              and not paths.is_cycle
        )
        select 1
        from paths
        where paths.is_cycle
    ) then
        raise exception using
            errcode = '23514',
            message = 'LWIN snapshot contains a successor cycle';
    end if;

    update public.wine_reference_lwin_snapshots snapshot
    set import_status = 'superseded'
    where snapshot.source_key = v_snapshot.source_key
      and snapshot.import_status = 'active';

    update public.wine_reference_lwin_snapshots snapshot
    set
        source_updated_through = v_source_updated_through,
        record_count = v_record_count,
        live_record_count = v_live_count,
        combined_record_count = v_combined_count,
        deleted_record_count = v_deleted_count,
        import_status = 'active',
        completed_at = now()
    where snapshot.id = p_snapshot_id;

    return jsonb_build_object(
        'snapshot_id', p_snapshot_id,
        'record_count', v_record_count,
        'live_record_count', v_live_count,
        'combined_record_count', v_combined_count,
        'deleted_record_count', v_deleted_count,
        'source_updated_through', v_source_updated_through
    );
end;
$$;

comment on function public.finalize_wine_reference_lwin_snapshot(uuid) is
    'Validates a complete staged LWIN snapshot and atomically replaces the active snapshot.';

revoke execute
    on function public.finalize_wine_reference_lwin_snapshot(uuid)
    from public, anon, authenticated;

grant execute
    on function public.finalize_wine_reference_lwin_snapshot(uuid)
    to service_role;


create or replace function public.fail_wine_reference_lwin_snapshot(
    p_snapshot_id uuid,
    p_failure_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted_row_count integer;
begin
    if p_failure_reason is null
       or length(trim(p_failure_reason)) = 0
    then
        raise exception using
            errcode = '22023',
            message = 'LWIN snapshot failure requires a reason';
    end if;

    perform 1
    from public.wine_reference_lwin_snapshots snapshot
    where snapshot.id = p_snapshot_id
      and snapshot.import_status = 'importing'
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Only an importing LWIN snapshot can be failed';
    end if;

    delete from public.wine_reference_lwin_entries entry
    where entry.snapshot_id = p_snapshot_id;

    get diagnostics v_deleted_row_count = row_count;

    update public.wine_reference_lwin_snapshots snapshot
    set
        import_status = 'failed',
        rows_retained = false,
        failure_reason = left(trim(p_failure_reason), 1000),
        completed_at = now()
    where snapshot.id = p_snapshot_id;

    return v_deleted_row_count;
end;
$$;

comment on function public.fail_wine_reference_lwin_snapshot(uuid, text) is
    'Marks an interrupted import failed and atomically removes its incomplete staged rows.';

revoke execute
    on function public.fail_wine_reference_lwin_snapshot(uuid, text)
    from public, anon, authenticated;

grant execute
    on function public.fail_wine_reference_lwin_snapshot(uuid, text)
    to service_role;


-- Full historical row copies are unnecessary once a replacement has proved
-- valid. Audit metadata and hashes remain, while callers may retain a bounded
-- number of superseded row sets for rollback diagnostics.
create or replace function public.prune_wine_reference_lwin_snapshot_rows(
    p_keep_superseded integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pruned_snapshot_count integer;
begin
    if p_keep_superseded < 0 then
        raise exception using
            errcode = '22023',
            message = 'Superseded snapshot retention cannot be negative';
    end if;

    with candidates as (
        select ranked.id
        from (
            select
                snapshot.id,
                row_number() over (
                    partition by snapshot.source_key
                    order by snapshot.completed_at desc, snapshot.id
                ) as retention_rank
            from public.wine_reference_lwin_snapshots snapshot
            where snapshot.import_status = 'superseded'
              and snapshot.rows_retained
        ) ranked
        where ranked.retention_rank > p_keep_superseded
    ),
    purged as (
        delete from public.wine_reference_lwin_entries entry
        using candidates
        where entry.snapshot_id = candidates.id
        returning entry.snapshot_id
    ),
    marked as (
        update public.wine_reference_lwin_snapshots snapshot
        set rows_retained = false
        where snapshot.id in (
            select distinct purged.snapshot_id
            from purged
        )
        returning snapshot.id
    )
    select count(*)::integer
    into v_pruned_snapshot_count
    from marked;

    return v_pruned_snapshot_count;
end;
$$;

revoke execute
    on function public.prune_wine_reference_lwin_snapshot_rows(integer)
    from public, anon, authenticated;

grant execute
    on function public.prune_wine_reference_lwin_snapshot_rows(integer)
    to service_role;


create view public.wine_reference_active_lwin_entries
with (security_invoker = true)
as
select
    entry.*
from public.wine_reference_lwin_entries entry
join public.wine_reference_lwin_snapshots snapshot
  on snapshot.id = entry.snapshot_id
where snapshot.import_status = 'active';

comment on view public.wine_reference_active_lwin_entries is
    'Only the fully validated current LWIN source rows; intended for trusted matching services.';


-- A CellarManager identity remains valid when no provider identifier exists.
-- The durable demand records what later server infrastructure should retry or
-- submit without making local wine creation depend on network connectivity.
alter table public.wine_reference_external_identifiers
    add constraint wine_reference_external_identifiers_demand_target_unique
    unique (
        id,
        entity_id,
        entity_type,
        authority,
        identifier_scheme
    );

create table public.wine_reference_identifier_demands (
    id uuid primary key default gen_random_uuid(),
    entity_id uuid not null,
    entity_type text not null,
    authority text not null,
    identifier_scheme text not null,
    demand_status text not null default 'pending',
    attempt_count integer not null default 0,
    next_attempt_at timestamptz,
    last_attempted_at timestamptz,
    last_error_code text,
    resolved_identifier_id uuid,
    resolved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint wine_reference_identifier_demands_entity_fk
        foreign key (entity_id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade,

    constraint wine_reference_identifier_demands_resolution_fk
        foreign key (
            resolved_identifier_id,
            entity_id,
            entity_type,
            authority,
            identifier_scheme
        )
        references public.wine_reference_external_identifiers(
            id,
            entity_id,
            entity_type,
            authority,
            identifier_scheme
        ),

    constraint wine_reference_identifier_demands_authority_check
        check (
            length(authority) > 0
            and authority = lower(trim(authority))
        ),

    constraint wine_reference_identifier_demands_scheme_check
        check (
            length(identifier_scheme) > 0
            and identifier_scheme = upper(trim(identifier_scheme))
        ),

    constraint wine_reference_identifier_demands_scope_check
        check (
            authority <> 'liv-ex'
            or identifier_scheme not in ('LWIN7', 'LWIN11', 'LWIN16', 'LWIN18')
            or (identifier_scheme = 'LWIN7' and entity_type = 'product')
            or (identifier_scheme = 'LWIN11' and entity_type = 'release')
            or (identifier_scheme = 'LWIN16' and entity_type = 'package')
            or (identifier_scheme = 'LWIN18' and entity_type = 'package')
        ),

    constraint wine_reference_identifier_demands_status_check
        check (
            demand_status in (
                'pending',
                'retrying',
                'submitted',
                'resolved',
                'not_available'
            )
        ),

    constraint wine_reference_identifier_demands_attempts_check
        check (attempt_count >= 0),

    constraint wine_reference_identifier_demands_error_check
        check (
            last_error_code is null
            or length(trim(last_error_code)) > 0
        ),

    constraint wine_reference_identifier_demands_resolution_check
        check (
            (
                demand_status = 'resolved'
                and resolved_identifier_id is not null
                and resolved_at is not null
            )
            or (
                demand_status <> 'resolved'
                and resolved_identifier_id is null
                and resolved_at is null
            )
        ),

    constraint wine_reference_identifier_demands_unique
        unique (
            entity_id,
            authority,
            identifier_scheme
        )
);

create index wine_reference_identifier_demands_queue_idx
    on public.wine_reference_identifier_demands(
        demand_status,
        next_attempt_at,
        created_at
    )
    where demand_status in ('pending', 'retrying');

comment on table public.wine_reference_identifier_demands is
    'Durable service queue for CellarManager identities that remain usable while an external identifier is missing.';


create or replace function private.prepare_wine_reference_identifier_demand()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_identifier_id uuid;
begin
    select identifier.id
    into v_identifier_id
    from public.wine_reference_external_identifiers identifier
    where identifier.entity_id = new.entity_id
      and identifier.entity_type = new.entity_type
      and identifier.authority = new.authority
      and identifier.identifier_scheme = new.identifier_scheme;

    if found then
        new.demand_status := 'resolved';
        new.resolved_identifier_id := v_identifier_id;
        new.resolved_at := coalesce(new.resolved_at, now());
        new.next_attempt_at := null;
        new.last_error_code := null;
    elsif new.demand_status = 'resolved' then
        raise exception using
            errcode = '23514',
            message = 'A resolved identifier demand requires a matching external identifier';
    else
        new.resolved_identifier_id := null;
        new.resolved_at := null;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

revoke execute
    on function private.prepare_wine_reference_identifier_demand()
    from public, anon, authenticated;

create trigger wine_reference_identifier_demands_prepare
before insert or update
on public.wine_reference_identifier_demands
for each row
execute function private.prepare_wine_reference_identifier_demand();


create or replace function private.resolve_wine_reference_identifier_demand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    update public.wine_reference_identifier_demands demand
    set
        demand_status = 'resolved',
        resolved_identifier_id = new.id,
        resolved_at = now(),
        next_attempt_at = null,
        last_error_code = null
    where demand.entity_id = new.entity_id
      and demand.entity_type = new.entity_type
      and demand.authority = new.authority
      and demand.identifier_scheme = new.identifier_scheme;

    return new;
end;
$$;

revoke execute
    on function private.resolve_wine_reference_identifier_demand()
    from public, anon, authenticated;

create trigger wine_reference_external_identifiers_resolve_demand
after insert or update
on public.wine_reference_external_identifiers
for each row
execute function private.resolve_wine_reference_identifier_demand();


alter table public.wine_reference_sources enable row level security;
alter table public.wine_reference_lwin_snapshots enable row level security;
alter table public.wine_reference_lwin_entries enable row level security;
alter table public.wine_reference_identifier_demands enable row level security;

revoke all privileges on table
    public.wine_reference_sources,
    public.wine_reference_lwin_snapshots,
    public.wine_reference_lwin_entries,
    public.wine_reference_identifier_demands
from public, anon, authenticated, powersync_role;

revoke all privileges on table
    public.wine_reference_active_lwin_entries
from public, anon, authenticated, powersync_role;

grant select on table public.wine_reference_sources
to service_role;

grant select, insert on table
    public.wine_reference_lwin_snapshots,
    public.wine_reference_lwin_entries
to service_role;

grant select, insert, update, delete on table
    public.wine_reference_identifier_demands
to service_role;

grant select on table public.wine_reference_active_lwin_entries
to service_role;

commit;
