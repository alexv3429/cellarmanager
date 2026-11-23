begin;

-- A preview can outgrow PostgREST's per-request time limit. Keep the cursor
-- and counters server-side, bound to the requesting curator and exact draft;
-- clients receive only aggregate counts, never household or wine identifiers.
create table private.drinking_window_impact_jobs (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    curator_id uuid not null references auth.users(id),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    last_wine_id uuid,
    max_wine_id uuid,
    wine_count integer not null default 0,
    matched_count integer not null default 0,
    changed_count integer not null default 0,
    unchanged_count integer not null default 0,
    private_preserved_count integer not null default 0,
    unresolved_count integer not null default 0,
    completed boolean not null default false,
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_impact_jobs from public, anon, authenticated, powersync_role;

create function public.start_drinking_window_impact_preview(p_version_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from public.drinking_window_reference_versions
                   where id=p_version_id and status='draft') then
        raise exception using errcode='22023', message='Choose an unpublished draft';
    end if;
    if exists (select 1 from public.drinking_window_publication_issues(p_version_id)) then
        raise exception using errcode='23514', message='Complete draft review before previewing publication';
    end if;
    insert into private.drinking_window_impact_jobs(version_id,curator_id,content_sha256,max_wine_id)
    values (p_version_id,auth.uid(),public.drinking_window_draft_fingerprint(p_version_id),
            (select id from public.wines where merged_into_wine_id is null order by id desc limit 1))
    returning id into v_id;
    return v_id;
end;
$$;

create function public.continue_drinking_window_impact_preview(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_job private.drinking_window_impact_jobs%rowtype;
    v_wine record;
    v_context jsonb;
    v_match record;
    v_current jsonb;
    v_projection jsonb;
    v_rules jsonb;
    v_wines integer;
    v_matched integer;
    v_changed integer;
    v_unchanged integer;
    v_private integer;
    v_unresolved integer;
    v_first integer;
    v_start integer;
    v_end integer;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_last uuid;
    v_done boolean;
    p_version_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select * into v_job from private.drinking_window_impact_jobs
    where id=p_job_id and curator_id=auth.uid() for update;
    if not found then
        raise exception using errcode='22023', message='Unknown impact preview';
    end if;
    if v_job.created_at < now() - interval '30 minutes' then
        raise exception using errcode='22023', message='Impact preview expired; start again';
    end if;
    p_version_id := v_job.version_id;
    if not exists (select 1 from public.drinking_window_reference_versions
                   where id=p_version_id and status='draft')
       or v_job.content_sha256 <> public.drinking_window_draft_fingerprint(p_version_id) then
        raise exception using errcode='40001', message='Draft changed during impact preview';
    end if;
    if v_job.completed then
        return pg_catalog.jsonb_build_object(
            'completed',true,'content_sha256',v_job.content_sha256,
            'wine_count',v_job.wine_count,'matched_count',v_job.matched_count,
            'changed_count',v_job.changed_count,'unchanged_count',v_job.unchanged_count,
            'private_preserved_count',v_job.private_preserved_count,'unresolved_count',v_job.unresolved_count);
    end if;
    v_wines := v_job.wine_count;
    v_matched := v_job.matched_count;
    v_changed := v_job.changed_count;
    v_unchanged := v_job.unchanged_count;
    v_private := v_job.private_preserved_count;
    v_unresolved := v_job.unresolved_count;
    v_last := v_job.last_wine_id;
    for v_wine in select w.* from public.wines w
        where w.merged_into_wine_id is null and w.id <= v_job.max_wine_id
          and (v_job.last_wine_id is null or w.id > v_job.last_wine_id)
        order by w.id limit 40 loop
        v_last := v_wine.id;
        v_wines := v_wines + 1;
        v_context := private.drinking_window_wine_context(v_wine.id);
        -- The context helper returns wine_reference_unlinked when its place,
        -- vintage and colour are confirmed but producer identity is absent.
        -- Such wines can still receive appellation or regional fallbacks.
        if v_context ->> 'status' = 'wine_reference_unlinked' then
            select pg_catalog.array_agg(distinct p.id) into v_region_ids from (
                select place.id from public.enrichment_places place
                where place.place_type in ('region', 'subregion')
                  and place.normalized_name = private.normalize_wine_reference_text(v_wine.area)
                union
                select place.id from public.enrichment_place_aliases alias
                join public.enrichment_places place on place.id = alias.place_id
                where place.place_type in ('region', 'subregion')
                  and alias.normalized_value = private.normalize_wine_reference_text(v_wine.area)
            ) p;
            if pg_catalog.cardinality(v_region_ids) = 1 then
                v_appellation_ids := null;
                if v_wine.appellation is not null and pg_catalog.btrim(v_wine.appellation) <> '' then
                    select pg_catalog.array_agg(distinct p.id) into v_appellation_ids from (
                        select place.id from public.enrichment_places place
                        where place.place_type = 'appellation'
                          and place.normalized_name = private.normalize_wine_reference_text(v_wine.appellation)
                        union
                        select place.id from public.enrichment_place_aliases alias
                        join public.enrichment_places place on place.id = alias.place_id
                        where place.place_type = 'appellation'
                          and alias.normalized_value = private.normalize_wine_reference_text(v_wine.appellation)
                    ) p;
                end if;
                if v_wine.appellation is null or pg_catalog.btrim(v_wine.appellation) = ''
                   or pg_catalog.cardinality(v_appellation_ids) = 1
                      and private.drinking_window_place_contains(v_region_ids[1], v_appellation_ids[1]) then
                    v_context := pg_catalog.jsonb_build_object(
                        'status', 'ready', 'region_id', v_region_ids[1],
                        'appellation_id', v_appellation_ids[1],
                        'wine_color', private.canonical_enrichment_wine_color(v_wine.color),
                        'vintage_year', v_wine.vintage
                    );
                end if;
            end if;
        end if;
        if v_context ->> 'status' <> 'ready' then
            v_unresolved := v_unresolved + 1;
            continue;
        end if;
        select * into v_match from private.drinking_window_preview_draft_match_for_wine(
            v_wine.id, p_version_id,
            (v_context ->> 'producer_id')::uuid,
            (v_context ->> 'product_id')::uuid,
            (v_context ->> 'release_id')::uuid,
            (v_context ->> 'appellation_id')::uuid,
            (v_context ->> 'region_id')::uuid,
            v_context ->> 'wine_color',
            (v_context ->> 'vintage_year')::integer,
            null
        );
        if v_match.status <> 'draft_match' then
            if v_match.status in ('ambiguous', 'identity_conflict', 'missing_key') then
                v_unresolved := v_unresolved + 1;
            end if;
            continue;
        end if;
        v_matched := v_matched + 1;
        if exists (select 1 from public.wine_maturity_overrides o
            where o.household_id = v_wine.household_id and o.wine_id = v_wine.id) then
            v_private := v_private + 1;
            continue;
        end if;
        v_rules := private.drinking_window_producer_rules_for_wine(v_wine.id);
        if v_rules -> 'selected' is not null and v_rules -> 'selected' <> 'null'::jsonb then
            v_private := v_private + 1;
            continue;
        end if;
        v_current := private.drinking_window_active_match(v_wine.id);
        v_first := null; v_start := null; v_end := null;
        if v_current ->> 'status' = 'match' then
            v_first := (v_current ->> 'first_trial_year')::integer;
            v_start := (v_current ->> 'best_start_year')::integer;
            v_end := (v_current ->> 'best_end_year')::integer;
        else
            select p.recommendation into v_projection
            from public.wine_enrichment_projections p
            where p.wine_id = v_wine.id and p.household_id = v_wine.household_id
              and p.projection_type = 'maturity' and p.context_key = ''
              and p.status = 'current' and p.valid_until > now()
            order by p.created_at desc limit 1;
            if found then
                v_first := (v_projection ->> 'first_trial_year')::integer;
                v_start := (v_projection ->> 'best_start_year')::integer;
                v_end := (v_projection ->> 'best_end_year')::integer;
            end if;
        end if;
        if (v_first, v_start, v_end) is not distinct from
           (v_match.first_trial_year, v_match.best_start_year, v_match.best_end_year) then
            v_unchanged := v_unchanged + 1;
        else
            v_changed := v_changed + 1;
        end if;
    end loop;
    if v_job.content_sha256 <> public.drinking_window_draft_fingerprint(p_version_id) then
        raise exception using errcode='40001', message='Draft changed during impact preview';
    end if;
    v_done := not exists (select 1 from public.wines w
        where w.merged_into_wine_id is null and w.id <= v_job.max_wine_id
          and (v_last is null or w.id > v_last));
    update private.drinking_window_impact_jobs set last_wine_id=v_last,
        wine_count=v_wines,matched_count=v_matched,changed_count=v_changed,
        unchanged_count=v_unchanged,private_preserved_count=v_private,
        unresolved_count=v_unresolved,completed=v_done where id=v_job.id;
    if v_done then
        insert into private.drinking_window_publication_impact_previews
            (version_id,curator_id,content_sha256,wine_count,matched_count,
             changed_count,unchanged_count,private_preserved_count,unresolved_count)
        values (p_version_id,auth.uid(),v_job.content_sha256,v_wines,v_matched,
                v_changed,v_unchanged,v_private,v_unresolved);
    end if;
    return pg_catalog.jsonb_build_object(
        'completed',v_done,'content_sha256',v_job.content_sha256,
        'wine_count',v_wines,'matched_count',v_matched,'changed_count',v_changed,
        'unchanged_count',v_unchanged,'private_preserved_count',v_private,
        'unresolved_count',v_unresolved);
end;
$$;

revoke all on function public.start_drinking_window_impact_preview(uuid) from public, anon;
revoke all on function public.continue_drinking_window_impact_preview(uuid) from public, anon;
grant execute on function public.start_drinking_window_impact_preview(uuid) to authenticated;
grant execute on function public.continue_drinking_window_impact_preview(uuid) to authenticated;

commit;

