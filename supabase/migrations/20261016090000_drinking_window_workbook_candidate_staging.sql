begin;

-- Preserve why an incomplete source row was quarantined. These records are
-- service-private proposals, not reference rows or household advice.
alter table public.drinking_window_candidates
    add column review_reason text;

create function public.drinking_window_stage_workbook_candidates(p_rows jsonb)
returns table (inserted_count integer, unchanged_count integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
    v_row jsonb;
    v_identity jsonb;
    v_cells jsonb;
    v_cell text;
    v_batch_hash text;
    v_scope text;
    v_status text;
    v_reason text;
    v_vintage integer;
    v_start integer;
    v_end integer;
    v_inserted_id uuid;
    v_existing public.drinking_window_candidates%rowtype;
    v_expected jsonb;
begin
    if p_rows is null or jsonb_typeof(p_rows) <> 'array'
       or jsonb_array_length(p_rows) not between 1 and 250 then
        raise exception using errcode = '22023',
            message = 'Provide 1 to 250 workbook candidates';
    end if;

    inserted_count := 0;
    unchanged_count := 0;
    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        if jsonb_typeof(v_row) <> 'object' or exists (
            select 1 from jsonb_object_keys(v_row) as key(name)
            where key.name not in (
                'source_sha256', 'source_locator', 'candidate_scope',
                'source_identity', 'wine_color', 'vintage_year',
                'first_trial_year', 'best_start_year', 'best_end_year',
                'review_status', 'review_reason'
            )
        ) then
            raise exception using errcode = '22023',
                message = 'Only workbook candidate fields are accepted';
        end if;
        if v_row ->> 'source_sha256' is null
           or v_row ->> 'source_sha256' !~ '^[0-9a-f]{64}$'
           or v_row ->> 'source_locator' is null
           or v_row ->> 'source_locator' !~
              '^(Barraud|Barthod|Boillot|Bouzereau|Cal Demoura|Carillon|Castagnier|Chagnoleau|Clavelier|Langoureau|Montcalmes|Pernot|Millesimes)![A-O][0-9]+:[A-O][0-9]+$'
           or length(v_row ->> 'source_locator') > 100 then
            raise exception using errcode = '22023',
                message = 'Candidate source hash or reference-sheet locator is invalid';
        end if;
        if v_batch_hash is null then
            v_batch_hash := v_row ->> 'source_sha256';
        elsif v_batch_hash <> v_row ->> 'source_sha256' then
            raise exception using errcode = '22023',
                message = 'One batch must come from one workbook hash';
        end if;

        v_identity := v_row -> 'source_identity';
        v_cells := v_identity -> 'source_cells';
        if jsonb_typeof(v_identity) is distinct from 'object'
           or length(v_identity::text) > 8000
           or exists (
               select 1 from jsonb_object_keys(v_identity) as key(name)
               where key.name not in (
                   'producer', 'cuvee', 'appellation', 'region', 'color',
                   'historical_bin', 'source_cells',
                   'unpaired_start_year', 'unpaired_end_year'
               )
           )
           or jsonb_typeof(v_cells) is distinct from 'object'
           or exists (
               select 1 from jsonb_object_keys(v_cells) as key(name)
               where key.name not in (
                   'vintage', 'cuvee', 'appellation', 'color', 'region',
                   'best_start', 'best_end', 'unpaired_start', 'unpaired_end',
                   'best_start_offset', 'best_end_offset', 'offsets'
               )
           ) then
            raise exception using errcode = '22023',
                message = 'Only reference-sheet identity and source cells are accepted';
        end if;
        for v_cell in select value from jsonb_each_text(v_cells)
        loop
            if v_cell is null or v_cell !~
               '^(Barraud|Barthod|Boillot|Bouzereau|Cal Demoura|Carillon|Castagnier|Chagnoleau|Clavelier|Langoureau|Montcalmes|Pernot|Millesimes)![A-O][0-9]+(:[A-O][0-9]+)?$' then
                raise exception using errcode = '22023',
                    message = 'Candidate source cells must belong to reference sheets';
            end if;
        end loop;
        if exists (
            select 1 from jsonb_each(v_identity) as field(name, value)
            where field.name in ('producer', 'cuvee', 'appellation', 'region', 'color', 'historical_bin')
              and (jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 200)
        ) then
            raise exception using errcode = '22023',
                message = 'Candidate identity labels must be short text';
        end if;
        if v_identity ? 'historical_bin' and v_identity ->> 'historical_bin'
           not in ('standard', 'premium') then
            raise exception using errcode = '22023',
                message = 'Unknown historical ageing bin';
        end if;
        if not v_row ? 'first_trial_year'
           or v_row -> 'first_trial_year' is distinct from 'null'::jsonb then
            raise exception using errcode = '22023',
                message = 'Workbook candidates do not supply a first-trial year';
        end if;

        begin
            v_vintage := (v_row ->> 'vintage_year')::integer;
            v_start := (v_row ->> 'best_start_year')::integer;
            v_end := (v_row ->> 'best_end_year')::integer;
        exception when invalid_text_representation or numeric_value_out_of_range then
            raise exception using errcode = '22023',
                message = 'Candidate years must be integer years or null';
        end;
        v_scope := v_row ->> 'candidate_scope';
        v_status := v_row ->> 'review_status';
        v_reason := v_row ->> 'review_reason';
        if v_scope is null
           or v_scope not in ('release', 'producer_appellation', 'producer_region', 'region', 'quarantine')
           or v_status is null
           or v_status not in ('staged', 'needs-review')
           or (v_row ->> 'wine_color') is not null
               and (v_row ->> 'wine_color') not in ('red', 'white', 'rose')
           or (v_vintage is not null and v_vintage not between 1800 and 2200)
           or (v_start is not null and v_start not between 1800 and 2300)
           or (v_end is not null and v_end not between 1800 and 2300)
           or (v_start is not null and v_end is not null and v_start > v_end)
           or (v_vintage is not null and v_start is not null and v_start < v_vintage)
           or (v_status = 'staged' and (
               v_scope = 'quarantine' or v_reason is not null
               or v_vintage is null or v_start is null or v_end is null
               or v_row ->> 'wine_color' is null
           ))
           or (v_status = 'needs-review' and (
               v_scope <> 'quarantine' or v_reason is null or v_reason not in (
                   'incomplete_pair', 'invalid_identity_or_years',
                   'producer_only_scope_not_reviewed',
                   'invalid_region_or_offsets', 'no_pair'
               )
           )) then
            raise exception using errcode = '22023',
                message = 'Candidate status, scope, colour, or year pair is invalid';
        end if;

        insert into public.drinking_window_candidates (
            source_sha256, source_locator, candidate_scope, source_identity,
            wine_color, vintage_year, first_trial_year, best_start_year,
            best_end_year, review_status, review_reason
        ) values (
            v_batch_hash, v_row ->> 'source_locator', v_scope, v_identity,
            v_row ->> 'wine_color', v_vintage, null, v_start, v_end,
            v_status, v_reason
        ) on conflict (source_sha256, source_locator) do nothing
        returning id into v_inserted_id;

        if v_inserted_id is not null then
            inserted_count := inserted_count + 1;
        else
            select * into v_existing
            from public.drinking_window_candidates c
            where c.source_sha256 = v_batch_hash
              and c.source_locator = v_row ->> 'source_locator';
            v_expected := jsonb_build_object(
                'source_sha256', v_batch_hash,
                'source_locator', v_row ->> 'source_locator',
                'candidate_scope', v_scope,
                'source_identity', v_identity,
                'wine_color', v_row ->> 'wine_color',
                'vintage_year', v_vintage,
                'first_trial_year', null,
                'best_start_year', v_start,
                'best_end_year', v_end,
                'review_status', v_status,
                'review_reason', v_reason
            );
            if v_existing.id is null or
               (to_jsonb(v_existing) - 'id' - 'created_at') <> v_expected then
                raise exception using errcode = '23505',
                    message = 'Existing candidate differs; review it instead of overwriting';
            end if;
            unchanged_count := unchanged_count + 1;
        end if;
    end loop;
    return next;
end;
$$;

revoke all on function public.drinking_window_stage_workbook_candidates(jsonb)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_stage_workbook_candidates(jsonb)
to service_role;

commit;
