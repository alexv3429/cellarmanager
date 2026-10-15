begin;

-- Accept only canonical lookup keys. In particular, a household,
-- wine, bottle, location, note, or price identifier is not valid input.
-- This remains a draft algorithm preview, not a shadow resolver or publisher.
create function public.drinking_window_preview_draft_batch(
    p_version_id uuid, p_wines jsonb
)
returns table (
    input_index integer,
    status text,
    matched_scope text,
    reference_row_id uuid,
    first_trial_year integer,
    best_start_year integer,
    best_end_year integer,
    reason text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine jsonb;
    v_index bigint;
    v_field text;
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;
    if p_wines is null or jsonb_typeof(p_wines) <> 'array'
       or jsonb_array_length(p_wines) > 250 then
        raise exception using errcode = '22023',
            message = 'Provide an array of at most 250 canonical lookup keys';
    end if;

    for v_wine, v_index in
        select item.value, item.ordinality
        from jsonb_array_elements(p_wines) with ordinality as item(value, ordinality)
    loop
        if jsonb_typeof(v_wine) <> 'object' then
            raise exception using errcode = '22023',
                message = 'Each drinking-window lookup must be an object';
        end if;
        if exists (
            select 1 from jsonb_object_keys(v_wine) as key(name)
            where key.name not in (
                'producer_id', 'product_id', 'release_id', 'appellation_id',
                'region_id', 'place_id', 'wine_color', 'vintage_year'
            )
        ) then
            raise exception using errcode = '22023',
                message = 'Only canonical drinking-window lookup fields are accepted';
        end if;
        foreach v_field in array array[
            'producer_id', 'product_id', 'release_id', 'appellation_id',
            'region_id', 'place_id', 'wine_color'
        ] loop
            if v_wine ? v_field and jsonb_typeof(v_wine -> v_field)
                not in ('string', 'null') then
                raise exception using errcode = '22023',
                    message = 'Canonical IDs and colour must be strings or null';
            end if;
        end loop;
        if v_wine ? 'vintage_year' and jsonb_typeof(v_wine -> 'vintage_year')
            not in ('number', 'null') then
            raise exception using errcode = '22023',
                message = 'Vintage must be a numeric year or null';
        end if;

        begin
            return query
            select v_index::integer, result.status, result.matched_scope,
                result.reference_row_id, result.first_trial_year,
                result.best_start_year, result.best_end_year, result.reason
            from public.drinking_window_preview_draft_match(
                p_version_id,
                (v_wine ->> 'producer_id')::uuid,
                (v_wine ->> 'product_id')::uuid,
                (v_wine ->> 'release_id')::uuid,
                (v_wine ->> 'appellation_id')::uuid,
                (v_wine ->> 'region_id')::uuid,
                v_wine ->> 'wine_color',
                (v_wine ->> 'vintage_year')::integer,
                (v_wine ->> 'place_id')::uuid
            ) as result;
        exception
            when invalid_text_representation or numeric_value_out_of_range then
                raise exception using errcode = '22023',
                    message = 'Canonical lookup contains a malformed ID or vintage';
        end;
    end loop;
end;
$$;

revoke all on function public.drinking_window_preview_draft_batch(uuid, jsonb)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_preview_draft_batch(uuid, jsonb)
to service_role;

-- A compact coverage view for a caller-owned batch. The same
-- constrained input path is used, so no household records or draft rows are
-- exposed to browser roles, and no result is persisted.
create function public.drinking_window_preview_draft_coverage(
    p_version_id uuid, p_wines jsonb
)
returns table (status text, matched_scope text, wine_count bigint)
language sql
stable
set search_path = ''
as $$
    select b.status, b.matched_scope, count(*)::bigint
    from public.drinking_window_preview_draft_batch(p_version_id, p_wines) b
    group by b.status, b.matched_scope
    order by b.status, b.matched_scope;
$$;

revoke all on function public.drinking_window_preview_draft_coverage(uuid, jsonb)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_preview_draft_coverage(uuid, jsonb)
to service_role;

commit;
