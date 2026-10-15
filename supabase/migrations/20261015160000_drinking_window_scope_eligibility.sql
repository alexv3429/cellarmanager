begin;

-- A local ageing group needs the same identity dimensions as its row. The
-- previous key only distinguished region and colour, so an appellation or
-- producer-appellation group could accidentally cover another appellation.
alter table public.drinking_window_ageing_groups
    add column producer_id uuid references public.wine_reference_producers(id),
    add column appellation_id uuid references public.enrichment_places(id);

-- Preserve any existing draft groups. An unambiguous linked row supplies the
-- identity; unresolved legacy groups remain drafts and are reported below.
with identities as (
    select g.id, min(r.producer_id::text)::uuid as producer_id,
        min(r.appellation_id::text)::uuid as appellation_id
    from public.drinking_window_ageing_groups g
    join public.drinking_window_reference_rows r on r.ageing_group_id = g.id
    where g.scope <> 'region'
    group by g.id
    having count(distinct (r.producer_id, r.appellation_id)) = 1
)
update public.drinking_window_ageing_groups g
set producer_id = i.producer_id, appellation_id = i.appellation_id
from identities i where g.id = i.id;

alter table public.drinking_window_ageing_groups
    add constraint drinking_window_ageing_groups_scope_identity_check check (
        (scope = 'region' and producer_id is null and appellation_id is null)
        or (scope = 'appellation' and producer_id is null and appellation_id is not null)
        or (scope = 'producer_region'
            and producer_id is not null and appellation_id is null)
        or (scope = 'producer_appellation'
            and producer_id is not null and appellation_id is not null)
    ) not valid;

alter table public.drinking_window_ageing_groups
    drop constraint drinking_window_ageing_groups_key_unique;
create unique index drinking_window_ageing_groups_scoped_key_unique
    on public.drinking_window_ageing_groups (
        version_id, scope, region_id, wine_color,
        coalesce(producer_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(appellation_id, '00000000-0000-0000-0000-000000000000'::uuid),
        group_key
    );

-- A product or release membership may now be anchored to a place. This is
-- needed when a cuvee changes appellation or a producer spans regions. Older
-- unanchored draft memberships are retained but cannot pass the new report.
alter table public.drinking_window_ageing_group_memberships
    drop constraint drinking_window_memberships_target_check;
alter table public.drinking_window_ageing_group_memberships
    add constraint drinking_window_memberships_target_check check (
        (member_kind = 'place' and member_place_id is not null
            and member_product_id is null and member_release_id is null)
        or (member_kind = 'product' and member_product_id is not null
            and member_release_id is null)
        or (member_kind = 'release' and member_release_id is not null
            and member_product_id is null)
    );

drop index public.drinking_window_memberships_exact_key_unique;
create unique index drinking_window_memberships_exact_key_unique
    on public.drinking_window_ageing_group_memberships (
        group_id, member_kind,
        coalesce(member_place_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(member_product_id, member_release_id,
            '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(first_vintage_year, 1800),
        coalesce(last_vintage_year, 2200)
    );

-- Additional draft-only checks. These complement, rather than replace, the
-- date/evidence and review reports. They do not certify or publish a version.
create function public.drinking_window_eligibility_issues(p_version_id uuid)
returns table (issue_code text, subject_kind text, subject_id uuid, related_id uuid)
language plpgsql
stable
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft'
    ) then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;

    return query
    with recursive
    ancestors(place_id, ancestor_id) as (
        select p.id, p.id from public.enrichment_places p
        union all
        select a.place_id, p.parent_id
        from ancestors a
        join public.enrichment_places p on p.id = a.ancestor_id
        where p.parent_id is not null
    ),
    rows_in_version as (
        select * from public.drinking_window_reference_rows r
        where r.version_id = p_version_id
    ),
    groups_in_version as (
        select * from public.drinking_window_ageing_groups g
        where g.version_id = p_version_id
    ),
    members_in_version as (
        select * from public.drinking_window_ageing_group_memberships m
        where m.version_id = p_version_id
    ),
    issues as (
        select 'group_identity_missing'::text as code, 'group'::text as kind,
            g.id, null::uuid as other_id
        from groups_in_version g
        where (g.scope = 'appellation' and g.appellation_id is null)
           or (g.scope = 'producer_region' and g.producer_id is null)
           or (g.scope = 'producer_appellation'
               and (g.appellation_id is null or g.producer_id is null))

        union all
        select 'group_appellation_region_mismatch', 'group', g.id, g.appellation_id
        from groups_in_version g
        join public.enrichment_places p on p.id = g.appellation_id
        where p.place_type <> 'appellation'
           or not exists (
               select 1 from ancestors a
               where a.place_id = g.appellation_id and a.ancestor_id = g.region_id
           )

        union all
        select 'row_group_identity_mismatch', 'row', r.id, g.id
        from rows_in_version r
        join groups_in_version g on g.id = r.ageing_group_id
        where (g.scope in ('appellation', 'producer_appellation')
                and r.appellation_id is distinct from g.appellation_id)
           or (g.scope in ('producer_region', 'producer_appellation')
                and r.producer_id is distinct from g.producer_id)

        union all
        select 'membership_place_missing', 'membership', m.id, m.group_id
        from members_in_version m
        where m.member_kind in ('product', 'release')
          and m.member_place_id is null

        union all
        select 'membership_outside_group_place', 'membership', m.id,
            m.member_place_id
        from members_in_version m
        join groups_in_version g on g.id = m.group_id
        where m.member_place_id is not null
          and not exists (
              select 1 from ancestors a
              where a.place_id = m.member_place_id
                and a.ancestor_id = coalesce(g.appellation_id, g.region_id)
          )

        union all
        select 'membership_producer_mismatch', 'membership', m.id, g.producer_id
        from members_in_version m
        join groups_in_version g on g.id = m.group_id
        join public.wine_reference_products p
          on p.id = m.member_product_id
          or (m.member_release_id is not null and exists (
              select 1 from public.wine_reference_releases release
              where release.id = m.member_release_id and release.product_id = p.id
          ))
        where g.scope in ('producer_region', 'producer_appellation')
          and p.producer_id is distinct from g.producer_id

        union all
        select 'membership_place_overlap', 'membership', a.id, b.id
        from rows_in_version ra
        join rows_in_version rb on ra.id < rb.id
            and ra.scope = rb.scope and ra.region_id = rb.region_id
            and ra.wine_color = rb.wine_color and ra.vintage_year = rb.vintage_year
            and ra.producer_id is not distinct from rb.producer_id
            and ra.appellation_id is not distinct from rb.appellation_id
            and ra.ageing_group_id <> rb.ageing_group_id
        join members_in_version a on a.group_id = ra.ageing_group_id
            and (a.first_vintage_year is null or a.first_vintage_year <= ra.vintage_year)
            and (a.last_vintage_year is null or a.last_vintage_year >= ra.vintage_year)
        join members_in_version b on b.group_id = rb.ageing_group_id
            and (b.first_vintage_year is null or b.first_vintage_year <= rb.vintage_year)
            and (b.last_vintage_year is null or b.last_vintage_year >= rb.vintage_year)
        where a.member_place_id is not null and b.member_place_id is not null
          and exists (
              select 1 from ancestors x
              where (x.place_id = a.member_place_id
                        and x.ancestor_id = b.member_place_id)
                 or (x.place_id = b.member_place_id
                        and x.ancestor_id = a.member_place_id)
          )
          and (
              a.member_kind = 'place' or b.member_kind = 'place'
              or (a.member_kind = 'product' and b.member_kind = 'product'
                  and a.member_product_id = b.member_product_id)
              or (a.member_kind = 'release' and b.member_kind = 'release'
                  and a.member_release_id = b.member_release_id)
              or (a.member_kind = 'product' and b.member_kind = 'release'
                  and exists (select 1 from public.wine_reference_releases release
                      where release.id = b.member_release_id
                        and release.product_id = a.member_product_id))
              or (a.member_kind = 'release' and b.member_kind = 'product'
                  and exists (select 1 from public.wine_reference_releases release
                      where release.id = a.member_release_id
                        and release.product_id = b.member_product_id))
          )
    )
    select i.code, i.kind, i.id, i.other_id from issues i
    order by i.kind, i.id, i.code, i.other_id;
end;
$$;

revoke all on function public.drinking_window_eligibility_issues(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_eligibility_issues(uuid)
to service_role;

commit;
