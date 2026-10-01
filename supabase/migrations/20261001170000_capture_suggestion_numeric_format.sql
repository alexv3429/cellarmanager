begin;

-- Preserve the existing owner, evidence, and retention checks. The original
-- generic field loop rejected numeric format_ml values before its dedicated
-- number-range validation could run.
create or replace function public.complete_capture_wine_suggestion(
    p_session_id uuid,
    p_model_version text,
    p_suggestion jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_session private.capture_sessions%rowtype;
    v_suggestion private.capture_wine_suggestions%rowtype;
    v_field text;
    v_value jsonb;
    v_vintage jsonb;
    v_evidence text;
    v_recognized_pages jsonb;
begin
    select * into v_session
    from private.capture_sessions
    where id = p_session_id
    for update;
    if not found or v_session.initiating_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Capture is not available to this account';
    end if;
    perform private.require_household_owner(v_session.household_id);
    if v_session.state not in ('ocr_deletion_pending', 'recognized')
       or v_session.expires_at <= now()
       or not exists (
           select 1 from private.capture_ocr_results result
           where result.session_id = p_session_id
       ) then
        raise exception using errcode = '55000', message = 'Capture suggestion is not available';
    end if;
    select recognized_pages into v_recognized_pages
    from private.capture_ocr_results
    where session_id = p_session_id;
    if p_model_version is distinct from 'cloudflare-llama-3.3-70b-wine-label-v1'
       or jsonb_typeof(p_suggestion) is distinct from 'object'
       or not (p_suggestion ?& array['producer', 'cuvee', 'appellation', 'area', 'color', 'format_ml', 'vintage'])
       or p_suggestion - array['producer', 'cuvee', 'appellation', 'area', 'color', 'format_ml', 'vintage'] <> '{}'::jsonb then
        raise exception using errcode = '22023', message = 'Capture suggestion is invalid';
    end if;

    foreach v_field in array ARRAY['producer', 'cuvee', 'appellation', 'area', 'color', 'format_ml'] loop
        v_value := p_suggestion -> v_field;
        if jsonb_typeof(v_value) is distinct from 'object'
           or not (v_value ?& array['value', 'evidence', 'confidence'])
           or v_value - array['value', 'evidence', 'confidence'] <> '{}'::jsonb
           or jsonb_typeof(v_value -> 'evidence') is distinct from 'array'
           or jsonb_array_length(v_value -> 'evidence') > 4
           or jsonb_typeof(v_value -> 'confidence') is distinct from 'string'
           or v_value ->> 'confidence' not in ('high', 'medium', 'low') then
            raise exception using errcode = '22023', message = 'Capture suggestion field is invalid';
        end if;
        if exists (
            select 1 from jsonb_array_elements(v_value -> 'evidence') evidence(line)
            where jsonb_typeof(evidence.line) is distinct from 'string'
               or char_length(evidence.line #>> '{}') > 500
        ) then
            raise exception using errcode = '22023', message = 'Capture suggestion evidence is invalid';
        end if;
        for v_evidence in
            select item #>> '{}'
            from jsonb_array_elements(v_value -> 'evidence') item
        loop
            if not exists (
                select 1
                from jsonb_array_elements(v_recognized_pages) page
                cross join lateral regexp_split_to_table(coalesce(page ->> 'text', ''), E'\\r?\\n') as lines(line)
                where btrim(lines.line) = v_evidence
            ) then
                raise exception using errcode = '22023', message = 'Capture suggestion evidence is not in the saved transcript';
            end if;
        end loop;
        if (v_field = 'format_ml' and jsonb_typeof(v_value -> 'value') not in ('number', 'null'))
           or (v_field <> 'format_ml' and jsonb_typeof(v_value -> 'value') not in ('string', 'null')) then
            raise exception using errcode = '22023', message = 'Capture suggestion value is invalid';
        end if;
        if jsonb_typeof(v_value -> 'value') = 'string'
           and (char_length(v_value ->> 'value') not between 1 and 240
                or jsonb_array_length(v_value -> 'evidence') = 0) then
            raise exception using errcode = '22023', message = 'Capture suggestion value is unsupported';
        end if;
        if v_field in ('producer', 'cuvee', 'appellation', 'area')
           and jsonb_typeof(v_value -> 'value') = 'string'
           and not exists (
               select 1
               from jsonb_array_elements(v_value -> 'evidence') item
               where position(
                   btrim(regexp_replace(extensions.unaccent(lower(v_value ->> 'value')), '[^[:alnum:]]+', ' ', 'g'))
                   in btrim(regexp_replace(extensions.unaccent(lower(item #>> '{}')), '[^[:alnum:]]+', ' ', 'g'))
               ) > 0
           ) then
            raise exception using errcode = '22023', message = 'Capture suggestion value is not supported by its evidence';
        end if;
    end loop;

    if jsonb_typeof(p_suggestion #> '{color,value}') = 'string'
       and p_suggestion #>> '{color,value}' not in ('red', 'white', 'rose', 'sparkling', 'other') then
        raise exception using errcode = '22023', message = 'Capture suggestion color is invalid';
    end if;
    if jsonb_typeof(p_suggestion #> '{format_ml,value}') = 'number'
       and ((p_suggestion #>> '{format_ml,value}')::numeric not between 1 and 20000
            or (p_suggestion #>> '{format_ml,value}')::numeric <> trunc((p_suggestion #>> '{format_ml,value}')::numeric)
            or jsonb_array_length(p_suggestion #> '{format_ml,evidence}') = 0) then
        raise exception using errcode = '22023', message = 'Capture suggestion format is invalid';
    end if;
    if jsonb_typeof(p_suggestion #> '{color,value}') = 'string'
       and jsonb_array_length(p_suggestion #> '{color,evidence}') = 0 then
        raise exception using errcode = '22023', message = 'Capture suggestion color is unsupported';
    end if;

    v_vintage := p_suggestion -> 'vintage';
    if jsonb_typeof(v_vintage) is distinct from 'object'
       or not (v_vintage ?& array['value', 'status', 'evidence', 'confidence'])
       or v_vintage - array['value', 'status', 'evidence', 'confidence'] <> '{}'::jsonb
       or jsonb_typeof(v_vintage -> 'evidence') is distinct from 'array'
       or jsonb_array_length(v_vintage -> 'evidence') > 4
       or jsonb_typeof(v_vintage -> 'status') is distinct from 'string'
       or jsonb_typeof(v_vintage -> 'confidence') is distinct from 'string'
       or v_vintage ->> 'confidence' not in ('high', 'medium', 'low')
       or v_vintage ->> 'status' not in ('year', 'non_vintage', 'not_visible')
       or jsonb_typeof(v_vintage -> 'value') not in ('number', 'null') then
        raise exception using errcode = '22023', message = 'Capture suggestion vintage is invalid';
    end if;
    if exists (
        select 1 from jsonb_array_elements(v_vintage -> 'evidence') evidence(line)
        where jsonb_typeof(evidence.line) is distinct from 'string'
           or char_length(evidence.line #>> '{}') > 500
    ) then
        raise exception using errcode = '22023', message = 'Capture suggestion evidence is invalid';
    end if;
    for v_evidence in
        select item #>> '{}'
        from jsonb_array_elements(v_vintage -> 'evidence') item
    loop
        if not exists (
            select 1
            from jsonb_array_elements(v_recognized_pages) page
            cross join lateral regexp_split_to_table(coalesce(page ->> 'text', ''), E'\\r?\\n') as lines(line)
            where btrim(lines.line) = v_evidence
        ) then
            raise exception using errcode = '22023', message = 'Capture suggestion vintage evidence is not in the saved transcript';
        end if;
    end loop;
    if v_vintage ->> 'status' = 'year' then
        if jsonb_typeof(v_vintage -> 'value') is distinct from 'number'
           or (v_vintage ->> 'value')::numeric not between 1800 and 2200
           or (v_vintage ->> 'value')::numeric <> trunc((v_vintage ->> 'value')::numeric)
           or jsonb_array_length(v_vintage -> 'evidence') = 0 then
            raise exception using errcode = '22023', message = 'Capture suggestion vintage year is invalid';
        end if;
    elsif jsonb_typeof(v_vintage -> 'value') <> 'null'
       or (v_vintage ->> 'status' = 'non_vintage' and jsonb_array_length(v_vintage -> 'evidence') = 0) then
        raise exception using errcode = '22023', message = 'Capture suggestion vintage status is invalid';
    end if;

    insert into private.capture_wine_suggestions(session_id, model_version, suggestion)
    values (p_session_id, p_model_version, p_suggestion)
    on conflict (session_id) do nothing;

    select * into v_suggestion
    from private.capture_wine_suggestions
    where session_id = p_session_id;
    return jsonb_build_object(
        'model_version', v_suggestion.model_version,
        'suggestion', v_suggestion.suggestion,
        'created_at', v_suggestion.created_at
    );
end;
$$;

commit;

