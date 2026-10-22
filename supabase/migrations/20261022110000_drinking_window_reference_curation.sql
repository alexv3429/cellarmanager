begin;

-- A narrow curator view of actual draft references. Historical workbook
-- candidates remain in the separate review workspace. Neither RPC can
-- publish a version, edit a reference, or opt a household into advice.
create function public.get_drinking_window_reference_drafts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.enrichment_curator_eligibilities curator
        where curator.user_id = auth.uid()
          and curator.eligibility_status = 'active'
          and 'drinking-window' = any(curator.profile_scopes)
    ) then
        return pg_catalog.jsonb_build_object('eligible', false, 'drafts', '[]'::jsonb);
    end if;

    return pg_catalog.jsonb_build_object(
        'eligible', true,
        'drafts', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'version_id', version.id,
                'version_number', version.version_number,
                'subjects', coalesce((
                    with review_issues as materialized (
                        select issue.issue_code, issue.subject_kind, issue.subject_id
                        from public.drinking_window_review_issues(version.id) issue
                    )
                    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'kind', subject.kind,
                        'id', subject.id,
                        'hash', hash.current_hash,
                        'title', subject.title,
                        'details', subject.details,
                        'rationale', subject.rationale,
                        'evidence', coalesce((
                            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'claim_part', link.claim_part,
                                'evidence_role', link.evidence_role,
                                'source_name', source.source_name,
                                'source_url', evidence.source_record_url,
                                'review_status', evidence.review_status,
                                'cross_household_reuse_right', policy.cross_household_reuse_right
                            ) order by link.claim_part, link.id)
                            from public.drinking_window_reference_evidence link
                            join public.enrichment_evidence evidence on evidence.id = link.evidence_id
                            join public.enrichment_sources source on source.id = evidence.source_id
                            join public.enrichment_source_policies policy on policy.id = evidence.source_policy_id
                            where link.version_id = version.id
                              and ((subject.kind = 'row' and link.reference_row_id = subject.id)
                                or (subject.kind = 'group' and link.ageing_group_id = subject.id)
                                or (subject.kind = 'membership' and link.membership_id = subject.id))
                        ), '[]'::jsonb),
                        'reviews', coalesce((
                            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'verdict', latest.verdict,
                                'rationale', latest.rationale,
                                'decided_at', latest.decided_at,
                                'curator_id', latest.curator_id
                            ) order by latest.decided_at desc, latest.curator_id)
                            from (
                                select distinct on (review.curator_id) review.*
                                from public.drinking_window_reference_reviews review
                                join public.enrichment_curator_eligibilities curator
                                  on curator.user_id = review.curator_id
                                where review.version_id = version.id
                                  and review.subject_sha256 = hash.current_hash
                                  and review.decided_at >= curator.granted_at
                                  and curator.eligibility_status = 'active'
                                  and 'drinking-window' = any(curator.profile_scopes)
                                  and ((subject.kind = 'row' and review.reference_row_id = subject.id)
                                    or (subject.kind = 'group' and review.ageing_group_id = subject.id)
                                    or (subject.kind = 'membership' and review.membership_id = subject.id))
                                order by review.curator_id, review.decision_sequence desc
                            ) latest
                        ), '[]'::jsonb),
                        'issues', coalesce((
                            select pg_catalog.jsonb_agg(issue.issue_code order by issue.issue_code)
                            from review_issues issue
                            where issue.subject_kind = subject.kind and issue.subject_id = subject.id
                        ), '[]'::jsonb)
                    ) order by subject.sort_order, subject.title, subject.id)
                    from (
                        select 'row'::text kind, 1 sort_order, row.id,
                            place.canonical_name || ' · ' || row.vintage_year::text || ' · ' || row.wine_color title,
                            pg_catalog.jsonb_build_object(
                                'scope', row.scope, 'first_trial_year', row.first_trial_year,
                                'best_start_year', row.best_start_year,
                                'best_end_year', row.best_end_year,
                                'ageing_group_id', row.ageing_group_id) details,
                            row.rationale
                        from public.drinking_window_reference_rows row
                        join public.enrichment_places place on place.id = row.region_id
                        where row.version_id = version.id
                        union all
                        select 'group', 2, group_row.id,
                            place.canonical_name || ' · ' || group_row.group_key,
                            pg_catalog.jsonb_build_object(
                                'scope', group_row.scope, 'wine_color', group_row.wine_color),
                            group_row.definition
                        from public.drinking_window_ageing_groups group_row
                        join public.enrichment_places place on place.id = group_row.region_id
                        where group_row.version_id = version.id
                        union all
                        select 'membership', 3, member.id,
                            coalesce(producer.canonical_name || ' · ' || product.canonical_name ||
                                ' · ' || release.vintage_year::text, place.canonical_name, 'Unknown member'),
                            pg_catalog.jsonb_build_object(
                                'member_kind', member.member_kind,
                                'first_vintage_year', member.first_vintage_year,
                                'last_vintage_year', member.last_vintage_year,
                                'group_id', member.group_id),
                            member.rationale
                        from public.drinking_window_ageing_group_memberships member
                        left join public.wine_reference_releases release on release.id = member.member_release_id
                        left join public.wine_reference_products product
                          on product.id = coalesce(member.member_product_id, release.product_id)
                        left join public.wine_reference_producers producer on producer.id = product.producer_id
                        left join public.enrichment_places place on place.id = member.member_place_id
                        where member.version_id = version.id
                    ) subject
                    cross join lateral (
                        select private.drinking_window_review_subject_hash(
                            version.id, subject.kind, subject.id) current_hash
                    ) hash
                ), '[]'::jsonb)
            ) order by version.version_number)
            from public.drinking_window_reference_versions version
            where version.status = 'draft'
        ), '[]'::jsonb)
    );
end;
$$;

create function public.record_drinking_window_reference_review(
    p_version_id uuid,
    p_subject_kind text,
    p_subject_id uuid,
    p_expected_hash text,
    p_verdict text,
    p_rationale text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_hash text;
    v_inserted_hash text;
    v_review_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_subject_kind not in ('row', 'group', 'membership')
       or p_verdict not in ('approve', 'disagree')
       or p_rationale is null or length(trim(p_rationale)) not between 10 and 2000
       or p_expected_hash is null or p_expected_hash !~ '^[0-9a-f]{64}$' then
        raise exception using errcode = '22023', message = 'Reference review is invalid';
    end if;
    perform 1 from public.drinking_window_reference_versions
    where id = p_version_id and status = 'draft' for share;
    if not found then
        raise exception using errcode = '22023', message = 'Reviewable draft version not found';
    end if;
    v_hash := private.drinking_window_review_subject_hash(
        p_version_id, p_subject_kind, p_subject_id);
    if v_hash <> p_expected_hash then
        raise exception using errcode = '40001',
            message = 'Reference changed; refresh before reviewing';
    end if;

    insert into public.drinking_window_reference_reviews (
        version_id, reference_row_id, ageing_group_id, membership_id,
        curator_id, verdict, rationale, subject_sha256
    ) values (
        p_version_id,
        case when p_subject_kind = 'row' then p_subject_id end,
        case when p_subject_kind = 'group' then p_subject_id end,
        case when p_subject_kind = 'membership' then p_subject_id end,
        auth.uid(), p_verdict, trim(p_rationale), p_expected_hash
    ) returning id, subject_sha256 into v_review_id, v_inserted_hash;
    if v_inserted_hash <> p_expected_hash then
        raise exception using errcode = '40001',
            message = 'Reference changed; refresh before reviewing';
    end if;
    return v_review_id;
end;
$$;

revoke all on function public.get_drinking_window_reference_drafts() from public, anon;
revoke all on function public.record_drinking_window_reference_review(
    uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.get_drinking_window_reference_drafts() to authenticated;
grant execute on function public.record_drinking_window_reference_review(
    uuid, text, uuid, text, text, text) to authenticated;

commit;
