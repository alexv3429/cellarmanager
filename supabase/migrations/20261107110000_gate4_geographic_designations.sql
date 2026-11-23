begin;

-- A complementary geographic denomination is not a separate AOC.  Keep the
-- existing appellation-shaped lookup identity for compatibility, but record
-- its legal parent explicitly rather than guessing parentage from text.
create table private.drinking_window_geographic_designations (
    place_id uuid primary key references public.enrichment_places(id),
    appellation_id uuid not null references public.enrichment_places(id),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    identity_reason text not null check (length(pg_catalog.btrim(identity_reason)) between 20 and 1000),
    created_at timestamptz not null default now(),
    check (place_id <> appellation_id)
);
revoke all on private.drinking_window_geographic_designations
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_geographic_designations to service_role;
create trigger drinking_window_geographic_designations_immutable
before update or delete on private.drinking_window_geographic_designations
for each row execute function private.reject_drinking_window_shadow_update();

create function public.create_drinking_window_geographic_denomination(
    p_appellation_id uuid, p_name text, p_reason text, p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_parent public.enrichment_places%rowtype;
    v_name text := pg_catalog.btrim(coalesce(p_name,''));
    v_id uuid := pg_catalog.gen_random_uuid();
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_confirmed is distinct from true or length(v_name) not between 2 and 200
       or length(pg_catalog.btrim(coalesce(p_reason,''))) not between 20 and 1000 then
        raise exception using errcode='22023', message='Confirm the denomination, parent appellation and reason';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(927412, 4);
    select * into v_parent from public.enrichment_places
    where id=p_appellation_id and place_type='appellation';
    if not found or exists (select 1 from private.drinking_window_geographic_designations
                            where place_id=p_appellation_id) then
        raise exception using errcode='22023', message='Choose an existing parent appellation';
    end if;
    if exists (select 1 from public.enrichment_places p where p.place_type='appellation'
               and p.normalized_name=private.normalize_wine_reference_text(v_name)) then
        raise exception using errcode='23505', message='This place name already exists; select it instead';
    end if;
    insert into public.enrichment_places(id,parent_id,place_type,canonical_name,country_code)
    values (v_id,v_parent.id,'appellation',v_name,v_parent.country_code);
    insert into private.drinking_window_geographic_designations(place_id,appellation_id,curator_id,identity_reason)
    values (v_id,v_parent.id,auth.uid(),pg_catalog.btrim(p_reason));
    return pg_catalog.jsonb_build_object('id',v_id,'place_type','geographic_denomination',
        'canonical_name',v_name,'parent_appellation_id',v_parent.id);
end;
$$;
revoke all on function public.create_drinking_window_geographic_denomination(uuid,text,text,boolean)
from public, anon;
grant execute on function public.create_drinking_window_geographic_denomination(uuid,text,text,boolean)
to authenticated;

-- Curators must be able to distinguish the denomination from an AOC in
-- search results even though both use the existing appellation lookup slot.
do $migration$
declare v_definition text;
    v_old text := $old$'detail', result.place_type || coalesce(' · ' || parent.canonical_name, '')$old$;
    v_new text := $new$'detail', (case when exists (
                select 1 from private.drinking_window_geographic_designations d where d.place_id=result.id
            ) then 'geographic denomination' else result.place_type end)
            || coalesce(' · ' || parent.canonical_name, '')$new$;
begin
    select pg_catalog.pg_get_functiondef('public.search_drinking_window_curation_targets(text,text)'::regprocedure)
      into v_definition;
    if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
        raise exception 'Curator place search changed';
    end if;
    execute replace(v_definition,v_old,v_new);
end;
$migration$;

create function private.drinking_window_appellation_applies(p_reference uuid,p_wine uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_reference=p_wine or exists (
        select 1 from private.drinking_window_geographic_designations d
        join public.enrichment_places child on child.id=d.place_id
        where d.place_id=p_wine and d.appellation_id=p_reference
          and child.parent_id=d.appellation_id
    );
$$;
revoke all on function private.drinking_window_appellation_applies(uuid,uuid)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_appellation_applies(uuid,uuid) to postgres;

-- Both the active-wine reader and parameter-based preview use the same
-- specificity rule: exact denomination, then its reviewed parent AOC.
do $migration$
declare
    v_signature text;
    v_definition text;
    v_old text;
    v_new text;
begin
    foreach v_signature in array array[
      'private.drinking_window_preview_draft_match_for_wine(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid)',
      'public.drinking_window_preview_draft_match(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid,integer)'
    ] loop
      select pg_catalog.pg_get_functiondef(v_signature::regprocedure) into v_definition;
      v_old := $old$(r.scope = 'release'
                  and r.release_id = p_release_id
                  and r.product_id = p_product_id
                  and r.producer_id = p_producer_id
                  and r.appellation_id = p_appellation_id)$old$;
      v_new := $new$(r.scope = 'release'
                  and r.release_id = p_release_id
                  and r.product_id = p_product_id
                  and r.producer_id = p_producer_id
                  and private.drinking_window_appellation_applies(r.appellation_id,p_appellation_id))$new$;
      if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
        raise exception 'Exact release selector changed: %',v_signature;
      end if;
      v_definition := replace(v_definition,v_old,v_new);
      v_old := $old$(r.scope = 'producer_appellation'
                  and r.producer_id = p_producer_id
                  and r.appellation_id = p_appellation_id)$old$;
      v_new := $new$(r.scope = 'producer_appellation'
                  and r.producer_id = p_producer_id
                  and private.drinking_window_appellation_applies(r.appellation_id,p_appellation_id))$new$;
      if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
        raise exception 'Producer appellation selector changed: %',v_signature;
      end if;
      v_definition := replace(v_definition,v_old,v_new);
      if v_signature like 'private.%' then
        v_old := $old$and (r.appellation_id = p_appellation_id
                    or (r.ageing_group_id$old$;
        v_new := $new$and (private.drinking_window_appellation_applies(r.appellation_id,p_appellation_id)
                    or (r.ageing_group_id$new$;
      else
        v_old := $old$and r.appellation_id = p_appellation_id)
              or r.scope = 'region'$old$;
        v_new := $new$and private.drinking_window_appellation_applies(r.appellation_id,p_appellation_id))
              or r.scope = 'region'$new$;
      end if;
      if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
        raise exception 'Appellation selector changed: %',v_signature;
      end if;
      v_definition := replace(v_definition,v_old,v_new);
      v_old := $old$else 5 end as priority,$old$;
      v_new := $new$else 5 end as priority,
            case when r.scope in ('appellation','producer_appellation')
                      and r.appellation_id=p_appellation_id then 1 else 0 end as appellation_specificity,$new$;
      if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
        raise exception 'Candidate priority changed: %',v_signature;
      end if;
      v_definition := replace(v_definition,v_old,v_new);
      v_definition := replace(v_definition,
        'partition by c.priority, (c.format_ml is null)',
        'partition by c.priority, (c.format_ml is null), c.appellation_specificity');
      v_old := 'order by r.priority, (r.format_ml is null), r.comparable_specificity desc, r.id';
      v_new := 'order by r.priority, (r.format_ml is null), r.appellation_specificity desc, r.comparable_specificity desc, r.id';
      if (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
        raise exception 'Candidate ordering changed: %',v_signature;
      end if;
      v_definition := replace(v_definition,v_old,v_new);
      execute v_definition;
    end loop;
end;
$migration$;

-- A reviewed exact release identified at its parent AOC remains the same
-- release when the wine carries a more precise, confirmed denomination.
create or replace function private.drinking_window_unique_reviewed_release(
    p_wine public.wines, p_producer_id uuid, p_region_id uuid,
    p_appellation_id uuid, p_color text
) returns table (product_id uuid, release_id uuid)
language sql stable set search_path = '' as $$
    select min(anchor.product_id::text)::uuid, min(anchor.release_id::text)::uuid
    from private.drinking_window_reviewed_release_anchors anchor
    where anchor.producer_id = p_producer_id
      and private.drinking_window_appellation_applies(anchor.appellation_id,p_appellation_id)
      and private.drinking_window_place_contains(p_region_id, anchor.region_id)
      and anchor.wine_color = p_color
      and anchor.vintage_year = p_wine.vintage
      and anchor.format_ml = p_wine.format_ml
      and private.normalize_wine_reference_text(p_wine.cuvee) = any(anchor.name_keys)
      and not exists (
          select 1 from private.drinking_window_reviewed_release_anchors conflicting
          where conflicting.release_id = anchor.release_id
            and ((not private.drinking_window_appellation_applies(conflicting.appellation_id,anchor.appellation_id)
                  and not private.drinking_window_appellation_applies(anchor.appellation_id,conflicting.appellation_id))
                 or conflicting.wine_color <> anchor.wine_color)
      )
    having count(distinct anchor.release_id) = 1;
$$;
commit;
