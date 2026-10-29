begin;

-- Author broad fallbacks explicitly. No generic region date is inferred from
-- a neighbouring region or from a producer exchange file. Every broad row
-- belongs to one reviewable ageing group with explicit eligible members.
create function public.search_drinking_window_curation_targets(p_kind text, p_query text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_query text := private.normalize_wine_reference_text(p_query);
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_kind not in ('region', 'appellation', 'place', 'producer', 'product', 'release')
       or length(v_query) not between 2 and 100 then
        raise exception using errcode = '22023', message = 'Choose a target type and at least two letters';
    end if;
    if p_kind in ('region', 'appellation', 'place') then
        return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', result.id, 'label', result.canonical_name,
            'detail', result.place_type || coalesce(' · ' || parent.canonical_name, ''))
            order by result.canonical_name, result.id)
            from (select p.* from public.enrichment_places p
                where (p_kind = 'place' and p.place_type in
                       ('region','subregion','appellation','classification','site','parcel')
                    or p_kind = 'region' and p.place_type in ('region','subregion')
                    or p_kind = 'appellation' and p.place_type = 'appellation')
                  and pg_catalog.strpos(p.normalized_name, v_query) > 0
                order by p.canonical_name, p.id limit 30) result
            left join public.enrichment_places parent on parent.id = result.parent_id), '[]'::jsonb);
    end if;
    if p_kind = 'producer' then
        return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', result.id, 'label', result.canonical_name, 'detail', 'producer')
            order by result.canonical_name, result.id)
            from (select * from public.wine_reference_producers p
                where pg_catalog.strpos(private.normalize_wine_reference_text(p.canonical_name), v_query) > 0
                order by p.canonical_name, p.id limit 30) result), '[]'::jsonb);
    end if;
    if p_kind = 'product' then
        return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', result.id, 'label', result.canonical_name,
            'detail', producer.canonical_name)
            order by producer.canonical_name, result.canonical_name, result.id)
            from (select product.* from public.wine_reference_products product
                join public.wine_reference_producers producer on producer.id = product.producer_id
                where pg_catalog.strpos(private.normalize_wine_reference_text(
                    producer.canonical_name || ' ' || product.canonical_name), v_query) > 0
                   or pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name), v_query) > 0
                order by product.canonical_name, product.id limit 30) result
            join public.wine_reference_producers producer on producer.id = result.producer_id), '[]'::jsonb);
    end if;
    return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', result.id, 'label', product.canonical_name,
        'detail', producer.canonical_name || ' · ' || result.vintage_year::text)
        order by producer.canonical_name, product.canonical_name, result.vintage_year, result.id)
        from (select release.* from public.wine_reference_releases release
            join public.wine_reference_products product on product.id = release.product_id
            join public.wine_reference_producers producer on producer.id = product.producer_id
            where release.vintage_year is not null
              and (pg_catalog.strpos(private.normalize_wine_reference_text(
                  producer.canonical_name || ' ' || product.canonical_name), v_query) > 0
                or pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name), v_query) > 0)
            order by release.vintage_year desc, release.id limit 30) result
        join public.wine_reference_products product on product.id = result.product_id
        join public.wine_reference_producers producer on producer.id = product.producer_id), '[]'::jsonb);
end;
$$;
revoke all on function public.search_drinking_window_curation_targets(text,text) from public, anon;
grant execute on function public.search_drinking_window_curation_targets(text,text) to authenticated;

create function public.create_drinking_window_ageing_group(
    p_version_id uuid, p_scope text, p_region_id uuid, p_appellation_id uuid,
    p_producer_id uuid, p_color text, p_group_key text, p_definition text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    perform 1 from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status = 'draft' for update;
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    if p_scope not in ('region','appellation','producer_region','producer_appellation')
       or p_color not in ('red','white','rose','sparkling','sweet','fortified','other')
       or length(pg_catalog.btrim(coalesce(p_group_key,''))) not between 2 and 80
       or length(pg_catalog.btrim(coalesce(p_definition,''))) not between 20 and 2000
       or not exists (select 1 from public.enrichment_places p
           where p.id = p_region_id and p.place_type in ('region','subregion'))
       or (p_scope in ('appellation','producer_appellation')
           and (p_appellation_id is null or not exists (
               select 1 from public.enrichment_places p
               where p.id = p_appellation_id and p.place_type = 'appellation'
                 and private.drinking_window_place_contains(p_region_id, p.id))))
       or (p_scope in ('region','producer_region') and p_appellation_id is not null)
       or (p_scope in ('producer_region','producer_appellation')
           and (p_producer_id is null or not exists (
               select 1 from public.wine_reference_producers p where p.id = p_producer_id)))
       or (p_scope in ('region','appellation') and p_producer_id is not null) then
        raise exception using errcode = '22023', message = 'Choose a coherent, explicit ageing-group identity';
    end if;
    insert into public.drinking_window_ageing_groups (
        version_id, scope, region_id, appellation_id, producer_id,
        wine_color, group_key, definition
    ) values (
        p_version_id, p_scope, p_region_id, p_appellation_id, p_producer_id,
        p_color, pg_catalog.btrim(p_group_key), pg_catalog.btrim(p_definition)
    ) returning id into v_id;
    return v_id;
end;
$$;
revoke all on function public.create_drinking_window_ageing_group(uuid,text,uuid,uuid,uuid,text,text,text)
from public, anon;
grant execute on function public.create_drinking_window_ageing_group(uuid,text,uuid,uuid,uuid,text,text,text)
to authenticated;

create function public.get_drinking_window_authoring_groups(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft') then
        raise exception using errcode = '22023', message = 'Choose an unpublished version';
    end if;
    return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', g.id, 'scope', g.scope, 'region', region.canonical_name,
        'appellation', appellation.canonical_name,
        'producer', producer.canonical_name, 'wine_color', g.wine_color,
        'group_key', g.group_key, 'definition', g.definition,
        'member_count', (select count(*) from public.drinking_window_ageing_group_memberships m
            where m.group_id = g.id)) order by g.scope, g.group_key, g.id)
        from public.drinking_window_ageing_groups g
        join public.enrichment_places region on region.id = g.region_id
        left join public.enrichment_places appellation on appellation.id = g.appellation_id
        left join public.wine_reference_producers producer on producer.id = g.producer_id
        where g.version_id = p_version_id), '[]'::jsonb);
end;
$$;
revoke all on function public.get_drinking_window_authoring_groups(uuid) from public, anon;
grant execute on function public.get_drinking_window_authoring_groups(uuid) to authenticated;

create function public.add_drinking_window_group_membership(
    p_group_id uuid, p_member_kind text, p_target_id uuid, p_place_id uuid,
    p_first_vintage integer, p_last_vintage integer, p_rationale text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_group public.drinking_window_ageing_groups%rowtype;
    v_product_producer_id uuid;
    v_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select g.* into v_group from public.drinking_window_ageing_groups g
    join public.drinking_window_reference_versions v on v.id = g.version_id
    where g.id = p_group_id and v.status = 'draft' for update of g;
    if not found then
        raise exception using errcode = '22023', message = 'Choose a group in an unpublished draft';
    end if;
    if p_member_kind not in ('place','product','release') or p_target_id is null
       or length(pg_catalog.btrim(coalesce(p_rationale,''))) not between 20 and 1000
       or (p_first_vintage is null) <> (p_last_vintage is null)
       or (p_first_vintage is not null and
           (p_first_vintage < 1800 or p_last_vintage > 2200
             or p_first_vintage > p_last_vintage)) then
        raise exception using errcode = '22023', message = 'Membership needs an exact target and reviewed vintage range';
    end if;
    if p_member_kind = 'place' then
        if p_place_id is distinct from p_target_id or not exists (
            select 1 from public.enrichment_places p where p.id = p_target_id) then
            raise exception using errcode = '22023', message = 'Choose a confirmed place';
        end if;
    elsif p_member_kind = 'product' then
        select producer_id into v_product_producer_id from public.wine_reference_products
        where id = p_target_id;
        if not found then
            raise exception using errcode = '22023', message = 'Choose a canonical cuvée';
        end if;
    else
        select product.producer_id into v_product_producer_id
        from public.wine_reference_releases release
        join public.wine_reference_products product on product.id = release.product_id
        where release.id = p_target_id;
        if not found then
            raise exception using errcode = '22023', message = 'Choose a canonical release';
        end if;
    end if;
    if p_place_id is null or not private.drinking_window_place_contains(
        coalesce(v_group.appellation_id, v_group.region_id), p_place_id)
       or (v_group.producer_id is not null and v_product_producer_id is not null
           and v_product_producer_id <> v_group.producer_id) then
        raise exception using errcode = '22023', message = 'Member does not belong to this group identity';
    end if;
    insert into public.drinking_window_ageing_group_memberships (
        version_id, group_id, member_kind, member_place_id,
        member_product_id, member_release_id,
        first_vintage_year, last_vintage_year, rationale
    ) values (
        v_group.version_id, v_group.id, p_member_kind, p_place_id,
        case when p_member_kind = 'product' then p_target_id else null end,
        case when p_member_kind = 'release' then p_target_id else null end,
        p_first_vintage, p_last_vintage, pg_catalog.btrim(p_rationale)
    ) returning id into v_id;
    return v_id;
end;
$$;
revoke all on function public.add_drinking_window_group_membership(uuid,text,uuid,uuid,integer,integer,text)
from public, anon;
grant execute on function public.add_drinking_window_group_membership(uuid,text,uuid,uuid,integer,integer,text)
to authenticated;

create function public.add_drinking_window_group_year(
    p_group_id uuid, p_vintage integer, p_first_trial integer,
    p_best_start integer, p_best_end integer, p_rationale text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_group public.drinking_window_ageing_groups%rowtype;
    v_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select g.* into v_group from public.drinking_window_ageing_groups g
    join public.drinking_window_reference_versions v on v.id = g.version_id
    where g.id = p_group_id and v.status = 'draft' for update of g;
    if not found or p_vintage not between 1800 and 2200
       or p_first_trial < p_vintage or p_first_trial > p_best_start
       or p_best_start > p_best_end or p_best_end > 2300
       or length(pg_catalog.btrim(coalesce(p_rationale,''))) not between 20 and 2000 then
        raise exception using errcode = '22023', message = 'Provide one coherent, reviewable vintage window';
    end if;
    insert into public.drinking_window_reference_rows (
        version_id, scope, producer_id, appellation_id, region_id,
        wine_color, vintage_year, ageing_group_id, all_at_scope,
        first_trial_year, best_start_year, best_end_year, rationale
    ) values (
        v_group.version_id, v_group.scope, v_group.producer_id,
        v_group.appellation_id, v_group.region_id, v_group.wine_color,
        p_vintage, v_group.id, false,
        p_first_trial, p_best_start, p_best_end, pg_catalog.btrim(p_rationale)
    ) returning id into v_id;
    return v_id;
end;
$$;
revoke all on function public.add_drinking_window_group_year(uuid,integer,integer,integer,integer,text)
from public, anon;
grant execute on function public.add_drinking_window_group_year(uuid,integer,integer,integer,integer,text)
to authenticated;

create table private.drinking_window_editorial_contexts (
    evidence_id uuid primary key references public.enrichment_evidence(id),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    subject_kind text not null check (subject_kind in ('group','membership')),
    subject_id uuid not null,
    author_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    rationale text not null check (length(pg_catalog.btrim(rationale)) between 30 and 2000),
    supporting_urls text[] not null check (cardinality(supporting_urls) between 1 and 10),
    consented_at timestamptz not null default now()
);
revoke all on private.drinking_window_editorial_contexts
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_editorial_contexts to service_role;

create function public.attest_drinking_window_editorial_context(
    p_version_id uuid, p_subject_kind text, p_subject_id uuid,
    p_expected_hash text, p_rationale text, p_supporting_urls text[],
    p_adopt_and_share boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_group public.drinking_window_ageing_groups%rowtype;
    v_member public.drinking_window_ageing_group_memberships%rowtype;
    v_scope text;
    v_place_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
    v_claim_part text;
    v_url text;
    v_note_id uuid := pg_catalog.gen_random_uuid();
    v_source_id uuid := pg_catalog.gen_random_uuid();
    v_policy_id uuid := pg_catalog.gen_random_uuid();
    v_evidence_id uuid := pg_catalog.gen_random_uuid();
    v_note_url text;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_subject_kind not in ('group','membership')
       or p_adopt_and_share is distinct from true
       or length(pg_catalog.btrim(coalesce(p_rationale,''))) not between 30 and 2000
       or p_supporting_urls is null or pg_catalog.cardinality(p_supporting_urls) not between 1 and 10
       or pg_catalog.array_position(p_supporting_urls, null) is not null then
        raise exception using errcode = '22023', message = 'Review the group, context and sharing consent';
    end if;
    foreach v_url in array p_supporting_urls loop
        if length(v_url) > 1000 or v_url !~ '^https://[^[:space:]]+$' then
            raise exception using errcode = '22023', message = 'Only HTTPS context links are accepted';
        end if;
    end loop;
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft') then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    if p_subject_kind = 'group' then
        select * into v_group from public.drinking_window_ageing_groups
        where id = p_subject_id and version_id = p_version_id;
        if not found then
            raise exception using errcode = '22023', message = 'Choose a group in this version';
        end if;
        v_color := v_group.wine_color;
        v_claim_part := 'group_definition';
        if v_group.producer_id is not null then
            v_scope := 'producer'; v_producer_id := v_group.producer_id;
        else
            v_scope := 'place'; v_place_id := coalesce(v_group.appellation_id, v_group.region_id);
        end if;
    else
        select * into v_member from public.drinking_window_ageing_group_memberships
        where id = p_subject_id and version_id = p_version_id;
        if not found then
            raise exception using errcode = '22023', message = 'Choose a member in this version';
        end if;
        select * into v_group from public.drinking_window_ageing_groups
        where id = v_member.group_id and version_id = p_version_id;
        v_color := v_group.wine_color;
        v_claim_part := 'membership_eligibility';
        if v_member.member_kind = 'place' then
            v_scope := 'place'; v_place_id := v_member.member_place_id;
        elsif v_member.member_kind = 'product' then
            v_scope := 'product'; v_product_id := v_member.member_product_id;
        else
            v_scope := 'release'; v_release_id := v_member.member_release_id;
        end if;
    end if;
    if p_expected_hash is distinct from private.drinking_window_review_subject_hash(
        p_version_id, p_subject_kind, p_subject_id) then
        raise exception using errcode = '40001', message = 'This group changed; refresh before attesting';
    end if;
    v_note_url := 'https://cellarmanager.cellarcloud.workers.dev/catalog?editorial-context=' || v_evidence_id::text;
    insert into public.enrichment_sources(id, source_key, source_name, source_kind, homepage_url)
    values(v_source_id, 'dw-context-' || replace(v_note_id::text,'-',''),
        'CellarManager editorial group assessment', 'cellarmanager',
        'https://cellarmanager.cellarcloud.workers.dev/');
    insert into public.enrichment_source_policies(
        id, source_id, policy_version, status, effective_from, terms_checked_on,
        evidence_url, display_right, normalized_storage_right, raw_payload_storage_right,
        offline_sync_right, retention_right, cross_household_reuse_right,
        attribution_text, notes
    ) values(
        v_policy_id, v_source_id, 1, 'reviewed', current_date, current_date,
        v_note_url, 'allowed','allowed','prohibited','prohibited','allowed','allowed',
        'CellarManager editorial assessment',
        'The signed-in curator adopted this group or membership assessment and authorized display and reuse across households; linked external pages are context.'
    );
    insert into public.enrichment_evidence(
        id, source_id, source_policy_id, source_record_id, source_record_url,
        content_mode, claim_type, scope_level, place_id, producer_id,
        product_id, release_id, wine_color, claim_value,
        review_status, reviewed_by, reviewed_at
    ) values(
        v_evidence_id, v_source_id, v_policy_id, 'editorial-context-' || v_note_id::text,
        v_note_url, 'normalized-claim', 'wine-structure', v_scope,
        v_place_id, v_producer_id, v_product_id, v_release_id, v_color,
        pg_catalog.jsonb_build_object('editorial_assessment',true,
            'subject_kind',p_subject_kind,'rationale',pg_catalog.btrim(p_rationale)),
        'reviewed', auth.uid(), now()
    );
    insert into private.drinking_window_editorial_contexts(
        evidence_id, version_id, subject_kind, subject_id, author_id,
        rationale, supporting_urls
    ) values(v_evidence_id, p_version_id, p_subject_kind, p_subject_id,
        auth.uid(), pg_catalog.btrim(p_rationale), p_supporting_urls);
    insert into public.drinking_window_reference_evidence(
        version_id, ageing_group_id, membership_id, evidence_id, claim_part, evidence_role
    ) values(
        p_version_id,
        case when p_subject_kind = 'group' then p_subject_id else null end,
        case when p_subject_kind = 'membership' then p_subject_id else null end,
        v_evidence_id, v_claim_part, 'supports'
    );
    return pg_catalog.jsonb_build_object('evidence_id',v_evidence_id,
        'source_url',v_note_url,'published',false);
end;
$$;
revoke all on function public.attest_drinking_window_editorial_context(uuid,text,uuid,text,text,text[],boolean)
from public, anon;
grant execute on function public.attest_drinking_window_editorial_context(uuid,text,uuid,text,text,text[],boolean)
to authenticated;

create function public.get_drinking_window_editorial_context(p_evidence_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_note private.drinking_window_editorial_contexts%rowtype;
begin
    if auth.uid() is null then
        raise exception using errcode = '42501', message = 'Sign in to read this shared assessment';
    end if;
    select * into v_note from private.drinking_window_editorial_contexts
    where evidence_id = p_evidence_id;
    if not found or not exists (
        select 1 from public.drinking_window_reference_evidence l
        join public.drinking_window_reference_versions v on v.id = l.version_id
        where l.evidence_id = p_evidence_id and v.status = 'active'
    ) and not exists (
        select 1 from public.enrichment_curator_eligibilities c
        where c.user_id = auth.uid() and c.eligibility_status = 'active'
          and 'drinking-window' = any(c.profile_scopes)
    ) then
        raise exception using errcode = '22023', message = 'Assessment not available';
    end if;
    return pg_catalog.jsonb_build_object(
        'subject_kind',v_note.subject_kind,'rationale',v_note.rationale,
        'supporting_urls',to_jsonb(v_note.supporting_urls),
        'attribution','CellarManager editorial group assessment; not a producer-published classification',
        'consented_at',v_note.consented_at
    );
end;
$$;
revoke all on function public.get_drinking_window_editorial_context(uuid) from public, anon;
grant execute on function public.get_drinking_window_editorial_context(uuid) to authenticated;

commit;
