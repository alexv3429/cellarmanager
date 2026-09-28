begin;

-- Preserve old on-device capture drafts while recording the new, explicitly
-- approved Cloudflare Workers AI recognizer accurately.
alter table private.capture_ocr_results
    drop constraint capture_ocr_results_language_code_check,
    drop constraint capture_ocr_results_engine_version_check;
alter table private.capture_ocr_results
    add constraint capture_ocr_results_language_code_check
        check (language_code in ('fra+eng', 'und')),
    add constraint capture_ocr_results_engine_version_check
        check (engine_version in ('7.0.0', 'cloudflare-moondream3.1-9b-a2b-v1'));

create or replace function public.complete_capture_ocr(
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
    if not (
        (p_language_code = 'fra+eng' and p_engine_version = '7.0.0')
        or (p_language_code = 'und' and p_engine_version = 'cloudflare-moondream3.1-9b-a2b-v1')
    ) or jsonb_typeof(p_pages) is distinct from 'array' then
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
    ) or exists (
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

    select coalesce(jsonb_agg(object.name order by object.name), '[]'::jsonb)
      into v_names
    from private.capture_assets asset
    cross join lateral unnest(array[asset.object_name, asset.normalized_object_name]) candidate(name)
    join storage.objects object
      on object.bucket_id = 'capture-labels'
     and object.name = candidate.name
    where asset.session_id = p_session_id
      and asset.state = 'processed';
    return jsonb_build_object('state', 'ocr_deletion_pending', 'object_names', v_names);
end;
$$;

commit;
