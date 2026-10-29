begin;

create table private.drinking_window_fallback_corrections (
    id bigint generated always as identity primary key,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    subject_kind text not null check (subject_kind in ('row','group','membership')),
    subject_id uuid not null,
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    before_hash text not null check (before_hash ~ '^[0-9a-f]{64}$'),
    after_hash text not null check (after_hash ~ '^[0-9a-f]{64}$'),
    before_state jsonb not null,
    after_state jsonb not null,
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_fallback_corrections
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_fallback_corrections to service_role;
create trigger drinking_window_fallback_corrections_immutable
before update or delete on private.drinking_window_fallback_corrections
for each row execute function private.reject_drinking_window_shadow_update();

create function public.get_drinking_window_fallback_subject(
    p_version_id uuid, p_kind text, p_subject_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft') then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    if p_kind = 'row' then
        select to_jsonb(r) into v_result from public.drinking_window_reference_rows r
        where r.id = p_subject_id and r.version_id = p_version_id
          and r.scope <> 'release';
    elsif p_kind = 'group' then
        select to_jsonb(g) into v_result from public.drinking_window_ageing_groups g
        where g.id = p_subject_id and g.version_id = p_version_id;
    elsif p_kind = 'membership' then
        select to_jsonb(m) into v_result from public.drinking_window_ageing_group_memberships m
        where m.id = p_subject_id and m.version_id = p_version_id;
        if v_result is not null then
            v_result := v_result || pg_catalog.jsonb_build_object(
                'target_label', case v_result ->> 'member_kind'
                    when 'place' then (select p.canonical_name from public.enrichment_places p
                        where p.id = (v_result ->> 'member_place_id')::uuid)
                    when 'product' then (select p.canonical_name from public.wine_reference_products p
                        where p.id = (v_result ->> 'member_product_id')::uuid)
                    else (select p.canonical_name || ' · ' || r.vintage_year::text
                        from public.wine_reference_releases r
                        join public.wine_reference_products p on p.id = r.product_id
                        where r.id = (v_result ->> 'member_release_id')::uuid) end,
                'place_label', (select p.canonical_name from public.enrichment_places p
                    where p.id = (v_result ->> 'member_place_id')::uuid)
            );
        end if;
    end if;
    if v_result is null then
        raise exception using errcode = '22023', message = 'Fallback subject not found';
    end if;
    return v_result || pg_catalog.jsonb_build_object('hash',
        private.drinking_window_review_subject_hash(p_version_id,p_kind,p_subject_id));
end;
$$;
revoke all on function public.get_drinking_window_fallback_subject(uuid,text,uuid) from public, anon;
grant execute on function public.get_drinking_window_fallback_subject(uuid,text,uuid) to authenticated;

create function public.correct_drinking_window_fallback_subject(
    p_version_id uuid, p_kind text, p_subject_id uuid,
    p_expected_hash text, p_changes jsonb
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
    v_group public.drinking_window_ageing_groups%rowtype;
    v_row public.drinking_window_reference_rows%rowtype;
    v_member public.drinking_window_ageing_group_memberships%rowtype;
    v_before jsonb;
    v_after jsonb;
    v_before_hash text;
    v_after_hash text;
    v_kind text;
    v_target uuid;
    v_place uuid;
    v_product_producer uuid;
    v_first integer;
    v_last integer;
    v_rationale text;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft')
       or p_kind not in ('row','group','membership')
       or p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' then
        raise exception using errcode = '22023', message = 'Choose a current fallback subject';
    end if;
    if p_kind = 'row' then
        select * into v_row from public.drinking_window_reference_rows
        where id = p_subject_id and version_id = p_version_id and scope <> 'release' for update;
        v_before := to_jsonb(v_row);
    elsif p_kind = 'group' then
        select * into v_group from public.drinking_window_ageing_groups
        where id = p_subject_id and version_id = p_version_id for update;
        v_before := to_jsonb(v_group);
    else
        select * into v_member from public.drinking_window_ageing_group_memberships
        where id = p_subject_id and version_id = p_version_id for update;
        v_before := to_jsonb(v_member);
    end if;
    if not found then
        raise exception using errcode = '22023', message = 'Fallback subject not found';
    end if;
    v_before_hash := private.drinking_window_review_subject_hash(p_version_id,p_kind,p_subject_id);
    if p_expected_hash is distinct from v_before_hash then
        raise exception using errcode = '40001', message = 'This subject changed; refresh before correcting it';
    end if;
    if p_kind = 'row' then
        if coalesce(p_changes ->> 'first_trial_year','') !~ '^[0-9]{4}$'
           or coalesce(p_changes ->> 'best_start_year','') !~ '^[0-9]{4}$'
           or coalesce(p_changes ->> 'best_end_year','') !~ '^[0-9]{4}$'
           or length(pg_catalog.btrim(coalesce(p_changes ->> 'rationale',''))) not between 20 and 2000 then
            raise exception using errcode = '22023', message = 'Provide three years and a reason';
        end if;
        v_first := (p_changes ->> 'first_trial_year')::integer;
        v_last := (p_changes ->> 'best_end_year')::integer;
        if v_first < v_row.vintage_year
           or v_first > (p_changes ->> 'best_start_year')::integer
           or (p_changes ->> 'best_start_year')::integer > v_last
           or v_last > 2300 then
            raise exception using errcode = '22023', message = 'Three dates are not ordered';
        end if;
        if (v_row.first_trial_year,v_row.best_start_year,v_row.best_end_year,v_row.rationale)
           is not distinct from (v_first,(p_changes ->> 'best_start_year')::integer,
               v_last,pg_catalog.btrim(p_changes ->> 'rationale')) then
            return v_before_hash;
        end if;
        delete from public.drinking_window_reference_evidence
        where version_id = p_version_id and reference_row_id = p_subject_id
          and claim_part in ('first_trial','optimal_period');
        update public.drinking_window_reference_rows set
            first_trial_year = v_first,
            best_start_year = (p_changes ->> 'best_start_year')::integer,
            best_end_year = v_last,
            rationale = pg_catalog.btrim(p_changes ->> 'rationale')
        where id = p_subject_id;
        select to_jsonb(r) into v_after from public.drinking_window_reference_rows r
        where r.id = p_subject_id;
    elsif p_kind = 'group' then
        if length(pg_catalog.btrim(coalesce(p_changes ->> 'group_key',''))) not between 2 and 80
           or length(pg_catalog.btrim(coalesce(p_changes ->> 'definition',''))) not between 20 and 2000 then
            raise exception using errcode = '22023', message = 'Provide a group name and definition';
        end if;
        if (v_group.group_key,v_group.definition) is not distinct from
           (pg_catalog.btrim(p_changes ->> 'group_key'),
            pg_catalog.btrim(p_changes ->> 'definition')) then
            return v_before_hash;
        end if;
        delete from public.drinking_window_reference_evidence
        where version_id = p_version_id and ageing_group_id = p_subject_id;
        update public.drinking_window_ageing_groups set
            group_key = pg_catalog.btrim(p_changes ->> 'group_key'),
            definition = pg_catalog.btrim(p_changes ->> 'definition')
        where id = p_subject_id;
        select to_jsonb(g) into v_after from public.drinking_window_ageing_groups g
        where g.id = p_subject_id;
    else
        v_kind := p_changes ->> 'member_kind';
        if v_kind not in ('place','product','release')
           or coalesce(p_changes ->> 'target_id','') !~ '^[0-9a-f-]{36}$'
           or coalesce(p_changes ->> 'place_id','') !~ '^[0-9a-f-]{36}$'
           or length(pg_catalog.btrim(coalesce(p_changes ->> 'rationale',''))) not between 20 and 1000
           or (p_changes ->> 'first_vintage_year' is null)
                <> (p_changes ->> 'last_vintage_year' is null) then
            raise exception using errcode = '22023', message = 'Provide a confirmed member and vintage range';
        end if;
        v_target := (p_changes ->> 'target_id')::uuid;
        v_place := (p_changes ->> 'place_id')::uuid;
        v_first := (p_changes ->> 'first_vintage_year')::integer;
        v_last := (p_changes ->> 'last_vintage_year')::integer;
        if v_first is not null and (v_first < 1800 or v_last > 2200 or v_first > v_last) then
            raise exception using errcode = '22023', message = 'Invalid member vintage range';
        end if;
        select * into v_group from public.drinking_window_ageing_groups
        where id = v_member.group_id;
        if v_kind = 'place' then
            if v_target <> v_place or not exists(select 1 from public.enrichment_places p
                where p.id = v_target) then
                raise exception using errcode = '22023', message = 'Choose an exact place';
            end if;
        elsif v_kind = 'product' then
            select producer_id into v_product_producer from public.wine_reference_products
            where id = v_target;
            if not found then raise exception using errcode = '22023', message = 'Choose a canonical cuvée'; end if;
        else
            select product.producer_id into v_product_producer
            from public.wine_reference_releases release
            join public.wine_reference_products product on product.id = release.product_id
            where release.id = v_target;
            if not found then raise exception using errcode = '22023', message = 'Choose a canonical release'; end if;
        end if;
        if not private.drinking_window_place_contains(
            coalesce(v_group.appellation_id,v_group.region_id),v_place)
           or (v_group.producer_id is not null and v_product_producer is not null
               and v_product_producer <> v_group.producer_id) then
            raise exception using errcode = '22023', message = 'Member is outside this group';
        end if;
        if (v_member.member_kind,v_member.member_place_id,v_member.member_product_id,
            v_member.member_release_id,v_member.first_vintage_year,
            v_member.last_vintage_year,v_member.rationale)
           is not distinct from (v_kind,v_place,
            case when v_kind = 'product' then v_target else null end,
            case when v_kind = 'release' then v_target else null end,
            v_first,v_last,pg_catalog.btrim(p_changes ->> 'rationale')) then
            return v_before_hash;
        end if;
        delete from public.drinking_window_reference_evidence
        where version_id = p_version_id and membership_id = p_subject_id;
        update public.drinking_window_ageing_group_memberships set
            member_kind = v_kind,
            member_place_id = v_place,
            member_product_id = case when v_kind = 'product' then v_target else null end,
            member_release_id = case when v_kind = 'release' then v_target else null end,
            first_vintage_year = v_first, last_vintage_year = v_last,
            rationale = pg_catalog.btrim(p_changes ->> 'rationale')
        where id = p_subject_id;
        select to_jsonb(m) into v_after from public.drinking_window_ageing_group_memberships m
        where m.id = p_subject_id;
    end if;
    v_after_hash := private.drinking_window_review_subject_hash(p_version_id,p_kind,p_subject_id);
    if v_after_hash is distinct from v_before_hash then
        insert into private.drinking_window_fallback_corrections(
            version_id,subject_kind,subject_id,curator_id,before_hash,after_hash,
            before_state,after_state
        ) values(p_version_id,p_kind,p_subject_id,auth.uid(),v_before_hash,
            v_after_hash,v_before,v_after);
    end if;
    return v_after_hash;
end;
$$;
revoke all on function public.correct_drinking_window_fallback_subject(uuid,text,uuid,text,jsonb)
from public, anon;
grant execute on function public.correct_drinking_window_fallback_subject(uuid,text,uuid,text,jsonb)
to authenticated;

commit;
