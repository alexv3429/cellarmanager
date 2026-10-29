begin;

-- A producer exchange file enters the shared *candidate* queue, never the
-- published reference. Only an explicitly scoped curator may submit it.
-- Keep a compact review packet, not the original research file or raw pages.
create function public.submit_drinking_window_producer_profile(
    p_package_sha256 text,
    p_producer_name text,
    p_dataset_version text,
    p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item jsonb;
    v_identity jsonb;
    v_locator text;
    v_year integer;
    v_format integer;
    v_first integer;
    v_start integer;
    v_end integer;
    v_inserted integer := 0;
    v_total integer := 0;
    v_url text;
    v_existing public.drinking_window_candidates%rowtype;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_package_sha256 is null or p_package_sha256 !~ '^[0-9a-f]{64}$'
       or p_producer_name is null or length(pg_catalog.btrim(p_producer_name)) not between 2 and 200
       or p_dataset_version is null or length(pg_catalog.btrim(p_dataset_version)) not between 1 and 80
       or p_candidates is null or pg_catalog.jsonb_typeof(p_candidates) <> 'array'
       or pg_catalog.jsonb_array_length(p_candidates) not between 1 and 100 then
        raise exception using errcode = '22023', message = 'Invalid producer profile batch';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_candidates) loop
        v_total := v_total + 1;
        if pg_catalog.jsonb_typeof(v_item) <> 'object'
           or coalesce(v_item ->> 'cuvee_id', '') !~ '^[a-z0-9][a-z0-9_-]{0,119}$'
           or length(pg_catalog.btrim(coalesce(v_item ->> 'cuvee', ''))) not between 2 and 200
           or length(pg_catalog.btrim(coalesce(v_item ->> 'appellation', ''))) not between 2 and 200
           or length(pg_catalog.btrim(coalesce(v_item ->> 'region', ''))) not between 2 and 200
           or coalesce(v_item ->> 'color', '') not in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
           or v_item ->> 'review_status' is distinct from 'candidate_not_approved'
           or pg_catalog.jsonb_typeof(v_item -> 'evidence_urls') <> 'array'
           or pg_catalog.jsonb_array_length(v_item -> 'evidence_urls') not between 1 and 10
           or length(pg_catalog.btrim(coalesce(v_item ->> 'rationale', ''))) not between 10 and 2000
           or coalesce(v_item ->> 'vintage', '') !~ '^[0-9]{4}$'
           or coalesce(v_item ->> 'format_ml', '') !~ '^[0-9]{2,5}$'
           or coalesce(v_item ->> 'first_trial_year', '') !~ '^[0-9]{4}$'
           or coalesce(v_item ->> 'best_start_year', '') !~ '^[0-9]{4}$'
           or coalesce(v_item ->> 'best_end_year', '') !~ '^[0-9]{4}$' then
            raise exception using errcode = '22023', message = 'Invalid exact-release candidate in producer profile';
        end if;
        v_year := (v_item ->> 'vintage')::integer;
        v_format := (v_item ->> 'format_ml')::integer;
        v_first := (v_item ->> 'first_trial_year')::integer;
        v_start := (v_item ->> 'best_start_year')::integer;
        v_end := (v_item ->> 'best_end_year')::integer;
        if v_year not between 1800 and 2200 or v_format not between 50 and 30000
           or v_first < v_year or v_first > v_start or v_start > v_end or v_end > 2300 then
            raise exception using errcode = '22023', message = 'Invalid format or three-date sequence';
        end if;
        for v_url in select value #>> '{}' from pg_catalog.jsonb_array_elements(v_item -> 'evidence_urls') loop
            if v_url is null or length(v_url) > 1000 or v_url !~ '^https://[^[:space:]]+$' then
                raise exception using errcode = '22023', message = 'Invalid source pointer in producer profile';
            end if;
        end loop;
        v_locator := 'producer-exchange:' || (v_item ->> 'cuvee_id') || ':'
            || v_year::text || ':' || v_format::text;
        v_identity := pg_catalog.jsonb_build_object(
            'origin', 'producer-exchange',
            'producer', pg_catalog.btrim(p_producer_name),
            'cuvee', pg_catalog.btrim(v_item ->> 'cuvee'),
            'cuvee_id', v_item ->> 'cuvee_id',
            'appellation', pg_catalog.btrim(v_item ->> 'appellation'),
            'region', pg_catalog.btrim(v_item ->> 'region'),
            'format_ml', v_format,
            'dataset_version', pg_catalog.btrim(p_dataset_version),
            'rationale', pg_catalog.btrim(v_item ->> 'rationale'),
            'evidence_urls', v_item -> 'evidence_urls',
            'confidence', v_item ->> 'confidence',
            'date_origin', v_item ->> 'date_origin'
        );
        insert into public.drinking_window_candidates (
            source_sha256, source_locator, candidate_scope, source_identity,
            wine_color, vintage_year, first_trial_year, best_start_year,
            best_end_year, review_status, review_reason
        ) values (
            p_package_sha256, v_locator, 'release', v_identity,
            v_item ->> 'color', v_year, v_first, v_start, v_end,
            'needs-review',
            'Producer exchange research only; canonical release, evidence and rights require review'
        ) on conflict (source_sha256, source_locator) do nothing;
        if found then
            v_inserted := v_inserted + 1;
        else
            select * into v_existing from public.drinking_window_candidates
            where source_sha256 = p_package_sha256 and source_locator = v_locator;
            if v_existing.source_identity is distinct from v_identity
               or v_existing.wine_color is distinct from v_item ->> 'color'
               or v_existing.vintage_year is distinct from v_year
               or v_existing.first_trial_year is distinct from v_first
               or v_existing.best_start_year is distinct from v_start
               or v_existing.best_end_year is distinct from v_end then
                raise exception using errcode = '40001',
                    message = 'This profile hash already contains a different proposal';
            end if;
        end if;
    end loop;
    return pg_catalog.jsonb_build_object('submitted', v_total,
        'inserted', v_inserted, 'already_present', v_total - v_inserted,
        'package_sha256', p_package_sha256, 'published', false);
end;
$$;

revoke all on function public.submit_drinking_window_producer_profile(text, text, text, jsonb)
from public, anon;
grant execute on function public.submit_drinking_window_producer_profile(text, text, text, jsonb)
to authenticated;

create function public.get_drinking_window_producer_profile_imports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    return coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'package_sha256', source_sha256,
            'producer', source_identity ->> 'producer',
            'dataset_version', source_identity ->> 'dataset_version',
            'candidate_count', candidate_count
        ) order by producer_name)
        from (
            select source_sha256, source_identity ->> 'producer' as producer_name,
                source_identity ->> 'dataset_version' as dataset_version,
                pg_catalog.count(*) as candidate_count,
                pg_catalog.jsonb_build_object('producer', source_identity ->> 'producer',
                    'dataset_version', source_identity ->> 'dataset_version') as source_identity
            from public.drinking_window_candidates
            where source_identity ->> 'origin' = 'producer-exchange'
            group by source_sha256, source_identity ->> 'producer',
                source_identity ->> 'dataset_version'
        ) imports
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_drinking_window_producer_profile_imports()
from public, anon;
grant execute on function public.get_drinking_window_producer_profile_imports()
to authenticated;

create function public.get_drinking_window_producer_profile_candidates(p_package_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_package_sha256 is null or p_package_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception using errcode = '22023', message = 'Choose an imported producer profile';
    end if;
    return pg_catalog.jsonb_build_object(
        'eligible', true, 'identity_requests', '[]'::jsonb,
        'candidates', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', candidate.id,
                'source_locator', candidate.source_locator,
                'source_identity', candidate.source_identity,
                'candidate_scope', candidate.candidate_scope,
                'review_reason', candidate.review_reason,
                'wine_color', candidate.wine_color,
                'vintage_year', candidate.vintage_year,
                'first_trial_year', candidate.first_trial_year,
                'best_start_year', candidate.best_start_year,
                'best_end_year', candidate.best_end_year,
                'review', case when draft.id is null then null else
                    pg_catalog.jsonb_build_object(
                        'id', draft.id,
                        'proposed_scope', draft.proposed_scope,
                        'first_trial_year', draft.first_trial_year,
                        'best_start_year', draft.best_start_year,
                        'best_end_year', draft.best_end_year,
                        'ageing_group_note', draft.ageing_group_note,
                        'rationale', draft.rationale,
                        'evidence_urls', draft.evidence_urls,
                        'rights_status', draft.rights_status,
                        'disposition', draft.disposition,
                        'created_at', draft.created_at
                    ) end
            ) order by candidate.vintage_year desc, candidate.source_locator)
            from public.drinking_window_candidates candidate
            left join lateral (
                select * from private.drinking_window_candidate_review_drafts review
                where review.candidate_id = candidate.id
                order by review.created_at desc, review.id desc limit 1
            ) draft on true
            where candidate.source_sha256 = p_package_sha256
              and candidate.source_identity ->> 'origin' = 'producer-exchange'
              and candidate.review_status <> 'rejected'
        ), '[]'::jsonb)
    );
end;
$$;

revoke all on function public.get_drinking_window_producer_profile_candidates(text)
from public, anon;
grant execute on function public.get_drinking_window_producer_profile_candidates(text)
to authenticated;

create table private.drinking_window_producer_candidate_stagings (
    review_id uuid primary key references private.drinking_window_candidate_review_drafts(id),
    candidate_id uuid not null references public.drinking_window_candidates(id),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    reference_row_id uuid not null unique references public.drinking_window_reference_rows(id),
    release_id uuid not null references public.wine_reference_releases(id),
    identity_reason text not null check (length(pg_catalog.btrim(identity_reason)) between 10 and 1000),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_producer_candidate_stagings
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_producer_candidate_stagings to service_role;

create function public.search_drinking_window_producer_candidate_releases(
    p_candidate_id uuid,
    p_query text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_candidate public.drinking_window_candidates%rowtype;
    v_query text := private.normalize_wine_reference_text(p_query);
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select * into v_candidate from public.drinking_window_candidates
    where id = p_candidate_id and source_identity ->> 'origin' = 'producer-exchange';
    if not found or pg_catalog.length(v_query) not between 2 and 100 then
        raise exception using errcode = '22023', message = 'Choose a profile proposal and search text';
    end if;
    return coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'release_id', result.id,
            'producer', result.producer,
            'cuvee', result.cuvee,
            'vintage', result.vintage
        ) order by result.producer, result.cuvee, result.id)
        from (
            select release.id, producer.canonical_name as producer,
                product.canonical_name as cuvee, release.vintage_year as vintage
            from public.wine_reference_releases release
            join public.wine_reference_products product on product.id = release.product_id
            join public.wine_reference_producers producer on producer.id = product.producer_id
            where release.vintage_year = v_candidate.vintage_year
              and (
                  pg_catalog.strpos(private.normalize_wine_reference_text(producer.canonical_name), v_query) > 0
                  or pg_catalog.strpos(private.normalize_wine_reference_text(product.canonical_name), v_query) > 0
                  or pg_catalog.strpos(private.normalize_wine_reference_text(
                      producer.canonical_name || ' ' || product.canonical_name), v_query) > 0
              )
            order by producer.canonical_name, product.canonical_name, release.id
            limit 25
        ) result
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.search_drinking_window_producer_candidate_releases(uuid, text)
from public, anon;
grant execute on function public.search_drinking_window_producer_candidate_releases(uuid, text)
to authenticated;

create function public.stage_drinking_window_producer_candidate(
    p_candidate_id uuid,
    p_expected_review_id uuid,
    p_version_id uuid,
    p_release_id uuid,
    p_identity_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate public.drinking_window_candidates%rowtype;
    v_review private.drinking_window_candidate_review_drafts%rowtype;
    v_version public.drinking_window_reference_versions%rowtype;
    v_product_id uuid;
    v_producer_id uuid;
    v_appellation_ids uuid[];
    v_region_ids uuid[];
    v_appellation_id uuid;
    v_region_id uuid;
    v_format_ml integer;
    v_row_id uuid := pg_catalog.gen_random_uuid();
    v_existing private.drinking_window_producer_candidate_stagings%rowtype;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_candidate_id is null or p_expected_review_id is null or p_version_id is null
       or p_release_id is null or p_identity_reason is null
       or length(pg_catalog.btrim(p_identity_reason)) not between 10 and 1000 then
        raise exception using errcode = '22023', message = 'Review, exact release, reason and draft are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(927412, 2);
    select * into v_existing from private.drinking_window_producer_candidate_stagings
    where review_id = p_expected_review_id;
    if found then
        if v_existing.version_id <> p_version_id or v_existing.release_id <> p_release_id then
            raise exception using errcode = '40001', message = 'This proposal was already staged differently';
        end if;
        return pg_catalog.jsonb_build_object('row_id', v_existing.reference_row_id,
            'version_id', v_existing.version_id, 'already_staged', true);
    end if;
    select * into v_candidate from public.drinking_window_candidates
    where id = p_candidate_id and candidate_scope = 'release'
      and source_identity ->> 'origin' = 'producer-exchange'
      and review_status <> 'rejected' for share;
    if not found then
        raise exception using errcode = '22023', message = 'Research proposal not found';
    end if;
    select * into v_review from private.drinking_window_candidate_review_drafts
    where candidate_id = p_candidate_id order by created_at desc, id desc limit 1;
    if not found or v_review.id <> p_expected_review_id
       or v_review.proposed_scope <> 'release' or v_review.disposition <> 'propose'
       or v_review.rights_status <> 'reuse-allowed'
       or v_review.first_trial_year is null or v_review.best_start_year is null
       or v_review.best_end_year is null then
        raise exception using errcode = '40001', message = 'A current, complete review is required';
    end if;
    select * into v_version from public.drinking_window_reference_versions
    where id = p_version_id and status = 'draft' for update;
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished draft';
    end if;
    select product.id, product.producer_id into v_product_id, v_producer_id
    from public.wine_reference_releases release
    join public.wine_reference_products product on product.id = release.product_id
    where release.id = p_release_id and release.vintage_year = v_candidate.vintage_year;
    if not found or v_candidate.source_identity ->> 'format_ml' !~ '^[0-9]{2,5}$' then
        raise exception using errcode = '22023', message = 'The confirmed release or bottle size changed';
    end if;
    v_format_ml := (v_candidate.source_identity ->> 'format_ml')::integer;
    if v_format_ml not between 50 and 30000 then
        raise exception using errcode = '22023', message = 'Invalid bottle size';
    end if;
    select pg_catalog.array_agg(distinct place.id) into v_region_ids from (
        select p.id from public.enrichment_places p
        where p.place_type in ('region', 'subregion')
          and p.normalized_name = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'region')
        union
        select p.id from public.enrichment_place_aliases a
        join public.enrichment_places p on p.id = a.place_id
        where p.place_type in ('region', 'subregion')
          and a.normalized_value = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'region')
    ) place;
    select pg_catalog.array_agg(distinct place.id) into v_appellation_ids from (
        select p.id from public.enrichment_places p
        where p.place_type = 'appellation'
          and p.normalized_name = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'appellation')
        union
        select p.id from public.enrichment_place_aliases a
        join public.enrichment_places p on p.id = a.place_id
        where p.place_type = 'appellation'
          and a.normalized_value = private.normalize_wine_reference_text(v_candidate.source_identity ->> 'appellation')
    ) place;
    if coalesce(pg_catalog.cardinality(v_region_ids), 0) <> 1
       or coalesce(pg_catalog.cardinality(v_appellation_ids), 0) <> 1 then
        raise exception using errcode = '22023',
            message = 'The shared region and appellation must be uniquely confirmed';
    end if;
    v_region_id := v_region_ids[1];
    v_appellation_id := v_appellation_ids[1];
    if not private.drinking_window_place_contains(v_region_id, v_appellation_id) then
        raise exception using errcode = '22023', message = 'Appellation is outside the confirmed region';
    end if;
    if exists (select 1 from public.drinking_window_reference_rows row
        where row.version_id = p_version_id and row.scope = 'release'
          and row.release_id = p_release_id
          and (row.format_ml is null or row.format_ml = v_format_ml)
          and row.wine_color = v_candidate.wine_color
          and row.vintage_year = v_candidate.vintage_year) then
        raise exception using errcode = '23505',
            message = 'This draft already has a window for that exact release';
    end if;
    insert into public.drinking_window_reference_rows (
        id, version_id, scope, producer_id, product_id, release_id,
        appellation_id, region_id, wine_color, vintage_year, format_ml,
        all_at_scope, first_trial_year, best_start_year, best_end_year, rationale
    ) values (
        v_row_id, p_version_id, 'release', v_producer_id, v_product_id, p_release_id,
        v_appellation_id, v_region_id, v_candidate.wine_color, v_candidate.vintage_year,
        v_format_ml, true, v_review.first_trial_year, v_review.best_start_year,
        v_review.best_end_year, v_review.rationale
    );
    insert into private.drinking_window_producer_candidate_stagings (
        review_id, candidate_id, version_id, reference_row_id, release_id,
        identity_reason, curator_id
    ) values (
        v_review.id, v_candidate.id, p_version_id, v_row_id, p_release_id,
        pg_catalog.btrim(p_identity_reason), auth.uid()
    );
    return pg_catalog.jsonb_build_object('row_id', v_row_id,
        'version_id', p_version_id, 'already_staged', false);
end;
$$;

revoke all on function public.stage_drinking_window_producer_candidate(uuid, uuid, uuid, uuid, text)
from public, anon;
grant execute on function public.stage_drinking_window_producer_candidate(uuid, uuid, uuid, uuid, text)
to authenticated;

commit;
