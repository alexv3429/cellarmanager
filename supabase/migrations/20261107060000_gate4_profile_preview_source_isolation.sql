begin;

-- A quarantined row may fail before its sources are assigned. Never carry
-- source URLs from a previous row into a different wine's review.
do $migration$
declare
    v_definition text;
    v_original text := $original$        v_existing := null;
        v_cuvee := null;
        select c.value into v_cuvee$original$;
    v_replacement text := $replacement$        v_existing := null;
        v_cuvee := null;
        v_urls := v_item #> '{proposal,supporting_source_urls}';
        v_allowed_urls := private.drinking_window_profile_source_urls(
            v_profile.document, v_item #> '{proposal,supporting_source_ids}');
        -- Only expose context URLs belonging to this item's declared sources.
        -- Invalid context remains subject to the existing validation below.
        if pg_catalog.jsonb_typeof(v_urls) is distinct from 'array'
           or v_allowed_urls is null then
            v_urls := null;
        elsif pg_catalog.jsonb_array_length(v_urls) not between 1 and 10
           or exists (select 1 from pg_catalog.jsonb_array_elements_text(v_urls) u
               where u.value !~ '^https://[^[:space:]]+$' or length(u.value) > 1000
                  or not (u.value = any(v_allowed_urls))) then
            v_urls := null;
        end if;
        select c.value into v_cuvee$replacement$;
    v_raw_assignment text := $original$                v_urls := v_item #> '{proposal,supporting_source_urls}';
                v_allowed_urls := private.drinking_window_profile_source_urls($original$;
    v_checked_assignment text := $replacement$                -- v_urls was already checked for this row before identity resolution.
                v_allowed_urls := private.drinking_window_profile_source_urls($replacement$;
begin
    select pg_catalog.pg_get_functiondef(
      'public.preview_drinking_window_profile_exchange(uuid,uuid,jsonb)'::regprocedure)
      into v_definition;
    if (length(v_definition) - length(replace(v_definition,v_original,''))) <> length(v_original) then
        raise exception 'Producer profile preview has changed; refusing an unsafe replacement';
    end if;
    v_definition := replace(v_definition,v_original,v_replacement);
    if (length(v_definition) - length(replace(v_definition,v_raw_assignment,''))) <> length(v_raw_assignment) then
        raise exception 'Producer profile source validation has changed; refusing an unsafe replacement';
    end if;
    execute replace(v_definition,v_raw_assignment,v_checked_assignment);
end;
$migration$;

commit;
