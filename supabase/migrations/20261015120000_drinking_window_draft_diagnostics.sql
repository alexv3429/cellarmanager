begin;

-- A service-only, read-only review report. This is deliberately not a
-- publisher or a certificate that a version is ready for publication.
create function public.drinking_window_draft_issues(p_version_id uuid)
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
    links_in_version as (
        select l.*, e.review_status, p.status as policy_status,
            p.display_right, p.normalized_storage_right,
            p.cross_household_reuse_right, p.effective_from, p.effective_to
        from public.drinking_window_reference_evidence l
        join public.enrichment_evidence e on e.id = l.evidence_id
        join public.enrichment_source_policies p on p.id = e.source_policy_id
        where l.version_id = p_version_id
    ),
    issues as (
        select 'empty_version'::text as issue_code, 'version'::text as subject_kind,
            p_version_id as subject_id, null::uuid as related_id
        where not exists (select 1 from rows_in_version)

        union all
        select 'invalid_region', 'row', r.id, r.region_id
        from rows_in_version r
        join public.enrichment_places p on p.id = r.region_id
        where p.place_type not in ('region', 'subregion')

        union all
        select 'appellation_region_mismatch', 'row', r.id, r.appellation_id
        from rows_in_version r
        join public.enrichment_places p on p.id = r.appellation_id
        where p.place_type <> 'appellation'
           or not exists (
               select 1 from ancestors a
               where a.place_id = r.appellation_id and a.ancestor_id = r.region_id
           )

        union all
        select 'release_identity_mismatch', 'row', r.id, r.release_id
        from rows_in_version r
        join public.wine_reference_releases release on release.id = r.release_id
        join public.wine_reference_products product on product.id = release.product_id
        where release.product_id <> r.product_id
           or product.producer_id <> r.producer_id
           or release.vintage_year is distinct from r.vintage_year

        union all
        select 'invalid_region', 'group', g.id, g.region_id
        from groups_in_version g
        join public.enrichment_places p on p.id = g.region_id
        where p.place_type not in ('region', 'subregion')

        union all
        select 'membership_outside_region', 'membership', m.id, m.member_place_id
        from members_in_version m
        join groups_in_version g on g.id = m.group_id
        where m.member_kind = 'place'
          and not exists (
              select 1 from ancestors a
              where a.place_id = m.member_place_id and a.ancestor_id = g.region_id
          )

        union all
        select 'group_without_member_for_vintage', 'row', r.id, r.ageing_group_id
        from rows_in_version r
        where r.ageing_group_id is not null
          and not exists (
              select 1 from members_in_version m
              where m.group_id = r.ageing_group_id
                and (m.first_vintage_year is null or m.first_vintage_year <= r.vintage_year)
                and (m.last_vintage_year is null or m.last_vintage_year >= r.vintage_year)
          )

        union all
        select 'all_scope_overlap', 'row', a.id, b.id
        from rows_in_version a
        join rows_in_version b on a.id < b.id
            and a.scope = b.scope and a.region_id = b.region_id
            and a.wine_color = b.wine_color and a.vintage_year = b.vintage_year
            and a.producer_id is not distinct from b.producer_id
            and a.appellation_id is not distinct from b.appellation_id
            and a.all_at_scope <> b.all_at_scope

        union all
        select 'membership_group_overlap', 'membership', a.id, b.id
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
        where (a.member_kind = b.member_kind
                and coalesce(a.member_place_id, a.member_product_id, a.member_release_id)
                    = coalesce(b.member_place_id, b.member_product_id, b.member_release_id))
           or (a.member_kind = 'product' and b.member_kind = 'release'
                and exists (select 1 from public.wine_reference_releases release
                    where release.id = b.member_release_id
                      and release.product_id = a.member_product_id))
           or (a.member_kind = 'release' and b.member_kind = 'product'
                and exists (select 1 from public.wine_reference_releases release
                    where release.id = a.member_release_id
                      and release.product_id = b.member_product_id))

        union all
        select 'missing_first_trial_support', 'row', r.id, null::uuid
        from rows_in_version r
        where not exists (
            select 1 from links_in_version l
            where l.reference_row_id = r.id and l.claim_part = 'first_trial'
              and l.evidence_role = 'supports'
        )

        union all
        select 'missing_optimal_period_support', 'row', r.id, null::uuid
        from rows_in_version r
        where not exists (
            select 1 from links_in_version l
            where l.reference_row_id = r.id and l.claim_part = 'optimal_period'
              and l.evidence_role = 'supports'
        )

        union all
        select 'missing_group_definition_support', 'group', g.id, null::uuid
        from groups_in_version g
        where not exists (
            select 1 from links_in_version l
            where l.ageing_group_id = g.id and l.claim_part = 'group_definition'
              and l.evidence_role = 'supports'
        )

        union all
        select 'missing_membership_support', 'membership', m.id, null::uuid
        from members_in_version m
        where not exists (
            select 1 from links_in_version l
            where l.membership_id = m.id and l.claim_part = 'membership_eligibility'
              and l.evidence_role = 'supports'
        )

        union all
        select 'unreviewed_or_unlicensed_evidence',
            case when l.reference_row_id is not null then 'row'
                 when l.ageing_group_id is not null then 'group'
                 else 'membership' end,
            coalesce(l.reference_row_id, l.ageing_group_id, l.membership_id), l.evidence_id
        from links_in_version l
        where l.review_status <> 'reviewed'
           or l.policy_status <> 'reviewed'
           or l.display_right <> 'allowed'
           or l.normalized_storage_right <> 'allowed'
           or l.cross_household_reuse_right <> 'allowed'
           or l.effective_from > current_date
           or (l.effective_to is not null and l.effective_to < current_date)

        union all
        select 'contradictory_evidence',
            case when l.reference_row_id is not null then 'row'
                 when l.ageing_group_id is not null then 'group'
                 else 'membership' end,
            coalesce(l.reference_row_id, l.ageing_group_id, l.membership_id), l.evidence_id
        from links_in_version l where l.evidence_role = 'contradicts'
    )
    select i.issue_code, i.subject_kind, i.subject_id, i.related_id
    from issues i
    order by i.subject_kind, i.subject_id, i.issue_code, i.related_id;
end;
$$;

revoke all on function public.drinking_window_draft_issues(uuid)
from public, anon, authenticated, powersync_role;
grant execute on function public.drinking_window_draft_issues(uuid) to service_role;

commit;
