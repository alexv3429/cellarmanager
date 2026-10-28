begin;

-- Staging is deliberately separate from candidate review and publication.
-- Every staging creates a new draft version, preserving the base version and
-- its owner comparisons. Carried-forward subjects must be reviewed again.
create table private.drinking_window_candidate_stagings (
    review_id uuid primary key references private.drinking_window_candidate_review_drafts(id),
    candidate_id uuid not null references public.drinking_window_candidates(id),
    base_version_id uuid not null references public.drinking_window_reference_versions(id),
    draft_version_id uuid not null unique references public.drinking_window_reference_versions(id),
    reference_row_id uuid not null unique references public.drinking_window_reference_rows(id),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_candidate_stagings
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_candidate_stagings to service_role;

create function public.stage_drinking_window_candidate_as_draft(
    p_candidate_id uuid,
    p_expected_review_id uuid,
    p_base_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate public.drinking_window_candidates%rowtype;
    v_review private.drinking_window_candidate_review_drafts%rowtype;
    v_base public.drinking_window_reference_versions%rowtype;
    v_release_id uuid;
    v_product_id uuid;
    v_producer_id uuid;
    v_product_name text;
    v_producer_name text;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_format_ml integer;
    v_new_version_id uuid := pg_catalog.gen_random_uuid();
    v_new_row_id uuid := pg_catalog.gen_random_uuid();
    v_group_map jsonb := '{}'::jsonb;
    v_row_map jsonb := '{}'::jsonb;
    v_member_map jsonb := '{}'::jsonb;
    v_group public.drinking_window_ageing_groups%rowtype;
    v_row public.drinking_window_reference_rows%rowtype;
    v_member public.drinking_window_ageing_group_memberships%rowtype;
    v_link public.drinking_window_reference_evidence%rowtype;
    v_new_id uuid;
    v_existing record;
    v_new_version_number integer;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_candidate_id is null or p_expected_review_id is null or p_base_version_id is null then
        raise exception using errcode = '22023', message = 'Choose a reviewed suggestion and a base version';
    end if;
    -- Serialise version allocation and the same candidate being staged twice.
    perform pg_catalog.pg_advisory_xact_lock(927412, 1);
    select s.base_version_id, s.draft_version_id, s.reference_row_id,
        version.version_number into v_existing
    from private.drinking_window_candidate_stagings s
    join public.drinking_window_reference_versions version on version.id = s.draft_version_id
    where s.review_id = p_expected_review_id;
    if found then
        if v_existing.base_version_id <> p_base_version_id then
            raise exception using errcode = '40001',
                message = 'This review was already staged from a different base version';
        end if;
        return pg_catalog.jsonb_build_object('version_id', v_existing.draft_version_id,
            'version_number', v_existing.version_number,
            'row_id', v_existing.reference_row_id, 'already_staged', true);
    end if;
    select * into v_candidate from public.drinking_window_candidates
    where id = p_candidate_id and review_status <> 'rejected' for share;
    if not found or v_candidate.candidate_scope <> 'release'
       or v_candidate.source_identity ->> 'origin' is distinct from 'cellar-owner-proposal' then
        raise exception using errcode = '22023', message = 'An exact-release owner suggestion is required';
    end if;
    select * into v_review from private.drinking_window_candidate_review_drafts
    where candidate_id = p_candidate_id order by created_at desc, id desc limit 1;
    if not found or v_review.id <> p_expected_review_id
       or v_review.disposition <> 'propose' or v_review.proposed_scope <> 'release'
       or v_review.rights_status <> 'reuse-allowed'
       or v_review.first_trial_year is null or v_review.best_start_year is null
       or v_review.best_end_year is null then
        raise exception using errcode = '40001',
            message = 'The latest review must propose a complete exact-release window';
    end if;
    select * into v_base from public.drinking_window_reference_versions
    where id = p_base_version_id and status in ('draft', 'active') for share;
    if not found then
        raise exception using errcode = '22023', message = 'Choose a current draft or active base version';
    end if;
    if v_candidate.source_identity ->> 'release_id' is null
       or v_candidate.source_identity ->> 'format_ml' is null
       or v_candidate.source_identity ->> 'format_ml' !~ '^[0-9]{2,5}$'
       or v_candidate.source_identity ->> 'region' is null
       or v_candidate.source_identity ->> 'appellation' is null then
        raise exception using errcode = '22023', message = 'The suggestion needs an exact release, size and places';
    end if;
    v_release_id := (v_candidate.source_identity ->> 'release_id')::uuid;
    v_format_ml := (v_candidate.source_identity ->> 'format_ml')::integer;
    select product.id, product.producer_id, product.canonical_name,
        producer.canonical_name
    into v_product_id, v_producer_id, v_product_name, v_producer_name
    from public.wine_reference_releases release
    join public.wine_reference_products product on product.id = release.product_id
    join public.wine_reference_producers producer on producer.id = product.producer_id
    where release.id = v_release_id
      and release.vintage_year = v_candidate.vintage_year;
    if not found or v_format_ml not between 50 and 30000
       or v_candidate.wine_color is null
       or v_candidate.wine_color not in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
       or private.normalize_wine_reference_text(v_candidate.source_identity ->> 'producer')
          is distinct from private.normalize_wine_reference_text(v_producer_name)
       or private.normalize_wine_reference_text(v_candidate.source_identity ->> 'cuvee')
          is distinct from private.normalize_wine_reference_text(v_product_name)
       or v_review.first_trial_year < v_candidate.vintage_year then
        raise exception using errcode = '22023', message = 'Release, format, color or dates no longer match';
    end if;
    select pg_catalog.array_agg(distinct p.id) into v_region_ids from (
        select place.id from public.enrichment_places place
        where place.place_type in ('region', 'subregion')
          and place.normalized_name = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'region')
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type in ('region', 'subregion')
          and alias.normalized_value = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'region')
    ) p;
    select pg_catalog.array_agg(distinct p.id) into v_appellation_ids from (
        select place.id from public.enrichment_places place
        where place.place_type = 'appellation'
          and place.normalized_name = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'appellation')
        union
        select place.id from public.enrichment_place_aliases alias
        join public.enrichment_places place on place.id = alias.place_id
        where place.place_type = 'appellation'
          and alias.normalized_value = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'appellation')
    ) p;
    if coalesce(pg_catalog.cardinality(v_region_ids), 0) <> 1
       or coalesce(pg_catalog.cardinality(v_appellation_ids), 0) <> 1 then
        raise exception using errcode = '22023',
            message = 'Region or appellation is not uniquely confirmed in the shared dictionary';
    end if;
    v_region_id := v_region_ids[1];
    v_appellation_id := v_appellation_ids[1];
    if not private.drinking_window_place_contains(v_region_id, v_appellation_id) then
        raise exception using errcode = '22023', message = 'Appellation is outside the confirmed region';
    end if;
    -- A base may be edited by a trusted operator. Copy one stable snapshot,
    -- then release the locks at transaction end; readers remain unaffected.
    lock table public.drinking_window_ageing_groups,
        public.drinking_window_reference_rows,
        public.drinking_window_ageing_group_memberships,
        public.drinking_window_reference_evidence in share mode;
    if exists (
        select 1 from public.drinking_window_reference_rows row
        where row.version_id = v_base.id and row.scope = 'release'
          and row.release_id = v_release_id
          and (row.format_ml is null or row.format_ml = v_format_ml)
          and row.wine_color = v_candidate.wine_color and row.vintage_year = v_candidate.vintage_year
    ) then
        raise exception using errcode = '23505',
            message = 'This release already has a row in the base version; correct it instead of adding a duplicate';
    end if;

    select coalesce(pg_catalog.max(version_number), 0) + 1 into v_new_version_number
    from public.drinking_window_reference_versions;
    insert into public.drinking_window_reference_versions (id, version_number)
    values (v_new_version_id, v_new_version_number);
    for v_group in select * from public.drinking_window_ageing_groups
        where version_id = v_base.id order by id loop
        v_new_id := pg_catalog.gen_random_uuid();
        insert into public.drinking_window_ageing_groups (
            id, version_id, scope, region_id, wine_color, group_key, definition,
            producer_id, appellation_id
        ) values (
            v_new_id, v_new_version_id, v_group.scope, v_group.region_id,
            v_group.wine_color, v_group.group_key, v_group.definition,
            v_group.producer_id, v_group.appellation_id
        );
        v_group_map := v_group_map || pg_catalog.jsonb_build_object(v_group.id::text, v_new_id);
    end loop;
    for v_row in select * from public.drinking_window_reference_rows
        where version_id = v_base.id order by id loop
        v_new_id := pg_catalog.gen_random_uuid();
        insert into public.drinking_window_reference_rows (
            id, version_id, scope, producer_id, product_id, release_id,
            appellation_id, region_id, wine_color, vintage_year, ageing_group_id,
            all_at_scope, first_trial_year, best_start_year, best_end_year,
            rationale, format_ml
        ) values (
            v_new_id, v_new_version_id, v_row.scope, v_row.producer_id,
            v_row.product_id, v_row.release_id, v_row.appellation_id, v_row.region_id,
            v_row.wine_color, v_row.vintage_year,
            (v_group_map ->> v_row.ageing_group_id::text)::uuid,
            v_row.all_at_scope, v_row.first_trial_year, v_row.best_start_year,
            v_row.best_end_year, v_row.rationale, v_row.format_ml
        );
        v_row_map := v_row_map || pg_catalog.jsonb_build_object(v_row.id::text, v_new_id);
    end loop;
    for v_member in select * from public.drinking_window_ageing_group_memberships
        where version_id = v_base.id order by id loop
        v_new_id := pg_catalog.gen_random_uuid();
        insert into public.drinking_window_ageing_group_memberships (
            id, version_id, group_id, member_kind, member_place_id,
            member_product_id, member_release_id, first_vintage_year,
            last_vintage_year, rationale
        ) values (
            v_new_id, v_new_version_id,
            (v_group_map ->> v_member.group_id::text)::uuid,
            v_member.member_kind, v_member.member_place_id,
            v_member.member_product_id, v_member.member_release_id,
            v_member.first_vintage_year, v_member.last_vintage_year,
            v_member.rationale
        );
        v_member_map := v_member_map || pg_catalog.jsonb_build_object(v_member.id::text, v_new_id);
    end loop;
    for v_link in select * from public.drinking_window_reference_evidence
        where version_id = v_base.id order by id loop
        insert into public.drinking_window_reference_evidence (
            version_id, reference_row_id, ageing_group_id, membership_id,
            evidence_id, claim_part, evidence_role
        ) values (
            v_new_version_id,
            (v_row_map ->> v_link.reference_row_id::text)::uuid,
            (v_group_map ->> v_link.ageing_group_id::text)::uuid,
            (v_member_map ->> v_link.membership_id::text)::uuid,
            v_link.evidence_id, v_link.claim_part, v_link.evidence_role
        );
    end loop;
    insert into public.drinking_window_reference_rows (
        id, version_id, scope, producer_id, product_id, release_id,
        appellation_id, region_id, wine_color, vintage_year, format_ml,
        all_at_scope, first_trial_year, best_start_year, best_end_year,
        rationale
    ) values (
        v_new_row_id, v_new_version_id, 'release', v_producer_id, v_product_id,
        v_release_id, v_appellation_id, v_region_id, v_candidate.wine_color,
        v_candidate.vintage_year, v_format_ml, true,
        v_review.first_trial_year, v_review.best_start_year, v_review.best_end_year,
        v_review.rationale
    );
    insert into private.drinking_window_candidate_stagings (
        review_id, candidate_id, base_version_id, draft_version_id,
        reference_row_id, curator_id
    ) values (
        v_review.id, v_candidate.id, v_base.id, v_new_version_id,
        v_new_row_id, auth.uid()
    );
    return pg_catalog.jsonb_build_object('version_id', v_new_version_id,
        'version_number', v_new_version_number,
        'row_id', v_new_row_id, 'already_staged', false);
end;
$$;

revoke all on function public.stage_drinking_window_candidate_as_draft(uuid, uuid, uuid)
from public, anon;
grant execute on function public.stage_drinking_window_candidate_as_draft(uuid, uuid, uuid)
to authenticated;

commit;
