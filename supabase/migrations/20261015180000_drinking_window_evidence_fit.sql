begin;

-- Detect contradictions between a draft claim and the metadata of a linked
-- supporting source. This cannot verify the source's actual words or certify
-- publication; the human review from the preceding migration remains needed.
create function public.drinking_window_evidence_fit_issues(p_version_id uuid)
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
    linked as (
        select l.id as link_id, l.claim_part, l.reference_row_id,
            l.ageing_group_id, l.membership_id,
            e.claim_type, e.scope_level, e.place_id as evidence_place_id,
            e.wine_color as evidence_color,
            coalesce(e.vintage_year, evidence_release.vintage_year)
                as evidence_vintage_year,
            coalesce(e.producer_id, evidence_product.producer_id,
                evidence_release_product.producer_id) as evidence_producer_id,
            coalesce(e.product_id, evidence_release.product_id)
                as evidence_product_id,
            e.release_id as evidence_release_id,
            r.scope as target_scope,
            case when l.reference_row_id is not null then 'row'
                 when l.ageing_group_id is not null then 'group'
                 else 'membership' end as target_kind,
            coalesce(l.reference_row_id, l.ageing_group_id, l.membership_id)
                as target_id,
            case when l.membership_id is not null then
                coalesce(m.member_place_id, membership_group.appellation_id,
                    membership_group.region_id)
                else coalesce(r.appellation_id, g.appellation_id,
                    r.region_id, g.region_id) end as target_place_id,
            coalesce(r.producer_id, g.producer_id, membership_group.producer_id,
                member_product.producer_id, member_release_product.producer_id)
                as target_producer_id,
            coalesce(r.product_id, m.member_product_id, member_release.product_id)
                as target_product_id,
            coalesce(r.release_id, m.member_release_id) as target_release_id,
            r.vintage_year as target_vintage_year,
            m.first_vintage_year, m.last_vintage_year,
            coalesce(r.wine_color, g.wine_color, membership_group.wine_color)
                as target_color,
            m.member_kind
        from public.drinking_window_reference_evidence l
        join public.enrichment_evidence e on e.id = l.evidence_id
        left join public.drinking_window_reference_rows r
            on r.id = l.reference_row_id
        left join public.drinking_window_ageing_groups g
            on g.id = l.ageing_group_id
        left join public.drinking_window_ageing_group_memberships m
            on m.id = l.membership_id
        left join public.drinking_window_ageing_groups membership_group
            on membership_group.id = m.group_id
        left join public.wine_reference_products member_product
            on member_product.id = m.member_product_id
        left join public.wine_reference_releases member_release
            on member_release.id = m.member_release_id
        left join public.wine_reference_products member_release_product
            on member_release_product.id = member_release.product_id
        left join public.wine_reference_products evidence_product
            on evidence_product.id = e.product_id
        left join public.wine_reference_releases evidence_release
            on evidence_release.id = e.release_id
        left join public.wine_reference_products evidence_release_product
            on evidence_release_product.id = evidence_release.product_id
        where l.version_id = p_version_id and l.evidence_role = 'supports'
    ),
    issues as (
        select 'date_source_not_window_claim'::text as code,
            x.target_kind::text as kind, x.target_id as id, x.link_id as other_id
        from linked x
        where x.target_kind = 'row'
          and x.claim_part in ('first_trial', 'optimal_period')
          and x.claim_type <> 'maturity-window'

        union all
        select 'unrelated_support_claim_type', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.claim_type = 'food-pairing'
           or (x.target_kind = 'membership'
               and x.claim_type = 'methodology')

        union all
        select 'support_place_conflict', x.target_kind, x.target_id, x.link_id
        from linked x
        where x.evidence_place_id is not null
          and x.target_place_id is not null
          and not exists (
              select 1 from ancestors a
              where (a.place_id = x.evidence_place_id
                      and a.ancestor_id = x.target_place_id)
                 or (a.place_id = x.target_place_id
                      and a.ancestor_id = x.evidence_place_id)
          )

        union all
        select 'support_producer_conflict', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.evidence_producer_id is not null
          and x.target_producer_id is not null
          and x.evidence_producer_id <> x.target_producer_id

        union all
        select 'support_product_conflict', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.evidence_product_id is not null
          and x.target_product_id is not null
          and x.evidence_product_id <> x.target_product_id

        union all
        select 'support_release_conflict', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.evidence_release_id is not null
          and x.target_release_id is not null
          and x.evidence_release_id <> x.target_release_id

        union all
        select 'support_vintage_conflict', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.evidence_vintage_year is not null
          and ((x.target_vintage_year is not null
                and x.evidence_vintage_year <> x.target_vintage_year)
            or (x.target_kind = 'membership'
                and ((x.first_vintage_year is not null
                      and x.evidence_vintage_year < x.first_vintage_year)
                  or (x.last_vintage_year is not null
                      and x.evidence_vintage_year > x.last_vintage_year))))

        union all
        select 'support_color_conflict', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.evidence_color is not null
          and x.evidence_color <> x.target_color

        union all
        select 'support_too_narrow_for_claim', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where (x.target_kind = 'row' and (
            (x.target_release_id is null and x.evidence_release_id is not null)
            or (x.target_product_id is null and x.evidence_product_id is not null)
            or (x.target_producer_id is null and x.evidence_producer_id is not null)
            or (x.target_scope <> 'release'
                and x.evidence_place_id is not null
                and x.evidence_place_id <> x.target_place_id
                and exists (select 1 from ancestors a
                    where a.place_id = x.evidence_place_id
                      and a.ancestor_id = x.target_place_id))))
           or (x.target_kind = 'membership' and x.member_kind = 'place'
               and x.evidence_product_id is not null)

        union all
        select 'support_scope_inapplicable', x.target_kind, x.target_id,
            x.link_id
        from linked x
        where x.scope_level = 'package'
           or (x.target_kind = 'row' and x.scope_level = 'methodology')
    )
    select i.code, i.kind, i.id, i.other_id from issues i
    order by i.kind, i.id, i.code, i.other_id;
end;
$$;

revoke all on function public.drinking_window_evidence_fit_issues(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_evidence_fit_issues(uuid)
to service_role;

commit;
