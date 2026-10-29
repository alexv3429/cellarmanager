begin;

-- Cellar-only choices are deliberately separate from immutable shared rows.
-- An owner must choose a vintage and an explicit product, appellation or
-- region scope from a wine already linked to a canonical product/release.
create table private.household_producer_window_rules (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households(id) on delete cascade,
    scope text not null check (scope in ('product', 'producer_appellation', 'producer_region')),
    producer_id uuid not null references public.wine_reference_producers(id),
    product_id uuid references public.wine_reference_products(id),
    appellation_id uuid references public.enrichment_places(id),
    region_id uuid not null references public.enrichment_places(id),
    wine_color text not null check (wine_color in
        ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')),
    vintage_year integer not null check (vintage_year between 1800 and 2200),
    first_trial_year integer not null,
    best_start_year integer not null,
    best_end_year integer not null,
    note text not null check (length(trim(note)) between 1 and 1000),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint household_producer_window_rules_identity_check check (
        (scope = 'product' and product_id is not null)
        or (scope = 'producer_appellation' and product_id is null
            and appellation_id is not null)
        or (scope = 'producer_region' and product_id is null
            and appellation_id is null)
    ),
    constraint household_producer_window_rules_years_check check (
        vintage_year <= first_trial_year and first_trial_year <= best_start_year
        and best_start_year <= best_end_year and best_end_year <= 2300
    ),
    constraint household_producer_window_rules_unique unique nulls not distinct
        (household_id, scope, producer_id, product_id, appellation_id,
         region_id, wine_color, vintage_year)
);
create index household_producer_window_rules_lookup_idx
    on private.household_producer_window_rules
        (household_id, region_id, wine_color, vintage_year, producer_id);
revoke all on private.household_producer_window_rules
    from public, anon, authenticated, powersync_role;
grant select, insert, update, delete on private.household_producer_window_rules
    to service_role;

-- Never create a producer rule from fuzzy wine text. The linked identity and
-- place must be unambiguous, correctly nested, and match the wine's vintage.
create function private.drinking_window_producer_rule_identity(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_color text;
begin
    select * into v_wine from public.wines w
    where w.id = p_wine_id and w.merged_into_wine_id is null;
    if not found then
        return jsonb_build_object('status', 'wine_not_found');
    end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null
       or v_wine.wine_reference_id is null then
        return jsonb_build_object('status', 'canonical_identity_required');
    end if;
    select array_agg(distinct p.id) into v_region_ids from (
        select place.id from public.enrichment_places place
        where place.place_type in ('region', 'subregion')
          and place.normalized_name = private.normalize_wine_reference_text(v_wine.area)
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type in ('region', 'subregion')
          and alias.normalized_value = private.normalize_wine_reference_text(v_wine.area)
    ) p;
    if coalesce(cardinality(v_region_ids), 0) <> 1 then
        return jsonb_build_object('status', 'region_not_confirmed');
    end if;
    v_region_id := v_region_ids[1];
    if v_wine.appellation is not null and trim(v_wine.appellation) <> '' then
        select array_agg(distinct p.id) into v_appellation_ids from (
            select place.id from public.enrichment_places place
            where place.place_type = 'appellation'
              and place.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
            union
            select place.id from public.enrichment_place_aliases alias
            join public.enrichment_places place on place.id = alias.place_id
            where place.place_type = 'appellation'
              and alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
        ) p;
        if coalesce(cardinality(v_appellation_ids), 0) <> 1 then
            return jsonb_build_object('status', 'appellation_not_confirmed');
        end if;
        v_appellation_id := v_appellation_ids[1];
        if not private.drinking_window_place_contains(v_region_id, v_appellation_id) then
            return jsonb_build_object('status', 'appellation_outside_region');
        end if;
    end if;
    if v_wine.wine_reference_type = 'release' then
        select product.id, product.producer_id into v_product_id, v_producer_id
        from public.wine_reference_releases release
        join public.wine_reference_products product on product.id = release.product_id
        where release.id = v_wine.wine_reference_id
          and release.vintage_year = v_wine.vintage;
    elsif v_wine.wine_reference_type = 'product' then
        select product.id, product.producer_id into v_product_id, v_producer_id
        from public.wine_reference_products product
        where product.id = v_wine.wine_reference_id;
    end if;
    if v_producer_id is null then
        return jsonb_build_object('status', 'canonical_identity_required');
    end if;
    return jsonb_build_object(
        'status', 'ok', 'household_id', v_wine.household_id,
        'producer_id', v_producer_id, 'product_id', v_product_id,
        'appellation_id', v_appellation_id, 'region_id', v_region_id,
        'wine_color', v_color, 'vintage_year', v_wine.vintage,
        'producer_name', (select canonical_name from public.wine_reference_producers
            where id = v_producer_id),
        'product_name', (select canonical_name from public.wine_reference_products
            where id = v_product_id),
        'appellation_name', (select canonical_name from public.enrichment_places
            where id = v_appellation_id),
        'region_name', (select canonical_name from public.enrichment_places
            where id = v_region_id)
    );
end;
$$;
revoke all on function private.drinking_window_producer_rule_identity(uuid)
    from public, anon, authenticated, powersync_role, service_role;

create function private.drinking_window_producer_rules_for_wine(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_identity jsonb := private.drinking_window_producer_rule_identity(p_wine_id);
    v_rules jsonb;
begin
    if v_identity ->> 'status' <> 'ok' then
        return jsonb_build_object('status', v_identity ->> 'status',
            'context', v_identity, 'applicable', '[]'::jsonb, 'selected', null);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', rule.id, 'scope', rule.scope,
        'first_trial_year', rule.first_trial_year,
        'best_start_year', rule.best_start_year,
        'best_end_year', rule.best_end_year,
        'note', rule.note, 'updated_at', rule.updated_at
    ) order by case rule.scope when 'product' then 1
        when 'producer_appellation' then 2 else 3 end), '[]'::jsonb)
    into v_rules
    from private.household_producer_window_rules rule
    where rule.household_id = (v_identity ->> 'household_id')::uuid
      and rule.producer_id = (v_identity ->> 'producer_id')::uuid
      and rule.region_id = (v_identity ->> 'region_id')::uuid
      and rule.wine_color = v_identity ->> 'wine_color'
      and rule.vintage_year = (v_identity ->> 'vintage_year')::integer
      and (
        (rule.scope = 'product'
          and rule.product_id = (v_identity ->> 'product_id')::uuid
          and rule.appellation_id is not distinct from
              (v_identity ->> 'appellation_id')::uuid)
        or (rule.scope = 'producer_appellation'
          and rule.appellation_id = (v_identity ->> 'appellation_id')::uuid)
        or rule.scope = 'producer_region'
      );
    return jsonb_build_object('status', 'ok', 'context', v_identity,
        'applicable', v_rules, 'selected', v_rules -> 0);
end;
$$;
revoke all on function private.drinking_window_producer_rules_for_wine(uuid)
    from public, anon, authenticated, powersync_role, service_role;

create function public.set_household_producer_window_rule(
    p_wine_id uuid, p_scope text, p_first_trial_year integer,
    p_best_start_year integer, p_best_end_year integer, p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_household_id uuid;
    v_identity jsonb;
    v_rule_id uuid;
begin
    v_household_id := private.require_wine_owner(p_wine_id);
    v_identity := private.drinking_window_producer_rule_identity(p_wine_id);
    if v_identity ->> 'status' <> 'ok' then
        raise exception using errcode = '22023',
            message = 'Confirm this wine’s canonical identity and place before setting a producer rule';
    end if;
    if p_scope not in ('product', 'producer_appellation', 'producer_region')
       or (p_scope in ('product', 'producer_appellation')
           and v_identity ->> 'appellation_id' is null) then
        raise exception using errcode = '22023',
            message = 'Choose a valid producer rule scope for this wine';
    end if;
    if p_first_trial_year is null or p_best_start_year is null
       or p_best_end_year is null or p_first_trial_year <
           (v_identity ->> 'vintage_year')::integer
       or p_first_trial_year > p_best_start_year
       or p_best_start_year > p_best_end_year or p_best_end_year > 2300
       or length(trim(coalesce(p_note, ''))) not between 1 and 1000 then
        raise exception using errcode = '22023',
            message = 'Enter three ordered years and a short reason';
    end if;
    insert into private.household_producer_window_rules (
        household_id, scope, producer_id, product_id, appellation_id,
        region_id, wine_color, vintage_year, first_trial_year,
        best_start_year, best_end_year, note, created_by
    ) values (
        v_household_id, p_scope, (v_identity ->> 'producer_id')::uuid,
        case when p_scope = 'product' then (v_identity ->> 'product_id')::uuid end,
        case when p_scope <> 'producer_region' then
            (v_identity ->> 'appellation_id')::uuid end,
        (v_identity ->> 'region_id')::uuid,
        v_identity ->> 'wine_color', (v_identity ->> 'vintage_year')::integer,
        p_first_trial_year, p_best_start_year, p_best_end_year, trim(p_note), auth.uid()
    ) on conflict on constraint household_producer_window_rules_unique
    do update set first_trial_year = excluded.first_trial_year,
        best_start_year = excluded.best_start_year,
        best_end_year = excluded.best_end_year, note = excluded.note,
        updated_at = now()
    returning id into v_rule_id;
    return jsonb_build_object('rule_id', v_rule_id, 'status', 'saved');
end;
$$;
revoke all on function public.set_household_producer_window_rule(
    uuid, text, integer, integer, integer, text)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function public.set_household_producer_window_rule(
    uuid, text, integer, integer, integer, text) to authenticated, service_role;

create function public.clear_household_producer_window_rule(p_rule_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    v_household_id uuid;
begin
    select household_id into v_household_id
    from private.household_producer_window_rules where id = p_rule_id;
    if not found then
        raise exception using errcode = '22023', message = 'Producer rule not found';
    end if;
    perform private.require_household_owner(v_household_id);
    delete from private.household_producer_window_rules where id = p_rule_id;
    return true;
end;
$$;
revoke all on function public.clear_household_producer_window_rule(uuid)
    from public, anon, authenticated, powersync_role, service_role;
grant execute on function public.clear_household_producer_window_rule(uuid)
    to authenticated, service_role;

-- Keep the selected shared record intact and expose the personal adjustment
-- separately. No offset is applied to explicit cellar dates.
create or replace function public.get_wine_maturity(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_result jsonb;
    v_match jsonb;
    v_rules jsonb;
    v_rule jsonb;
    v_shift integer;
begin
    v_result := public.get_wine_maturity_before_references(p_wine_id);
    v_match := private.drinking_window_active_match(p_wine_id);
    v_rules := private.drinking_window_producer_rules_for_wine(p_wine_id);
    v_rule := v_rules -> 'selected';
    v_shift := coalesce((v_result #>> '{calibration,year_shift}')::integer, 0);
    v_result := v_result || jsonb_build_object('producer_rules', v_rules);
    if v_match ->> 'status' = 'match' then
        v_match := v_match || jsonb_build_object(
            'personal_year_shift', v_shift,
            'effective_first_trial_year', (v_match ->> 'first_trial_year')::integer + v_shift,
            'effective_best_start_year', (v_match ->> 'best_start_year')::integer + v_shift,
            'effective_best_end_year', (v_match ->> 'best_end_year')::integer + v_shift
        );
        v_result := v_result || jsonb_build_object('reference', v_match);
    elsif v_match ->> 'status' in ('identity_conflict', 'ambiguous') then
        v_result := v_result || jsonb_build_object('reference_status', v_match);
    end if;
    if v_result -> 'override' <> 'null'::jsonb then
        v_result := v_result || jsonb_build_object('effective_source', 'manual');
    elsif v_rule is not null and v_rule <> 'null'::jsonb then
        v_result := v_result || jsonb_build_object('effective_source', 'cellar_producer');
    elsif v_match ->> 'status' = 'match' then
        v_result := v_result || jsonb_build_object('effective_source', 'reviewed_reference');
    elsif v_match ->> 'status' in ('identity_conflict', 'ambiguous') then
        v_result := v_result || jsonb_build_object('effective_source', 'unavailable');
    else
        v_result := v_result || jsonb_build_object('effective_source',
            case when v_result -> 'projection' <> 'null'::jsonb
                then 'model_estimate' else 'unavailable' end);
    end if;
    if v_result -> 'calibration' <> 'null'::jsonb then
        v_result := jsonb_set(v_result, '{calibration,active}',
            to_jsonb(v_shift <> 0 and v_result ->> 'effective_source'
                in ('reviewed_reference', 'model_estimate')));
    end if;
    return v_result;
end;
$$;
revoke all on function public.get_wine_maturity(uuid)
    from public, anon, authenticated, powersync_role;
grant execute on function public.get_wine_maturity(uuid) to authenticated, service_role;

create or replace function public.get_household_maturity_overview(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_rows jsonb;
    v_row jsonb;
    v_result jsonb := '[]'::jsonb;
    v_match jsonb;
    v_rules jsonb;
    v_rule jsonb;
    v_state text;
    v_year integer := extract(year from current_date)::integer;
    v_first integer;
    v_start integer;
    v_end integer;
    v_shift integer;
    v_source text;
begin
    v_rows := public.get_household_maturity_overview_before_references(p_household_id);
    for v_row in select value from jsonb_array_elements(v_rows) loop
        if v_row ->> 'is_override' = 'true' then
            v_result := v_result || jsonb_build_array(
                v_row || jsonb_build_object('effective_source', 'manual'));
            continue;
        end if;
        v_match := private.drinking_window_active_match((v_row ->> 'wine_id')::uuid);
        v_rules := private.drinking_window_producer_rules_for_wine((v_row ->> 'wine_id')::uuid);
        v_rule := v_rules -> 'selected';
        v_shift := coalesce((v_row ->> 'personal_year_shift')::integer, 0);
        if v_rule is not null and v_rule <> 'null'::jsonb then
            v_source := 'cellar_producer';
            v_first := (v_rule ->> 'first_trial_year')::integer;
            v_start := (v_rule ->> 'best_start_year')::integer;
            v_end := (v_rule ->> 'best_end_year')::integer;
        elsif v_match ->> 'status' = 'match' then
            v_source := 'reviewed_reference';
            v_first := (v_match ->> 'first_trial_year')::integer + v_shift;
            v_start := (v_match ->> 'best_start_year')::integer + v_shift;
            v_end := (v_match ->> 'best_end_year')::integer + v_shift;
        elsif v_match ->> 'status' in ('identity_conflict', 'ambiguous') then
            v_result := v_result || jsonb_build_array(v_row || jsonb_build_object(
                'effective_source', 'unavailable',
                'first_trial_year', null, 'best_start_year', null,
                'best_end_year', null, 'drink_by_year', null,
                'state', null, 'state_label', null, 'urgency', null,
                'urgency_score', 0, 'headline', null,
                'confidence', null, 'confidence_label', null,
                'profile_warnings', jsonb_build_array(v_match ->> 'reason')));
            continue;
        else
            v_result := v_result || jsonb_build_array(v_row ||
                jsonb_build_object('effective_source',
                    case when v_row -> 'projection_id' <> 'null'::jsonb
                        then 'model_estimate' else 'unavailable' end));
            continue;
        end if;
        v_state := private.maturity_state_from_window(
            v_year, v_first, v_start, v_end, null);
        v_row := v_row || jsonb_build_object(
            'effective_source', v_source,
            'reference_row_id', case when v_source = 'reviewed_reference'
                then v_match ->> 'reference_row_id' end,
            'reference_version_number', case when v_source = 'reviewed_reference'
                then (v_match ->> 'version_number')::integer end,
            'producer_rule_id', case when v_source = 'cellar_producer'
                then v_rule ->> 'id' end,
            'is_personalized', v_source = 'reviewed_reference' and v_shift <> 0,
            'first_trial_year', v_first, 'best_start_year', v_start,
            'best_end_year', v_end, 'drink_by_year', null,
            'state', v_state, 'state_label', private.maturity_state_label(v_state),
            'urgency', private.maturity_urgency(v_state),
            'urgency_score', private.maturity_urgency_score(v_state),
            'headline', case when v_source = 'reviewed_reference'
                then 'Reviewed reference window' else 'Cellar producer rule' end,
            'confidence', 1, 'confidence_label',
                case when v_source = 'reviewed_reference'
                    then 'reviewed reference' else 'cellar preference' end,
            'specificity', case when v_source = 'reviewed_reference'
                then v_match ->> 'matched_scope' else v_rule ->> 'scope' end,
            'profile_layers', jsonb_build_array(
                case when v_source = 'reviewed_reference'
                    then v_match ->> 'matched_scope' else v_rule ->> 'scope' end),
            'profile_warnings', '[]'::jsonb);
        v_result := v_result || jsonb_build_array(v_row);
    end loop;
    return v_result;
end;
$$;
revoke all on function public.get_household_maturity_overview(uuid)
    from public, anon, authenticated, powersync_role;
grant execute on function public.get_household_maturity_overview(uuid)
    to authenticated, service_role;

commit;
