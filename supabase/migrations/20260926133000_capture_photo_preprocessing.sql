begin;

alter table private.capture_sessions
    drop constraint capture_sessions_state_check;
alter table private.capture_sessions
    add constraint capture_sessions_state_check
    check (state in ('uploading', 'ready', 'processing', 'processed', 'deletion_pending'));

alter table private.capture_assets
    drop constraint capture_assets_state_check;
alter table private.capture_assets
    add column normalized_object_name text unique,
    add constraint capture_assets_state_check
    check (state in ('reserved', 'uploaded', 'processing', 'processed')),
    add constraint capture_assets_lifecycle_check
    check (
        (state = 'reserved' and uploaded_bytes is null and uploaded_at is null and normalized_object_name is null)
        or (state = 'uploaded' and uploaded_bytes is not null and uploaded_at is not null and normalized_object_name is null)
        or (state = 'processing' and uploaded_bytes is not null and uploaded_at is not null and normalized_object_name is not null)
        or (state = 'processed' and uploaded_bytes is not null and uploaded_at is not null and normalized_object_name is null)
    );

-- The 0.6.6 create RPC counts only uploading/ready sessions. Keep the
-- ten-session active ceiling intact after this lifecycle adds processing and
-- processed states, while the RPC's existing advisory lock serializes creates.
create function capture_guard.enforce_capture_active_session_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_active_count integer;
begin
    if new.state not in ('uploading', 'ready', 'processing', 'processed')
       or new.expires_at <= now() then
        return new;
    end if;
    select count(*)::integer into v_active_count
    from private.capture_sessions session
    where session.initiating_user_id = new.initiating_user_id
      and session.expires_at > now()
      and session.state in ('uploading', 'ready', 'processing', 'processed');
    if v_active_count >= 10 then
        raise exception using errcode = 'P0001', message = 'Capture limit reached; cancel or finish an earlier photo capture';
    end if;
    return new;
end;
$$;

revoke all on function capture_guard.enforce_capture_active_session_limit() from public, anon, authenticated, service_role;
create trigger capture_sessions_active_limit
before insert on private.capture_sessions
for each row execute function capture_guard.enforce_capture_active_session_limit();

create or replace function capture_guard.capture_object_operation_allowed(
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
        where session.initiating_user_id = (select auth.uid())
          and private.is_household_owner(session.household_id)
          and (
              (
                  p_expected_state = 'uploading'
                  and asset.object_name = p_object_name
                  and asset.state = 'reserved'
                  and session.state = 'uploading'
                  and session.expires_at > now()
              )
              or (
                  p_expected_state = 'processed'
                  and asset.object_name = p_object_name
                  and asset.state = 'processed'
                  and session.state = 'processed'
                  and session.expires_at > now()
              )
              or (
                  p_expected_state = 'deletion_pending'
                  and session.state = 'deletion_pending'
                  and p_object_name in (asset.object_name, asset.normalized_object_name)
              )
          )
    );
$$;

drop policy capture_label_cancel_delete on storage.objects;
do $$
begin
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
        raise exception 'Unexpected Storage object policies exist; review them before enabling processed capture previews';
    end if;
end;
$$;

create policy capture_label_cancel_delete
on storage.objects
for delete to authenticated
using (
    bucket_id = 'capture-labels'
    and capture_guard.capture_object_operation_allowed(name, 'deletion_pending')
);

create policy capture_label_processed_select
on storage.objects
for select to authenticated
using (
    bucket_id = 'capture-labels'
    and storage.allow_only_operation('storage.object.get_authenticated')
    and capture_guard.capture_object_operation_allowed(name, 'processed')
);

create function public.claim_capture_preprocessing(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_assets jsonb;
    v_count integer;
begin
    select * into v_session
    from private.capture_sessions
    where id = p_session_id
    for update;
    if not found or v_session.initiating_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);

    if v_session.state in ('processing', 'processed') then
        return jsonb_build_object('session_id', p_session_id, 'state', v_session.state, 'assets', '[]'::jsonb);
    end if;
    if v_session.state <> 'ready' or v_session.expires_at <= now() then
        raise exception using errcode = '55000', message = 'Capture is not ready for image preparation';
    end if;

    select count(*)::integer into v_count
    from private.capture_assets
    where session_id = p_session_id and state = 'uploaded';
    if v_count < 1 or v_count > 2 or exists (
        select 1 from private.capture_assets
        where session_id = p_session_id and state <> 'uploaded'
    ) then
        raise exception using errcode = '55000', message = 'Capture assets are incomplete';
    end if;

    update private.capture_sessions set state = 'processing' where id = p_session_id;
    update private.capture_assets
    set state = 'processing', normalized_object_name = gen_random_uuid()::text
    where session_id = p_session_id and state = 'uploaded';

    select jsonb_agg(jsonb_build_object(
        'source_object_name', asset.object_name,
        'normalized_object_name', asset.normalized_object_name,
        'content_type', asset.content_type,
        'uploaded_bytes', asset.uploaded_bytes
    ) order by asset.id)
    into v_assets
    from private.capture_assets asset
    where asset.session_id = p_session_id and asset.state = 'processing';

    -- Distinguish this request's successful claim from a concurrent request
    -- that found the session already being processed.
    return jsonb_build_object('session_id', p_session_id, 'state', 'claimed', 'assets', v_assets);
end;
$$;

create function public.list_capture_processed_assets(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_assets jsonb;
begin
    select * into v_session
    from private.capture_sessions
    where id = p_session_id;
    if not found or v_session.initiating_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);
    if v_session.state <> 'processed' or v_session.expires_at <= now() then
        return '[]'::jsonb;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'object_name', asset.object_name,
        'content_type', asset.content_type,
        'size_bytes', asset.uploaded_bytes
    ) order by asset.id), '[]'::jsonb)
    into v_assets
    from private.capture_assets asset
    where asset.session_id = p_session_id and asset.state = 'processed';
    return v_assets;
end;
$$;

create function public.complete_capture_preprocessing(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_session private.capture_sessions%rowtype;
    v_asset_count integer;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception using errcode = '42501', message = 'Service role is required';
    end if;
    select * into v_session
    from private.capture_sessions
    where id = p_session_id
    for update;
    if not found then return false; end if;
    if v_session.state = 'processed' then return true; end if;
    if v_session.state <> 'processing' or v_session.expires_at <= now() then return false; end if;

    select count(*)::integer into v_asset_count
    from private.capture_assets asset
    where asset.session_id = p_session_id
      and asset.state = 'processing'
      and asset.normalized_object_name is not null
      and exists (
          select 1 from storage.objects normalized
          where normalized.bucket_id = 'capture-labels'
            and normalized.name = asset.normalized_object_name
            and normalized.metadata->>'mimetype' = 'image/jpeg'
            and normalized.metadata->>'size' ~ '^[0-9]{1,10}$'
            and (normalized.metadata->>'size')::bigint between 1 and 5242880
      )
      and not exists (
          select 1 from storage.objects original
          where original.bucket_id = 'capture-labels'
            and original.name = asset.object_name
      );
    if v_asset_count < 1 or v_asset_count <> (
        select count(*)::integer from private.capture_assets where session_id = p_session_id
    ) then
        return false;
    end if;

    update private.capture_assets asset
    set object_name = asset.normalized_object_name,
        normalized_object_name = null,
        declared_bytes = (normalized.metadata->>'size')::bigint,
        content_type = 'image/jpeg',
        state = 'processed',
        uploaded_bytes = (normalized.metadata->>'size')::bigint,
        uploaded_at = now()
    from storage.objects normalized
    where asset.session_id = p_session_id
      and asset.state = 'processing'
      and normalized.bucket_id = 'capture-labels'
      and normalized.name = asset.normalized_object_name;

    update private.capture_sessions session
    set state = 'processed',
        reserved_bytes = (
            select coalesce(sum(asset.uploaded_bytes), 0)
            from private.capture_assets asset
            where asset.session_id = p_session_id
        )
    where session.id = p_session_id;
    return true;
end;
$$;

create function public.fail_capture_preprocessing(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_session private.capture_sessions%rowtype;
    v_object_names jsonb;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception using errcode = '42501', message = 'Service role is required';
    end if;
    select * into v_session
    from private.capture_sessions
    where id = p_session_id
    for update;
    if not found then return jsonb_build_object('state', 'deleted', 'object_names', '[]'::jsonb); end if;
    if v_session.state = 'processed' then
        return jsonb_build_object('state', 'processed', 'object_names', '[]'::jsonb);
    end if;
    if v_session.state not in ('processing', 'deletion_pending') then
        raise exception using errcode = '55000', message = 'Capture is not being processed';
    end if;
    update private.capture_sessions
    set state = 'deletion_pending', cleanup_retry_after = null
    where id = p_session_id;

    select coalesce(jsonb_agg(distinct object.name), '[]'::jsonb)
    into v_object_names
    from private.capture_assets asset
    cross join lateral unnest(array[asset.object_name, asset.normalized_object_name]) candidate(name)
    join storage.objects object
      on object.bucket_id = 'capture-labels'
     and object.name = candidate.name
    where asset.session_id = p_session_id;
    return jsonb_build_object('state', 'deletion_pending', 'object_names', v_object_names);
end;
$$;

create or replace function public.cancel_capture_session(p_session_id uuid)
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
    if v_session.state = 'processing' then
        raise exception using errcode = '55000', message = 'Photo preparation is still in progress';
    end if;
    update private.capture_sessions
    set state = 'deletion_pending', cleanup_retry_after = null
    where id = p_session_id;
    select coalesce(jsonb_agg(distinct object.name), '[]'::jsonb)
      into v_object_names
    from private.capture_assets asset
    cross join lateral unnest(array[asset.object_name, asset.normalized_object_name]) candidate(name)
    join storage.objects object
      on object.bucket_id = 'capture-labels'
     and object.name = candidate.name
    where asset.session_id = p_session_id;
    return jsonb_build_object('session_id', p_session_id, 'object_names', v_object_names);
end;
$$;

create or replace function public.complete_capture_cleanup(p_session_id uuid)
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
        select 1
        from private.capture_assets asset
        cross join lateral unnest(array[asset.object_name, asset.normalized_object_name]) candidate(name)
        join storage.objects object
          on object.bucket_id = 'capture-labels'
         and object.name = candidate.name
        where asset.session_id = p_session_id
    ) then
        return false;
    end if;
    delete from private.capture_sessions where id = p_session_id;
    return true;
end;
$$;

create or replace function public.claim_capture_cleanup(p_limit integer default 100)
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
            session.state in ('uploading', 'ready', 'processing', 'processed')
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
        select coalesce(array_agg(distinct object.name order by object.name), array[]::text[])
          into object_names
        from private.capture_assets asset
        cross join lateral unnest(array[asset.object_name, asset.normalized_object_name]) candidate(name)
        join storage.objects object
          on object.bucket_id = 'capture-labels'
         and object.name = candidate.name
        where asset.session_id = v_session_id;
        return next;
    end loop;
end;
$$;

revoke all on function public.claim_capture_preprocessing(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_capture_processed_assets(uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_capture_preprocessing(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_capture_preprocessing(uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_capture_session(uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_capture_cleanup(uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_capture_cleanup(integer) from public, anon, authenticated, service_role;

grant execute on function public.claim_capture_preprocessing(uuid) to authenticated;
grant execute on function public.list_capture_processed_assets(uuid) to authenticated;
grant execute on function public.complete_capture_preprocessing(uuid) to service_role;
grant execute on function public.fail_capture_preprocessing(uuid) to service_role;
grant execute on function public.cancel_capture_session(uuid) to authenticated;
grant execute on function public.complete_capture_cleanup(uuid) to authenticated, service_role;
grant execute on function public.claim_capture_cleanup(integer) to service_role;

commit;
