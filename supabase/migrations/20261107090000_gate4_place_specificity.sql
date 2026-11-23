begin;

-- Within one appellation, a reviewed climat is more precise than membership
-- of the whole appellation. This is a geographic ordering, not an automatic
-- assignment of wines to groups: the climat must already be an eligible
-- match. Equal or unrelated matches must remain ambiguous.
create function private.drinking_window_place_depth(p_id uuid)
returns integer language sql stable set search_path = '' as $$
    with recursive chain(id,parent_id) as (
        select id,parent_id from public.enrichment_places where id=p_id
        union
        select p.id,p.parent_id from chain c
        join public.enrichment_places p on p.id=c.parent_id
    ) select count(*)::integer from chain;
$$;
revoke all on function private.drinking_window_place_depth(uuid)
from public, anon, authenticated, powersync_role, service_role;

do $migration$
declare
    v_definition text;
    v_before text := $before$                when 'appellation' then 4
                else 5 end as priority
        from public.drinking_window_reference_rows r$before$;
    v_after text := $after$                when 'appellation' then 4
                else 5 end as priority,
            coalesce((
              select max(private.drinking_window_place_depth(m.member_place_id))
              from public.drinking_window_ageing_group_memberships m
              where m.version_id=r.version_id and m.group_id=r.ageing_group_id
                and m.member_kind='place'
                and (m.first_vintage_year is null or m.first_vintage_year <= p_vintage_year)
                and (m.last_vintage_year is null or m.last_vintage_year >= p_vintage_year)
                and private.drinking_window_place_contains(m.member_place_id,v_wine_place_id)
                and (not private.drinking_window_wine_is_premier_cru(p_wine_id)
                  or (p_place_id is not null and exists (
                    select 1 from public.enrichment_places classification
                    where classification.id=m.member_place_id
                      and classification.place_type in ('classification','climat')
                  )))
            ),0) as place_specificity,
            (r.scope in ('appellation','producer_appellation') and r.ageing_group_id is not null
              and not exists (select 1 from public.drinking_window_ageing_group_memberships mixed
                where mixed.version_id=r.version_id and mixed.group_id=r.ageing_group_id
                  and mixed.member_kind <> 'place')) as place_orderable
        from public.drinking_window_reference_rows r$after$;
    v_rank_before text := $before$    ), ranked as (
        select c.*, count(*) over (partition by c.priority, (c.format_ml is null)) as ties
        from candidates c
    )$before$;
    v_rank_after text := $after$    ), comparable as (
        select c.*, case when bool_and(c.place_orderable) over
          (partition by c.priority, (c.format_ml is null)) then c.place_specificity
          else 0 end as comparable_specificity from candidates c
    ), ranked as (
        select c.*, count(*) over
          (partition by c.priority, (c.format_ml is null), c.comparable_specificity) as ties
        from comparable c
    )$after$;
    v_order_before text := $before$order by r.priority, (r.format_ml is null), r.id$before$;
    v_order_after text := $after$order by r.priority, (r.format_ml is null), r.comparable_specificity desc, r.id$after$;
begin
    select pg_catalog.pg_get_functiondef(
      'private.drinking_window_preview_draft_match_for_wine(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid)'::regprocedure)
      into v_definition;
    if (length(v_definition)-length(replace(v_definition,v_before,'')))<>length(v_before)
       or (length(v_definition)-length(replace(v_definition,v_rank_before,'')))<>length(v_rank_before)
       or (length(v_definition)-length(replace(v_definition,v_order_before,'')))<>length(v_order_before) then
        raise exception 'Draft selector changed; refusing an unsafe replacement';
    end if;
    v_definition := replace(v_definition,v_before,v_after);
    v_definition := replace(v_definition,v_rank_before,v_rank_after);
    v_definition := replace(v_definition,v_order_before,v_order_after);
    execute v_definition;
end;
$migration$;

-- Keep the curator's parameter-based selector consistent when it is given
-- a confirmed place, while retaining its existing format precedence.
do $migration$
declare
    v_definition text;
    v_before text := $before$                when 'appellation' then 4
                else 5 end as priority
        from public.drinking_window_reference_rows r$before$;
    v_after text := $after$                when 'appellation' then 4
                else 5 end as priority,
            coalesce((
              select max(private.drinking_window_place_depth(m.member_place_id))
              from public.drinking_window_ageing_group_memberships m
              where m.version_id=r.version_id and m.group_id=r.ageing_group_id
                and m.member_kind='place'
                and (m.first_vintage_year is null or m.first_vintage_year <= p_vintage_year)
                and (m.last_vintage_year is null or m.last_vintage_year >= p_vintage_year)
                and private.drinking_window_place_contains(m.member_place_id,v_wine_place_id)
            ),0) as place_specificity,
            (r.scope in ('appellation','producer_appellation') and r.ageing_group_id is not null
              and not exists (select 1 from public.drinking_window_ageing_group_memberships mixed
                where mixed.version_id=r.version_id and mixed.group_id=r.ageing_group_id
                  and mixed.member_kind <> 'place')) as place_orderable
        from public.drinking_window_reference_rows r$after$;
    v_rank_before text := $before$    ), ranked as (
        select c.*, count(*) over (partition by c.priority, (c.format_ml is null)) as ties
        from candidates c
    )$before$;
    v_rank_after text := $after$    ), comparable as (
        select c.*, case when bool_and(c.place_orderable) over
          (partition by c.priority, (c.format_ml is null)) then c.place_specificity
          else 0 end as comparable_specificity from candidates c
    ), ranked as (
        select c.*, count(*) over
          (partition by c.priority, (c.format_ml is null), c.comparable_specificity) as ties
        from comparable c
    )$after$;
    v_order_before text := $before$order by r.priority, (r.format_ml is null), r.id$before$;
    v_order_after text := $after$order by r.priority, (r.format_ml is null), r.comparable_specificity desc, r.id$after$;
begin
    select pg_catalog.pg_get_functiondef(
      'public.drinking_window_preview_draft_match(uuid,uuid,uuid,uuid,uuid,uuid,text,integer,uuid,integer)'::regprocedure)
      into v_definition;
    if (length(v_definition)-length(replace(v_definition,v_before,'')))<>length(v_before)
       or (length(v_definition)-length(replace(v_definition,v_rank_before,'')))<>length(v_rank_before)
       or (length(v_definition)-length(replace(v_definition,v_order_before,'')))<>length(v_order_before) then
        raise exception 'Parameter selector changed; refusing an unsafe replacement';
    end if;
    v_definition := replace(v_definition,v_before,v_after);
    v_definition := replace(v_definition,v_rank_before,v_rank_after);
    v_definition := replace(v_definition,v_order_before,v_order_after);
    execute v_definition;
end;
$migration$;

-- Only a strict appellation-to-climat pair can rely on that ordering. Equal
-- places, competing climat groups, and product/release overlaps still block.
do $migration$
declare
    v_definition text;
    v_before text := $before$          and (
              a.member_kind = 'place' or b.member_kind = 'place'$before$;
    v_after text := $after$          and not (
              a.member_kind = 'place' and b.member_kind = 'place'
              and a.member_place_id <> b.member_place_id
              and not exists (select 1 from members_in_version mixed
                where mixed.group_id in (a.group_id,b.group_id) and mixed.member_kind <> 'place')
              and (
                (a.member_place_id=ra.appellation_id
                  and exists (select 1 from public.enrichment_places p
                    where p.id=b.member_place_id and p.place_type='climat')
                  and exists (select 1 from ancestors x
                    where x.place_id=b.member_place_id and x.ancestor_id=a.member_place_id))
                or
                (b.member_place_id=rb.appellation_id
                  and exists (select 1 from public.enrichment_places p
                    where p.id=a.member_place_id and p.place_type='climat')
                  and exists (select 1 from ancestors x
                    where x.place_id=a.member_place_id and x.ancestor_id=b.member_place_id))
              )
          )
          and (
              a.member_kind = 'place' or b.member_kind = 'place'$after$;
begin
    select pg_catalog.pg_get_functiondef(
      'public.drinking_window_eligibility_issues(uuid)'::regprocedure)
      into v_definition;
    if (length(v_definition)-length(replace(v_definition,v_before,'')))<>length(v_before) then
        raise exception 'Eligibility guard changed; refusing an unsafe replacement';
    end if;
    execute replace(v_definition,v_before,v_after);
end;
$migration$;

commit;
