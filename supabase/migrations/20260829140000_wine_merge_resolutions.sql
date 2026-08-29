begin;

-- A reviewed merge may resolve catalogue wording that differs between the two
-- rows. The original two-argument RPC remains the conservative merge core;
-- this overload applies the owner's explicit field choices in the same
-- transaction and refreshes the immutable audit snapshot.
alter table public.wine_merge_events
    add column resolved_values jsonb not null default '{}'::jsonb,
    add constraint wine_merge_events_resolved_values_check
        check (jsonb_typeof(resolved_values) = 'object');

create or replace function public.merge_wines(
    p_source_wine_id uuid,
    p_target_wine_id uuid,
    p_resolved_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
    v_target_id uuid;
    v_event_id uuid;
    v_target public.wines%rowtype;
    v_producer text;
    v_cuvee text;
    v_vintage integer;
    v_color text;
    v_appellation text;
    v_area text;
    v_format_ml integer;
begin
    p_resolved_values := coalesce(p_resolved_values, '{}'::jsonb);

    if jsonb_typeof(p_resolved_values) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'Merge resolutions must be a JSON object';
    end if;

    if exists (
        select 1
        from jsonb_object_keys(p_resolved_values) as fields(key)
        where fields.key not in (
            'producer',
            'cuvee',
            'vintage',
            'color',
            'appellation',
            'area',
            'format_ml'
        )
    ) then
        raise exception using
            errcode = '22023',
            message = 'Merge resolutions contain an unsupported field';
    end if;

    if p_resolved_values ? 'producer'
       and jsonb_typeof(p_resolved_values -> 'producer') <> 'string'
    then
        raise exception using errcode = '22023', message = 'Resolved producer must be text';
    end if;

    if p_resolved_values ? 'cuvee'
       and jsonb_typeof(p_resolved_values -> 'cuvee') <> 'string'
    then
        raise exception using errcode = '22023', message = 'Resolved cuvée must be text';
    end if;

    if p_resolved_values ? 'color'
       and jsonb_typeof(p_resolved_values -> 'color') <> 'string'
    then
        raise exception using errcode = '22023', message = 'Resolved color must be text';
    end if;

    if p_resolved_values ? 'appellation'
       and jsonb_typeof(p_resolved_values -> 'appellation') not in ('string', 'null')
    then
        raise exception using errcode = '22023', message = 'Resolved appellation must be text or null';
    end if;

    if p_resolved_values ? 'area'
       and jsonb_typeof(p_resolved_values -> 'area') not in ('string', 'null')
    then
        raise exception using errcode = '22023', message = 'Resolved area must be text or null';
    end if;

    if p_resolved_values ? 'vintage'
       and jsonb_typeof(p_resolved_values -> 'vintage') not in ('number', 'null')
    then
        raise exception using errcode = '22023', message = 'Resolved vintage must be a year or null';
    end if;

    if p_resolved_values ? 'format_ml'
       and jsonb_typeof(p_resolved_values -> 'format_ml') <> 'number'
    then
        raise exception using errcode = '22023', message = 'Resolved format must be a number';
    end if;

    v_producer := case
        when p_resolved_values ? 'producer'
            then pg_catalog.regexp_replace(
                pg_catalog.btrim(p_resolved_values ->> 'producer'),
                '[[:space:]]+', ' ', 'g'
            )
        else null
    end;
    v_cuvee := case
        when p_resolved_values ? 'cuvee'
            then pg_catalog.regexp_replace(
                pg_catalog.btrim(p_resolved_values ->> 'cuvee'),
                '[[:space:]]+', ' ', 'g'
            )
        else null
    end;
    v_color := case
        when p_resolved_values ? 'color'
            then pg_catalog.lower(
                pg_catalog.regexp_replace(
                    pg_catalog.btrim(p_resolved_values ->> 'color'),
                    '[[:space:]]+', ' ', 'g'
                )
            )
        else null
    end;
    v_appellation := case
        when p_resolved_values ? 'appellation'
            then nullif(
                pg_catalog.regexp_replace(
                    pg_catalog.btrim(coalesce(p_resolved_values ->> 'appellation', '')),
                    '[[:space:]]+', ' ', 'g'
                ),
                ''
            )
        else null
    end;
    v_area := case
        when p_resolved_values ? 'area'
            then nullif(
                pg_catalog.regexp_replace(
                    pg_catalog.btrim(coalesce(p_resolved_values ->> 'area', '')),
                    '[[:space:]]+', ' ', 'g'
                ),
                ''
            )
        else null
    end;
    v_vintage := case
        when p_resolved_values ? 'vintage'
             and jsonb_typeof(p_resolved_values -> 'vintage') <> 'null'
            then (p_resolved_values ->> 'vintage')::integer
        else null
    end;
    v_format_ml := case
        when p_resolved_values ? 'format_ml'
            then (p_resolved_values ->> 'format_ml')::integer
        else null
    end;

    if (p_resolved_values ? 'producer' and coalesce(v_producer, '') = '')
       or (p_resolved_values ? 'cuvee' and coalesce(v_cuvee, '') = '')
       or (p_resolved_values ? 'color' and coalesce(v_color, '') = '')
    then
        raise exception using
            errcode = '22023',
            message = 'Resolved producer, cuvée, and color cannot be blank';
    end if;

    if p_resolved_values ? 'vintage'
       and v_vintage is not null
       and (v_vintage < 1800 or v_vintage > 2200)
    then
        raise exception using errcode = '22023', message = 'Resolved vintage is outside the supported range';
    end if;

    if p_resolved_values ? 'format_ml'
       and (v_format_ml is null or v_format_ml <= 0)
    then
        raise exception using errcode = '22023', message = 'Resolved format must be positive';
    end if;

    v_result := public.merge_wines(p_source_wine_id, p_target_wine_id);
    v_target_id := (v_result ->> 'target_wine_id')::uuid;
    v_event_id := (v_result ->> 'merge_event_id')::uuid;

    update public.wines
    set producer = case when p_resolved_values ? 'producer' then v_producer else producer end,
        cuvee = case when p_resolved_values ? 'cuvee' then v_cuvee else cuvee end,
        vintage = case when p_resolved_values ? 'vintage' then v_vintage else vintage end,
        color = case when p_resolved_values ? 'color' then v_color else color end,
        appellation = case when p_resolved_values ? 'appellation' then v_appellation else appellation end,
        area = case when p_resolved_values ? 'area' then v_area else area end,
        format_ml = case when p_resolved_values ? 'format_ml' then v_format_ml else format_ml end
    where id = v_target_id
    returning * into v_target;

    update public.wine_merge_events
    set resolved_values = p_resolved_values,
        target_snapshot_after = to_jsonb(v_target)
    where id = v_event_id;

    return v_result || jsonb_build_object('resolved_values', p_resolved_values);
end;
$$;

revoke all
on function public.merge_wines(uuid, uuid, jsonb)
from public, anon;

grant execute
on function public.merge_wines(uuid, uuid, jsonb)
to authenticated;

commit;
