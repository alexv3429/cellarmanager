begin;

alter table private.capture_sessions
    add column preprocessing_started_at timestamptz;

-- Existing in-flight sessions receive a fresh five-minute lease so an active
-- Worker is not reclaimed midway through this migration/deployment.
update private.capture_sessions
set preprocessing_started_at = now()
where state = 'processing';

create function private.maintain_capture_preprocessing_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.state = 'processing' then
        new.preprocessing_started_at := coalesce(new.preprocessing_started_at, clock_timestamp());
    else
        new.preprocessing_started_at := null;
    end if;
    return new;
end;
$$;

revoke all on function private.maintain_capture_preprocessing_lease() from public, anon, authenticated, service_role;
create trigger capture_sessions_preprocessing_lease
before insert or update of state, preprocessing_started_at on private.capture_sessions
for each row execute function private.maintain_capture_preprocessing_lease();

create or replace function public.claim_capture_preprocessing(p_session_id uuid)
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
    v_reclaimed boolean := false;
begin
    select * into v_session
    from private.capture_sessions
    where id = p_session_id
    for update;
    if not found or v_session.initiating_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);

    if v_session.state = 'processed' then
        return jsonb_build_object(
            'session_id', p_session_id,
            'state', 'processed',
            'reclaimed', false,
            'assets', '[]'::jsonb
        );
    end if;

    if v_session.state = 'processing' then
        if v_session.expires_at <= now() then
            raise exception using errcode = '55000', message = 'Capture has expired';
        end if;
        if coalesce(v_session.preprocessing_started_at, v_session.created_at) > now() - interval '5 minutes' then
            return jsonb_build_object(
                'session_id', p_session_id,
                'state', 'processing',
                'reclaimed', false,
                'assets', '[]'::jsonb
            );
        end if;
        v_reclaimed := true;
        update private.capture_sessions
        set preprocessing_started_at = clock_timestamp()
        where id = p_session_id;
    elsif v_session.state = 'ready' then
        if v_session.expires_at <= now() then
            raise exception using errcode = '55000', message = 'Capture has expired';
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

        update private.capture_sessions
        set state = 'processing', preprocessing_started_at = clock_timestamp()
        where id = p_session_id;
        update private.capture_assets
        set state = 'processing', normalized_object_name = gen_random_uuid()::text
        where session_id = p_session_id and state = 'uploaded';
    else
        raise exception using errcode = '55000', message = 'Capture is not ready for image preparation';
    end if;

    select count(*)::integer into v_count
    from private.capture_assets
    where session_id = p_session_id and state = 'processing'
      and normalized_object_name is not null;
    if v_count < 1 or v_count > 2 or exists (
        select 1 from private.capture_assets
        where session_id = p_session_id and state <> 'processing'
    ) then
        raise exception using errcode = '55000', message = 'Capture assets are incomplete';
    end if;

    select jsonb_agg(jsonb_build_object(
        'source_object_name', asset.object_name,
        'normalized_object_name', asset.normalized_object_name,
        'content_type', asset.content_type,
        'uploaded_bytes', asset.uploaded_bytes
    ) order by asset.id)
    into v_assets
    from private.capture_assets asset
    where asset.session_id = p_session_id and asset.state = 'processing';

    return jsonb_build_object(
        'session_id', p_session_id,
        'state', 'claimed',
        'reclaimed', v_reclaimed,
        'assets', v_assets
    );
end;
$$;

create or replace function public.list_capture_sessions(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_sessions jsonb;
begin
    perform private.require_household_owner(p_household_id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', session.id,
        'state', session.state,
        'created_at', session.created_at,
        'expires_at', session.expires_at,
        'processing_started_at', session.preprocessing_started_at,
        'photo_count', (select count(*)::integer from private.capture_assets asset where asset.session_id = session.id)
    ) order by session.created_at desc), '[]'::jsonb)
    into v_sessions
    from private.capture_sessions session
    where session.household_id = p_household_id
      and session.initiating_user_id = (select auth.uid());
    return v_sessions;
end;
$$;

revoke all on function public.claim_capture_preprocessing(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_capture_sessions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_capture_preprocessing(uuid) to authenticated;
grant execute on function public.list_capture_sessions(uuid) to authenticated;

commit;
