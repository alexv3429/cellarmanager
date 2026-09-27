begin;

-- A successfully recognized capture keeps only a tiny text draft. Release its
-- photo-storage reservation as soon as Storage confirms the image is gone.
alter table private.capture_sessions
    drop constraint capture_sessions_reserved_bytes_check;
alter table private.capture_sessions
    add constraint capture_sessions_reserved_bytes_check
    check (reserved_bytes between 0 and 27262976);

alter table private.capture_sessions
    drop constraint capture_sessions_state_check;
alter table private.capture_sessions
    add constraint capture_sessions_state_check
    check (state in (
        'uploading', 'ready', 'processing', 'processed',
        'ocr_deletion_pending', 'recognized', 'deletion_pending'
    ));

-- Recognized text is a private, short-lived draft associated with its capture.
-- It is deliberately outside PowerSync, shared wine facts, and inventory.
create table private.capture_ocr_results (
    session_id uuid primary key references private.capture_sessions(id) on delete cascade,
    language_code text not null check (language_code = 'fra+eng'),
    engine_version text not null check (engine_version = '7.0.0'),
    recognized_pages jsonb not null check (
        case when jsonb_typeof(recognized_pages) = 'array'
            then jsonb_array_length(recognized_pages) between 1 and 2
            else false
        end
    ),
    created_at timestamptz not null default now()
);

alter table private.capture_ocr_results enable row level security;
revoke all on private.capture_ocr_results from public, anon, authenticated, service_role;

create or replace function capture_guard.enforce_capture_active_session_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_active_count integer;
begin
    if new.state not in (
           'uploading', 'ready', 'processing', 'processed',
           'ocr_deletion_pending', 'recognized'
       )
       or new.expires_at <= now() then
        return new;
    end if;
    select count(*)::integer into v_active_count
    from private.capture_sessions session
    where session.initiating_user_id = new.initiating_user_id
      and session.expires_at > now()
      and session.state in (
          'uploading', 'ready', 'processing', 'processed',
          'ocr_deletion_pending', 'recognized'
      );
    if v_active_count >= 10 then
        raise exception using errcode = 'P0001', message = 'Capture limit reached; cancel or finish an earlier photo capture';
    end if;
    return new;
end;
$$;

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
                  and session.state in ('deletion_pending', 'ocr_deletion_pending')
                  and p_object_name in (asset.object_name, asset.normalized_object_name)
              )
          )
    );
$$;

create or replace function public.list_capture_sessions(p_household_id uuid)
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
        'photo_count', case when session.state = 'recognized' then 0 else (
            select count(*)::integer from private.capture_assets asset where asset.session_id = session.id
        ) end
    ) order by session.created_at desc), '[]'::jsonb)
    into v_sessions
    from private.capture_sessions session
    where session.household_id = p_household_id
      and session.initiating_user_id = v_actor;
    return v_sessions;
end;
$$;

create function public.complete_capture_ocr(
    p_session_id uuid,
    p_pages jsonb,
    p_language_code text,
    p_engine_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_expected integer;
    v_names jsonb;
    v_page jsonb;
begin
    select * into v_session
    from private.capture_sessions
    where id = p_session_id
    for update;
    if not found or v_session.initiating_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);
    if v_session.expires_at <= now() then
        raise exception using errcode = '55000', message = 'Capture has expired';
    end if;

    if v_session.state in ('ocr_deletion_pending', 'recognized')
       and exists (select 1 from private.capture_ocr_results result where result.session_id = p_session_id) then
        select coalesce(jsonb_agg(object.name order by object.name), '[]'::jsonb)
          into v_names
        from private.capture_assets asset
        cross join lateral unnest(array[asset.object_name, asset.normalized_object_name]) candidate(name)
        join storage.objects object
          on object.bucket_id = 'capture-labels'
         and object.name = candidate.name
        where asset.session_id = p_session_id
          and v_session.state = 'ocr_deletion_pending';
        return jsonb_build_object('state', v_session.state, 'object_names', v_names);
    end if;
    if v_session.state <> 'processed' then
        raise exception using errcode = '55000', message = 'Photos must be prepared before OCR';
    end if;
    if p_language_code is distinct from 'fra+eng' or p_engine_version is distinct from '7.0.0'
       or jsonb_typeof(p_pages) is distinct from 'array' then
        raise exception using errcode = '22023', message = 'OCR result is invalid';
    end if;
    if jsonb_array_length(p_pages) not between 1 and 2 then
        raise exception using errcode = '22023', message = 'OCR result is invalid';
    end if;

    select count(*)::integer into v_expected
    from private.capture_assets asset
    where asset.session_id = p_session_id
      and asset.state = 'processed';
    if v_expected = 0 or jsonb_array_length(p_pages) <> v_expected then
        raise exception using errcode = '22023', message = 'OCR result does not match the prepared photos';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_pages) as item(page)
        where jsonb_typeof(item.page) <> 'object'
    ) then
        raise exception using errcode = '22023', message = 'OCR result is invalid';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_pages) as item(page)
        where item.page - array['object_name', 'text', 'confidence'] <> '{}'::jsonb
           or jsonb_typeof(item.page->'object_name') is distinct from 'string'
           or jsonb_typeof(item.page->'text') is distinct from 'string'
           or jsonb_typeof(item.page->'confidence') is distinct from 'number'
    ) then
        raise exception using errcode = '22023', message = 'OCR result is invalid';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_pages) as item(page)
        where char_length(item.page->>'text') > 10000
           or (item.page->>'confidence')::numeric < 0
           or (item.page->>'confidence')::numeric > 100
           or not exists (
               select 1 from private.capture_assets asset
               where asset.session_id = p_session_id
                 and asset.state = 'processed'
                 and asset.object_name = item.page->>'object_name'
           )
    ) or (
        select count(distinct item.page->>'object_name') <> v_expected
        from jsonb_array_elements(p_pages) as item(page)
    ) or (
        select coalesce(sum(char_length(item.page->>'text')), 0) > 20000
        from jsonb_array_elements(p_pages) as item(page)
    ) or (
        select count(*) = 0
        from jsonb_array_elements(p_pages) as item(page)
        where length(btrim(item.page->>'text')) > 0
    ) then
        raise exception using errcode = '22023', message = 'OCR result is outside the allowed limits';
    end if;

    insert into private.capture_ocr_results(session_id, language_code, engine_version, recognized_pages)
    values (p_session_id, p_language_code, p_engine_version, p_pages);

    update private.capture_sessions
    set state = 'ocr_deletion_pending', cleanup_attempts = 0, cleanup_retry_after = null
    where id = p_session_id;

    select coalesce(jsonb_agg(asset.normalized_object_name order by asset.normalized_object_name), '[]'::jsonb)
      into v_names
    from private.capture_assets asset
    join storage.objects object
      on object.bucket_id = 'capture-labels'
     and object.name = asset.normalized_object_name
    where asset.session_id = p_session_id;
    return jsonb_build_object('state', 'ocr_deletion_pending', 'object_names', v_names);
end;
$$;

create function public.list_capture_ocr_result(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_result private.capture_ocr_results%rowtype;
begin
    select * into v_session
    from private.capture_sessions
    where id = p_session_id;
    if not found or v_session.initiating_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);
    if v_session.state not in ('ocr_deletion_pending', 'recognized') or v_session.expires_at <= now() then
        raise exception using errcode = '55000', message = 'Recognized text is not available';
    end if;
    select * into v_result
    from private.capture_ocr_results result
    where result.session_id = p_session_id;
    if not found then
        raise exception using errcode = '55000', message = 'Recognized text is not available';
    end if;
    return jsonb_build_object(
        'session_id', v_result.session_id,
        'language_code', v_result.language_code,
        'engine_version', v_result.engine_version,
        'recognized_pages', (
            select coalesce(jsonb_agg(item.page - 'object_name' order by item.ordinality), '[]'::jsonb)
            from jsonb_array_elements(v_result.recognized_pages) with ordinality as item(page, ordinality)
        ),
        'created_at', v_result.created_at
    );
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
    if v_session.state = 'recognized' then
        if v_session.expires_at > now() then return true; end if;
        update private.capture_sessions
        set state = 'deletion_pending', cleanup_retry_after = null
        where id = p_session_id;
        v_session.state := 'deletion_pending';
    end if;
    if v_session.state in ('deletion_pending', 'ocr_deletion_pending') then
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
        if v_session.state = 'ocr_deletion_pending'
           and v_session.expires_at > now()
           and exists (select 1 from private.capture_ocr_results result where result.session_id = p_session_id) then
            update private.capture_ocr_results result
            set recognized_pages = (
                select coalesce(jsonb_agg(item.page - 'object_name' order by item.ordinality), '[]'::jsonb)
                from jsonb_array_elements(result.recognized_pages) with ordinality as item(page, ordinality)
            )
            where result.session_id = p_session_id;
            update private.capture_sessions
            set state = 'recognized', reserved_bytes = 0, cleanup_attempts = 0, cleanup_retry_after = null
            where id = p_session_id;
            return true;
        end if;
        delete from private.capture_sessions where id = p_session_id;
        return true;
    end if;
    raise exception using errcode = '55000', message = 'Capture must be closed before deletion';
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
            session.state in ('deletion_pending', 'ocr_deletion_pending')
            and (
                session.cleanup_retry_after is null
                or session.cleanup_retry_after <= now()
                or session.expires_at <= now()
            )
        ) or (
            session.state in ('uploading', 'ready', 'processing', 'processed', 'recognized')
            and session.expires_at <= now()
        )
        order by session.expires_at, session.created_at
        limit p_limit
        for update skip locked
    loop
        update private.capture_sessions
        set state = case
                when state = 'ocr_deletion_pending' and expires_at > now() then 'ocr_deletion_pending'
                else 'deletion_pending'
            end,
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

revoke all on function public.complete_capture_ocr(uuid, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.list_capture_ocr_result(uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_capture_ocr(uuid, jsonb, text, text) to authenticated;
grant execute on function public.list_capture_ocr_result(uuid) to authenticated;

commit;
