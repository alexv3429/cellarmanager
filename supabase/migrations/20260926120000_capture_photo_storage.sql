begin;

-- Temporary, owner-initiated label-photo uploads. The browser receives only
-- opaque per-object upload paths and the Storage API remains the only layer
-- allowed to create or remove object bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'capture-labels',
    'capture-labels',
    false,
    6291456,
    array['image/jpeg', 'image/png']::text[]
)
on conflict (id) do nothing;

do $$
declare
    v_bucket storage.buckets%rowtype;
begin
    select * into v_bucket from storage.buckets where id = 'capture-labels';
    if not found
       or v_bucket.public is distinct from false
       or v_bucket.file_size_limit is distinct from 6291456
       or v_bucket.allowed_mime_types is distinct from array['image/jpeg', 'image/png']::text[] then
        raise exception 'The capture-labels bucket already exists with an unexpected configuration';
    end if;
end;
$$;

create table private.capture_sessions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    initiating_user_id uuid not null,
    state text not null default 'uploading'
        check (state in ('uploading', 'ready', 'deletion_pending')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0),
    cleanup_retry_after timestamptz,
    reserved_bytes bigint not null check (reserved_bytes between 1 and 27262976),
    check (expires_at <= created_at + interval '7 days')
);

create index capture_sessions_owner_state_idx
    on private.capture_sessions (initiating_user_id, state, expires_at);
create index capture_sessions_cleanup_idx
    on private.capture_sessions (state, cleanup_retry_after, expires_at, created_at);

create table private.capture_assets (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references private.capture_sessions(id) on delete cascade,
    object_name text not null unique,
    declared_bytes bigint not null check (declared_bytes between 1 and 6291456),
    content_type text not null check (content_type in ('image/jpeg', 'image/png')),
    state text not null default 'reserved' check (state in ('reserved', 'uploaded')),
    uploaded_bytes bigint,
    uploaded_at timestamptz,
    check (uploaded_bytes is null or uploaded_bytes between 1 and 6291456),
    check ((state = 'reserved' and uploaded_bytes is null and uploaded_at is null)
        or (state = 'uploaded' and uploaded_bytes is not null and uploaded_at is not null))
);

create index capture_assets_session_idx on private.capture_assets (session_id);

create table private.capture_session_events (
    id bigint generated always as identity primary key,
    initiating_user_id uuid not null,
    session_id uuid not null,
    image_count smallint not null check (image_count between 1 and 2),
    created_at timestamptz not null default now()
);

create index capture_session_events_owner_created_idx
    on private.capture_session_events (initiating_user_id, created_at desc);

alter table private.capture_sessions enable row level security;
alter table private.capture_assets enable row level security;
alter table private.capture_session_events enable row level security;
revoke all on private.capture_sessions, private.capture_assets, private.capture_session_events
    from public, anon, authenticated, service_role;

-- Used only by Storage RLS. A path is valid only for the current initiating
-- Owner, the exact reserved object key, and the currently allowed lifecycle.
create function storage.capture_object_operation_allowed(
    p_object_name text,
    p_expected_state text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from private.capture_assets asset
        join private.capture_sessions session on session.id = asset.session_id
        where asset.object_name = p_object_name
          and session.initiating_user_id = (select auth.uid())
          and session.state = p_expected_state
          and (
              (p_expected_state = 'uploading' and session.expires_at > now())
              or p_expected_state = 'deletion_pending'
          )
          and private.is_household_owner(session.household_id)
    );
$$;

revoke all on function storage.capture_object_operation_allowed(text, text)
    from public, anon, authenticated;
grant execute on function storage.capture_object_operation_allowed(text, text)
    to authenticated;

do $$
begin
    -- Storage policies are permissive by default. An older or externally
    -- managed policy could silently broaden access to this private bucket.
    if exists (
        select 1 from pg_catalog.pg_policies policy
        where policy.schemaname = 'storage'
          and policy.tablename = 'objects'
          and policy.policyname not in (
              'capture_label_upload_insert',
              'capture_label_upload_response_select',
              'capture_label_cancel_delete'
          )
    ) then
        raise exception 'Unexpected Storage object policies exist; review them before enabling private label-photo uploads';
    end if;
end;
$$;

create policy capture_label_upload_insert
on storage.objects
for insert to authenticated
with check (
    bucket_id = 'capture-labels'
    and storage.capture_object_operation_allowed(name, 'uploading')
);

-- Supabase Storage's upload path performs a narrowly-scoped metadata read on
-- some versions. This operation-specific policy satisfies that read without
-- enabling object listing or authenticated downloads.
create policy capture_label_upload_response_select
on storage.objects
for select to authenticated
using (
    bucket_id = 'capture-labels'
    and storage.allow_only_operation('storage.object.upload')
    and storage.capture_object_operation_allowed(name, 'uploading')
);

create policy capture_label_cancel_delete
on storage.objects
for delete to authenticated
using (
    bucket_id = 'capture-labels'
    and storage.capture_object_operation_allowed(name, 'deletion_pending')
);

create function public.create_capture_session(
    p_household_id uuid,
    p_assets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session_id uuid := gen_random_uuid();
    v_expires_at timestamptz := now() + interval '7 days';
    v_image_count integer;
    v_reserved_bytes bigint;
    v_active_count integer;
    v_hour_sessions integer;
    v_hour_images integer;
    v_account_reserved bigint;
    v_global_reserved bigint;
    v_asset jsonb;
    v_object_name text;
    v_content_type text;
    v_declared_bytes bigint;
    v_objects jsonb := '[]'::jsonb;
begin
    if v_actor is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    perform private.require_household_owner(p_household_id);

    if p_assets is null or jsonb_typeof(p_assets) <> 'array'
       or jsonb_array_length(p_assets) not between 1 and 2 then
        raise exception using errcode = '22023', message = 'Choose one or two JPEG or PNG photos';
    end if;

    -- Take account then deployment locks in one stable order so concurrent
    -- uploads cannot pass either the per-account or total-storage budgets.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('capture-account:' || v_actor::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('capture-global-capacity:v1', 0));

    select count(*)::integer into v_active_count
    from private.capture_sessions
    where initiating_user_id = v_actor
      and state in ('uploading', 'ready')
      and expires_at > now();
    if v_active_count >= 10 then
        raise exception using errcode = 'P0001', message = 'Capture limit reached; cancel or finish an earlier photo capture';
    end if;

    delete from private.capture_session_events where created_at < now() - interval '1 day';
    select count(*)::integer, coalesce(sum(image_count), 0)::integer
      into v_hour_sessions, v_hour_images
    from private.capture_session_events
    where initiating_user_id = v_actor
      and created_at >= now() - interval '1 hour';
    v_image_count := jsonb_array_length(p_assets);
    if v_hour_sessions >= 10 or v_hour_images + v_image_count > 20 then
        raise exception using errcode = 'P0001', message = 'Photo capture hourly limit reached; try again later';
    end if;

    -- Reserve 8 MiB for an original plus a future 5 MiB normalized derivative
    -- per slot, although this step accepts only 6 MiB uploads.
    v_reserved_bytes := v_image_count * 13631488;
    select coalesce(sum(reserved_bytes), 0) into v_account_reserved
    from private.capture_sessions
    where initiating_user_id = v_actor;
    if v_account_reserved + v_reserved_bytes > 272629760 then
        raise exception using errcode = 'P0001', message = 'Your temporary photo-storage allowance is full';
    end if;

    select coalesce(sum(reserved_bytes), 0) into v_global_reserved
    from private.capture_sessions;
    if v_global_reserved + v_reserved_bytes > 536870912 then
        raise exception using errcode = 'P0001', message = 'Temporary photo storage is full; try again later';
    end if;

    insert into private.capture_sessions(id, household_id, initiating_user_id, state, expires_at, reserved_bytes)
    values (v_session_id, p_household_id, v_actor, 'uploading', v_expires_at, v_reserved_bytes);

    for v_asset in select value from jsonb_array_elements(p_assets)
    loop
        if jsonb_typeof(v_asset) <> 'object'
           or (select count(*) from jsonb_object_keys(v_asset)) <> 2 then
            raise exception using errcode = '22023', message = 'Each photo needs a supported image type and size';
        end if;
        v_content_type := v_asset->>'content_type';
        if coalesce(v_asset->>'size_bytes', '') !~ '^[0-9]{1,10}$' then
            raise exception using errcode = '22023', message = 'Each photo needs a supported image type and size';
        end if;
        v_declared_bytes := (v_asset->>'size_bytes')::bigint;
        if coalesce(v_content_type, '') not in ('image/jpeg', 'image/png')
           or v_declared_bytes not between 1 and 6291456 then
            raise exception using errcode = '22023', message = 'Photos must be JPEG or PNG files no larger than 6 MB';
        end if;
        v_object_name := gen_random_uuid()::text;
        insert into private.capture_assets(session_id, object_name, declared_bytes, content_type)
        values (v_session_id, v_object_name, v_declared_bytes, v_content_type);
        v_objects := v_objects || jsonb_build_array(jsonb_build_object(
            'object_name', v_object_name,
            'content_type', v_content_type
        ));
    end loop;

    insert into private.capture_session_events(initiating_user_id, session_id, image_count)
    values (v_actor, v_session_id, v_image_count);

    return jsonb_build_object(
        'session_id', v_session_id,
        'expires_at', v_expires_at,
        'objects', v_objects
    );
end;
$$;

create function public.list_capture_sessions(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_sessions jsonb;
begin
    perform private.require_household_owner(p_household_id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', session.id,
        'state', session.state,
        'created_at', session.created_at,
        'expires_at', session.expires_at,
        'photo_count', (select count(*)::integer from private.capture_assets asset where asset.session_id = session.id)
    ) order by session.created_at desc), '[]'::jsonb)
    into v_sessions
    from private.capture_sessions session
    where session.household_id = p_household_id
      and session.initiating_user_id = v_actor;
    return v_sessions;
end;
$$;

create function public.complete_capture_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_expected integer;
    v_uploaded integer;
begin
    select * into v_session from private.capture_sessions where id = p_session_id for update;
    if not found or v_session.initiating_user_id <> v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);
    if v_session.state = 'ready' then
        return jsonb_build_object('session_id', v_session.id, 'state', v_session.state, 'expires_at', v_session.expires_at);
    end if;
    if v_session.state <> 'uploading' or v_session.expires_at <= now() then
        raise exception using errcode = '55000', message = 'Capture is no longer accepting photos';
    end if;

    select count(*)::integer into v_expected from private.capture_assets where session_id = p_session_id;
    select count(*)::integer into v_uploaded
    from private.capture_assets asset
    join storage.objects object on object.bucket_id = 'capture-labels' and object.name = asset.object_name
    where asset.session_id = p_session_id
      and case when object.metadata->>'size' ~ '^[0-9]{1,10}$' then (object.metadata->>'size')::bigint else -1 end = asset.declared_bytes
      and object.metadata->>'mimetype' = asset.content_type;
    if v_expected = 0 or v_uploaded <> v_expected then
        raise exception using errcode = '55000', message = 'One or more photos did not finish uploading; cancel and try again';
    end if;

    update private.capture_assets asset
    set state = 'uploaded',
        uploaded_bytes = (object.metadata->>'size')::bigint,
        uploaded_at = now()
    from storage.objects object
    where asset.session_id = p_session_id
      and object.bucket_id = 'capture-labels'
      and object.name = asset.object_name;
    update private.capture_sessions set state = 'ready' where id = p_session_id;
    return jsonb_build_object('session_id', p_session_id, 'state', 'ready', 'expires_at', v_session.expires_at);
end;
$$;

create function public.cancel_capture_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_object_names jsonb;
begin
    select * into v_session from private.capture_sessions where id = p_session_id for update;
    if not found or v_session.initiating_user_id <> v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);
    update private.capture_sessions set state = 'deletion_pending' where id = p_session_id;
    select coalesce(jsonb_agg(asset.object_name order by asset.object_name), '[]'::jsonb)
      into v_object_names
    from private.capture_assets asset
    join storage.objects object
      on object.bucket_id = 'capture-labels'
     and object.name = asset.object_name
    where asset.session_id = p_session_id;
    return jsonb_build_object('session_id', p_session_id, 'object_names', v_object_names);
end;
$$;

create function public.complete_capture_cleanup(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_session private.capture_sessions%rowtype;
    v_service_role boolean := coalesce(auth.role(), '') = 'service_role';
begin
    select * into v_session from private.capture_sessions where id = p_session_id for update;
    if not found then return true; end if;
    if not v_service_role then
        if v_session.initiating_user_id is distinct from (select auth.uid()) then
            raise exception using errcode = '42501', message = 'Capture is not available to this account';
        end if;
        perform private.require_household_owner(v_session.household_id);
    end if;
    if v_session.state <> 'deletion_pending' then
        raise exception using errcode = '55000', message = 'Capture must be closed before deletion';
    end if;
    if exists (
        select 1 from private.capture_assets asset
        join storage.objects object
          on object.bucket_id = 'capture-labels'
         and object.name = asset.object_name
        where asset.session_id = p_session_id
    ) then
        return false;
    end if;
    delete from private.capture_sessions where id = p_session_id;
    return true;
end;
$$;

create function public.claim_capture_cleanup(p_limit integer default 100)
returns table (session_id uuid, object_names text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_session_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception using errcode = '42501', message = 'Service role is required';
    end if;
    if p_limit not between 1 and 250 then
        raise exception using errcode = '22023', message = 'Cleanup batch size must be between 1 and 250';
    end if;

    delete from private.capture_session_events where created_at < now() - interval '1 day';
    for v_session_id in
        select session.id
        from private.capture_sessions session
        where (
            session.state = 'deletion_pending'
            and (session.cleanup_retry_after is null or session.cleanup_retry_after <= now())
        ) or (
            session.state in ('uploading', 'ready')
            and session.expires_at <= now()
        )
        order by session.expires_at, session.created_at
        limit p_limit
        for update skip locked
    loop
        update private.capture_sessions
        set state = 'deletion_pending',
            cleanup_attempts = cleanup_attempts + 1,
            cleanup_retry_after = now() + make_interval(mins => least(960, 30 * (1 << least(cleanup_attempts, 5))))
        where id = v_session_id;
        session_id := v_session_id;
        select coalesce(array_agg(asset.object_name order by asset.object_name), array[]::text[])
          into object_names
        from private.capture_assets asset
        join storage.objects object
          on object.bucket_id = 'capture-labels'
         and object.name = asset.object_name
        where asset.session_id = v_session_id;
        return next;
    end loop;
end;
$$;

revoke all on function public.create_capture_session(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.list_capture_sessions(uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_capture_session(uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_capture_session(uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_capture_cleanup(uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_capture_cleanup(integer) from public, anon, authenticated, service_role;

grant execute on function public.create_capture_session(uuid, jsonb) to authenticated;
grant execute on function public.list_capture_sessions(uuid) to authenticated;
grant execute on function public.complete_capture_session(uuid) to authenticated;
grant execute on function public.cancel_capture_session(uuid) to authenticated;
grant execute on function public.complete_capture_cleanup(uuid) to authenticated, service_role;
grant execute on function public.claim_capture_cleanup(integer) to service_role;

commit;
