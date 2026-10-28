begin;

-- Preserve the existing review policy and subject hashes while making exact
-- releases identifiable in the curator's list. Only the authenticated review
-- wrapper remains in the public API.
alter function public.get_drinking_window_reference_drafts() set schema private;
revoke all on function private.get_drinking_window_reference_drafts()
from public, anon, authenticated;

create function public.get_drinking_window_reference_drafts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_workspace jsonb;
    v_drafts jsonb := '[]'::jsonb;
    v_draft jsonb;
    v_subjects jsonb;
    v_subject jsonb;
    v_title text;
    v_format integer;
begin
    v_workspace := private.get_drinking_window_reference_drafts();
    if v_workspace ->> 'eligible' <> 'true' then
        return v_workspace;
    end if;
    for v_draft in select value from pg_catalog.jsonb_array_elements(v_workspace -> 'drafts') loop
        v_subjects := '[]'::jsonb;
        for v_subject in select value from pg_catalog.jsonb_array_elements(v_draft -> 'subjects') loop
            if v_subject ->> 'kind' = 'row' then
                select case when row.scope = 'release' then
                    producer.canonical_name || ' · ' || product.canonical_name || ' · '
                    || row.vintage_year::text || ' · ' || row.wine_color
                    || case when row.format_ml is null then '' else
                        ' · ' || row.format_ml::text || ' ml' end
                    else null end,
                    row.format_ml
                into v_title, v_format
                from public.drinking_window_reference_rows row
                left join public.wine_reference_products product on product.id = row.product_id
                left join public.wine_reference_producers producer on producer.id = row.producer_id
                where row.id = (v_subject ->> 'id')::uuid;
                if v_title is not null then
                    v_subject := pg_catalog.jsonb_set(v_subject, '{title}', to_jsonb(v_title));
                end if;
                v_subject := pg_catalog.jsonb_set(v_subject, '{details}',
                    (v_subject -> 'details') || pg_catalog.jsonb_build_object('format_ml', v_format));
            end if;
            v_subjects := v_subjects || pg_catalog.jsonb_build_array(v_subject);
        end loop;
        v_drafts := v_drafts || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_set(v_draft, '{subjects}', v_subjects));
    end loop;
    return pg_catalog.jsonb_set(v_workspace, '{drafts}', v_drafts);
end;
$$;

revoke all on function public.get_drinking_window_reference_drafts() from public, anon;
grant execute on function public.get_drinking_window_reference_drafts() to authenticated;

commit;
