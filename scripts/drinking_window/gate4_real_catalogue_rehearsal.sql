-- Run only on an isolated restored catalogue clone. Every inserted row is
-- synthetic and rolled back. This tests scope selection, not date approval.
begin;
do $gate4$
declare
    v_version uuid := gen_random_uuid();
    v_py public.drinking_window_reference_rows%rowtype;
    v_region uuid;
    v_morgon uuid;
    v_exact_wine uuid;
    v_app_wine uuid;
    v_region_wine uuid;
    v_region_vintage integer;
    v_context jsonb;
    v_match record;
begin
    select r.* into strict v_py from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where v.version_number = 2 and r.scope = 'release' and r.vintage_year = 2022
      and r.format_ml = 750 and r.first_trial_year = 2025
      and r.best_start_year = 2028 and r.best_end_year = 2040;
    v_region := v_py.region_id;
    v_morgon := v_py.appellation_id;
    select id into v_exact_wine from public.wines
    where merged_into_wine_id is null and wine_reference_type = 'release'
      and wine_reference_id = v_py.release_id and vintage = 2022
      and format_ml = 750 order by id limit 1;
    select id into v_app_wine from public.wines
    where merged_into_wine_id is null and area = 'Beaujolais'
      and appellation = 'Morgon' and vintage = 2022 and color = 'red'
      and id <> v_exact_wine order by id limit 1;
    select id, vintage into v_region_wine, v_region_vintage from public.wines
    where merged_into_wine_id is null and area = 'Beaujolais'
      and vintage is not null and vintage <> 2022 and color = 'red'
      order by vintage desc, id limit 1;
    if v_exact_wine is null or v_app_wine is null or v_region_wine is null then
        raise exception 'The restored catalogue lacks one of the three scope fixtures';
    end if;

    insert into public.drinking_window_reference_versions (id, version_number)
    values (v_version, (select max(version_number) + 1
        from public.drinking_window_reference_versions));
    insert into public.drinking_window_reference_rows (
        version_id, scope, producer_id, product_id, release_id,
        appellation_id, region_id, wine_color, vintage_year, format_ml,
        all_at_scope, first_trial_year, best_start_year, best_end_year, rationale
    ) values
      (v_version, 'release', v_py.producer_id, v_py.product_id, v_py.release_id,
       v_morgon, v_region, 'red', 2022, 750, true,
       2025, 2028, 2040, 'Synthetic exact-scope rehearsal, not publishable advice.'),
      (v_version, 'appellation', null, null, null,
       v_morgon, v_region, 'red', 2022, null, true,
       2024, 2027, 2032, 'Synthetic all-at-scope appellation rehearsal only.'),
      (v_version, 'region', null, null, null,
       null, v_region, 'red', v_region_vintage, null, true,
       v_region_vintage + 2, v_region_vintage + 4,
       v_region_vintage + 9,
       'Synthetic all-at-scope region rehearsal only.');

    v_context := private.drinking_window_wine_context(v_exact_wine);
    if v_context ->> 'status' <> 'ready' then
        raise exception 'Real exact-release fixture has no ready canonical context';
    end if;
    select * into v_match from private.drinking_window_preview_draft_match_for_wine(
        v_exact_wine, v_version, (v_context ->> 'producer_id')::uuid,
        (v_context ->> 'product_id')::uuid, (v_context ->> 'release_id')::uuid,
        v_morgon, v_region, 'red', 2022, null);
    if v_match.status <> 'draft_match' or v_match.matched_scope <> 'release'
       or (v_match.first_trial_year, v_match.best_start_year,
           v_match.best_end_year) <> (2025, 2028, 2040) then
        raise exception 'Exact real-catalogue fixture selected the wrong scope';
    end if;
    select * into v_match from private.drinking_window_preview_draft_match_for_wine(
        v_app_wine, v_version, null, null, null, v_morgon, v_region,
        'red', 2022, null);
    if v_match.status <> 'draft_match' or v_match.matched_scope <> 'appellation'
       or (v_match.first_trial_year, v_match.best_start_year,
           v_match.best_end_year) <> (2024, 2027, 2032) then
        raise exception 'Appellation real-catalogue fixture selected the wrong scope';
    end if;
    select * into v_match from private.drinking_window_preview_draft_match_for_wine(
        v_region_wine, v_version, null, null, null, null, v_region,
        'red', v_region_vintage, null);
    if v_match.status <> 'draft_match' or v_match.matched_scope <> 'region'
       or (v_match.first_trial_year, v_match.best_start_year,
           v_match.best_end_year) <> (v_region_vintage + 2,
           v_region_vintage + 4, v_region_vintage + 9) then
        raise exception 'Region real-catalogue fixture selected the wrong scope';
    end if;
    raise notice 'Gate 4 restored-catalogue exact, appellation and region fixtures passed; all rows roll back';
end;
$gate4$;
rollback;
