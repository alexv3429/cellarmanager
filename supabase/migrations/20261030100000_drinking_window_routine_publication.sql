begin;

-- Gate 2: a current drinking-window curator may publish a fully reviewed
-- common reference. The former publisher grants are retained as history but
-- no longer confer or restrict publication authority.
create or replace function private.require_drinking_window_publisher(p_user_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
    perform private.require_enrichment_curator(p_user_id, 'drinking-window');
end;
$$;

create or replace function public.get_drinking_window_release_workspace()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    return pg_catalog.jsonb_build_object(
        'can_publish', true,
        'versions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'version_id', v.id, 'version_number', v.version_number,
            'status', v.status, 'row_count', (select count(*) from public.drinking_window_reference_rows r
                where r.version_id = v.id),
            'latest_preflight', (select pg_catalog.jsonb_build_object(
                'issue_count', p.issue_count, 'content_sha256', p.content_sha256,
                'checked_at', p.checked_at)
                from private.drinking_window_publication_preflights p
                where p.version_id = v.id order by p.checked_at desc limit 1)
        ) order by v.version_number desc) from public.drinking_window_reference_versions v
        where v.status in ('draft', 'active')), '[]'::jsonb)
    );
end;
$$;

-- Direct curator authoring starts as an unreviewed exact-release row. The
-- existing evidence/attestation and subject-review tools must complete it;
-- this RPC alone cannot make a date publishable.
create table private.drinking_window_draft_row_authorship (
    id bigint generated always as identity primary key,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    row_id uuid not null references public.drinking_window_reference_rows(id),
    curator_id uuid not null references auth.users(id),
    authored_at timestamptz not null default now()
);
revoke all on private.drinking_window_draft_row_authorship
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_draft_row_authorship to service_role;
create trigger drinking_window_draft_row_authorship_immutable
before update or delete on private.drinking_window_draft_row_authorship
for each row execute function private.reject_drinking_window_shadow_update();

create function public.create_drinking_window_exact_draft_row(
    p_version_id uuid, p_release_id uuid, p_region_id uuid,
    p_appellation_id uuid, p_wine_color text, p_format_ml integer,
    p_first_trial_year integer, p_best_start_year integer,
    p_best_end_year integer, p_rationale text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    v_release public.wine_reference_releases%rowtype;
    v_producer_id uuid;
    v_row_id uuid;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    perform 1 from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status = 'draft';
    if not found then
        raise exception using errcode = '22023', message = 'Choose an unpublished working version';
    end if;
    select r.* into v_release from public.wine_reference_releases r
    where r.id = p_release_id;
    if not found then
        raise exception using errcode = '22023', message = 'Choose a canonical wine and vintage';
    end if;
    select p.producer_id into v_producer_id from public.wine_reference_products p
    where p.id = v_release.product_id;
    if not exists (select 1 from public.enrichment_places p
        where p.id = p_region_id and p.place_type in ('region', 'subregion'))
       or not exists (select 1 from public.enrichment_places p
        where p.id = p_appellation_id and p.place_type = 'appellation')
       or not private.drinking_window_place_contains(p_region_id, p_appellation_id)
       or p_wine_color not in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
       or p_format_ml is null or p_format_ml not between 50 and 30000
       or p_first_trial_year is null or p_best_start_year is null
       or p_best_end_year is null
       or p_first_trial_year < v_release.vintage_year
       or p_first_trial_year > p_best_start_year
       or p_best_start_year > p_best_end_year
       or p_best_end_year > 2300
       or pg_catalog.length(pg_catalog.btrim(coalesce(p_rationale, ''))) not between 20 and 2000 then
        raise exception using errcode = '22023',
            message = 'Confirm region, appellation, colour, size, three ordered years and reasoning';
    end if;
    if exists (select 1 from public.drinking_window_reference_rows r
        where r.version_id = p_version_id and r.scope = 'release'
          and r.release_id = p_release_id and r.region_id = p_region_id
          and r.appellation_id = p_appellation_id and r.wine_color = p_wine_color
          ) then
        raise exception using errcode = '23505',
            message = 'This exact wine already has a draft row; correct it instead';
    end if;
    insert into public.drinking_window_reference_rows (
        version_id, scope, producer_id, product_id, release_id,
        appellation_id, region_id, wine_color, vintage_year, format_ml,
        all_at_scope, first_trial_year, best_start_year, best_end_year, rationale
    ) values (
        p_version_id, 'release', v_producer_id, v_release.product_id,
        v_release.id, p_appellation_id, p_region_id, p_wine_color,
        v_release.vintage_year, p_format_ml, true, p_first_trial_year,
        p_best_start_year, p_best_end_year, pg_catalog.btrim(p_rationale)
    ) returning id into v_row_id;
    insert into private.drinking_window_draft_row_authorship
        (version_id, row_id, curator_id)
    values (p_version_id, v_row_id, auth.uid());
    return v_row_id;
end;
$$;
revoke all on function public.create_drinking_window_exact_draft_row(
    uuid, uuid, uuid, uuid, text, integer, integer, integer, integer, text
) from public, anon;
grant execute on function public.create_drinking_window_exact_draft_row(
    uuid, uuid, uuid, uuid, text, integer, integer, integer, integer, text
) to authenticated;

-- A curator must see an aggregate, cross-cellar impact preview for the exact
-- draft fingerprint before publishing. No household or wine details leave this
-- function. It reads wines in a streaming loop rather than storing snapshots.
create table private.drinking_window_publication_impact_previews (
    id bigint generated always as identity primary key,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    curator_id uuid not null references auth.users(id),
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    wine_count integer not null,
    matched_count integer not null,
    changed_count integer not null,
    unchanged_count integer not null,
    private_preserved_count integer not null,
    unresolved_count integer not null,
    previewed_at timestamptz not null default now()
);
revoke all on private.drinking_window_publication_impact_previews
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_publication_impact_previews to service_role;
create trigger drinking_window_publication_impact_previews_immutable
before update or delete on private.drinking_window_publication_impact_previews
for each row execute function private.reject_drinking_window_shadow_update();

create function public.preview_drinking_window_publication_impact(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_wine record;
    v_context jsonb;
    v_match record;
    v_current jsonb;
    v_projection jsonb;
    v_rules jsonb;
    v_hash text;
    v_wines integer := 0;
    v_matched integer := 0;
    v_changed integer := 0;
    v_unchanged integer := 0;
    v_private integer := 0;
    v_unresolved integer := 0;
    v_first integer;
    v_start integer;
    v_end integer;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if not exists (select 1 from public.drinking_window_reference_versions v
        where v.id = p_version_id and v.status = 'draft') then
        raise exception using errcode = '22023', message = 'Choose an unpublished draft';
    end if;
    if exists (select 1 from public.drinking_window_publication_issues(p_version_id)) then
        raise exception using errcode = '23514', message = 'Complete draft review before previewing publication';
    end if;
    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    for v_wine in select w.* from public.wines w
        where w.merged_into_wine_id is null order by w.id loop
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
    if v_hash <> public.drinking_window_draft_fingerprint(p_version_id) then
        raise exception using errcode = '40001', message = 'Draft changed during impact preview';
    end if;
    insert into private.drinking_window_publication_impact_previews (
        version_id, curator_id, content_sha256, wine_count, matched_count,
        changed_count, unchanged_count, private_preserved_count, unresolved_count
    ) values (p_version_id, auth.uid(), v_hash, v_wines, v_matched,
        v_changed, v_unchanged, v_private, v_unresolved);
    return pg_catalog.jsonb_build_object(
        'content_sha256', v_hash, 'wine_count', v_wines,
        'matched_count', v_matched, 'changed_count', v_changed,
        'unchanged_count', v_unchanged, 'private_preserved_count', v_private,
        'unresolved_count', v_unresolved
    );
end;
$$;
revoke all on function public.preview_drinking_window_publication_impact(uuid)
from public, anon;
grant execute on function public.preview_drinking_window_publication_impact(uuid)
to authenticated;

-- Keep the atomic lifecycle, immutable publication record, fresh fingerprint,
-- zero-issue preflight and emergency switch. A cellar owner comparison is an
-- optional preview, not a veto or an opt-in to the common reference.
create or replace function public.publish_drinking_window_reference(p_version_id uuid)
returns table (version_id uuid, content_sha256 text,
    replaced_version_id uuid, reviewed_household_count integer)
language plpgsql security definer set search_path = '' as $$
declare
    v_hash text;
    v_previous uuid;
begin
    -- Check the signed-in identity even for direct calls. A service token or
    -- a former publisher grant alone is never sufficient to activate dates.
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    lock table public.drinking_window_reference_rows,
        public.drinking_window_ageing_groups,
        public.drinking_window_ageing_group_memberships,
        public.drinking_window_reference_evidence,
        public.drinking_window_reference_reviews,
        public.enrichment_evidence,
        public.enrichment_sources,
        public.enrichment_source_policies,
        public.enrichment_curator_eligibilities,
        public.enrichment_places,
        public.enrichment_place_aliases,
        public.wine_reference_producers,
        public.wine_reference_products,
        public.wine_reference_releases,
        private.drinking_window_publication_preflights
    in share mode;
    perform 1 from public.drinking_window_reference_versions v
    where v.id = p_version_id and v.status = 'draft' for update;
    if not found then
        raise exception using errcode = '22023',
            message = 'A draft drinking-window reference version is required';
    end if;
    select v.id into v_previous
    from public.drinking_window_reference_versions v where v.status = 'active';
    if exists (select 1 from public.drinking_window_publication_issues(p_version_id)) then
        raise exception using errcode = '23514',
            message = 'The draft still has publication issues';
    end if;
    v_hash := public.drinking_window_draft_fingerprint(p_version_id);
    if not exists (
        select 1 from private.drinking_window_publication_preflights p
        where p.version_id = p_version_id and p.content_sha256 = v_hash
          and p.issue_count = 0
    ) then
        raise exception using errcode = '23514',
            message = 'A current zero-issue preflight must be recorded';
    end if;
    if not exists (
        select 1 from private.drinking_window_publication_impact_previews preview
        where preview.version_id = p_version_id
          and preview.curator_id = auth.uid()
          and preview.content_sha256 = v_hash
          and preview.previewed_at >= now() - interval '30 minutes'
    ) then
        raise exception using errcode = '23514',
            message = 'Preview the current draft impact before publishing';
    end if;

    perform pg_catalog.set_config('app.drinking_window_publication', 'on', true);
    if v_previous is not null then
        update public.drinking_window_reference_versions v
        set status = 'superseded' where v.id = v_previous;
    end if;
    update public.drinking_window_reference_versions v
    set status = 'active', content_sha256 = v_hash, published_at = now()
    where v.id = p_version_id;
    perform pg_catalog.set_config('app.drinking_window_publication', 'off', true);
    insert into private.drinking_window_publications
        (version_id, replaced_version_id, content_sha256, reviewed_household_count)
    values (p_version_id, v_previous, v_hash, 0);
    update private.drinking_window_runtime_switch
    set enabled = true, version_id = p_version_id, changed_at = now()
    where singleton;
    insert into private.drinking_window_runtime_events
        (version_id, enabled, reason)
    values (p_version_id, true, 'Curator published reviewed common reference');
    return query select p_version_id, v_hash, v_previous, 0;
end;
$$;

-- Historic owner decisions stay auditable, but cannot turn common advice on
-- or off for just one household once publication is global.
drop trigger drinking_window_owner_decision_rollout
on private.drinking_window_shadow_decisions;

create or replace function public.get_drinking_window_rollout_status(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_active public.drinking_window_reference_versions%rowtype;
    v_enabled boolean;
begin
    if not exists (select 1 from public.household_members m
        where m.household_id = p_household_id and m.user_id = auth.uid()
          and m.role = 'owner') then
        raise exception using errcode = '42501',
            message = 'Only the household owner can inspect reference status';
    end if;
    select v.* into v_active from public.drinking_window_reference_versions v
    join private.drinking_window_publications p on p.version_id = v.id
        and p.content_sha256 = v.content_sha256
    where v.status = 'active';
    select s.enabled into v_enabled from private.drinking_window_runtime_switch s
    where s.singleton and s.version_id = v_active.id;
    return pg_catalog.jsonb_build_object(
        'active_version_number', v_active.version_number,
        'selected_version_number', v_active.version_number,
        'selected_enabled', coalesce(v_enabled, false),
        'global_enabled', coalesce(v_enabled, false)
    );
end;
$$;

-- Same (uuid) -> jsonb signature as all four earlier definitions of this
-- function; only the selection of the active version changes.
create or replace function private.drinking_window_active_match(p_wine_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_wine public.wines%rowtype;
    v_version public.drinking_window_reference_versions%rowtype;
    v_region_ids uuid[];
    v_appellation_ids uuid[];
    v_region_id uuid;
    v_appellation_id uuid;
    v_producer_id uuid;
    v_product_id uuid;
    v_release_id uuid;
    v_color text;
    v_match record;
    v_rationale text;
begin
    select * into v_wine from public.wines w
    where w.id = p_wine_id and w.merged_into_wine_id is null;
    if not found then
        return pg_catalog.jsonb_build_object('status', 'missing_key', 'reason', 'wine_not_found');
    end if;
    select v.* into v_version
    from private.drinking_window_runtime_switch s
    join public.drinking_window_reference_versions v on v.id = s.version_id
    join private.drinking_window_publications p on p.version_id = v.id
        and p.content_sha256 = v.content_sha256
    where s.singleton and s.enabled and v.status = 'active';
    if not found then
        return pg_catalog.jsonb_build_object('status', 'unpublished');
    end if;
    v_color := private.canonical_enrichment_wine_color(v_wine.color);
    if v_wine.vintage is null or v_color is null or v_wine.area is null then
        return pg_catalog.jsonb_build_object('status', 'missing_key',
            'reason', 'region_color_and_vintage_required');
    end if;
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
    if coalesce(pg_catalog.cardinality(v_region_ids), 0) <> 1 then
        return pg_catalog.jsonb_build_object('status', 'missing_key', 'reason', 'region_not_confirmed');
    end if;
    v_region_id := v_region_ids[1];
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
        if coalesce(pg_catalog.cardinality(v_appellation_ids), 0) <> 1 then
            return pg_catalog.jsonb_build_object('status', 'missing_key', 'reason', 'appellation_not_confirmed');
        end if;
        v_appellation_id := v_appellation_ids[1];
        if not private.drinking_window_place_contains(v_region_id, v_appellation_id) then
            return pg_catalog.jsonb_build_object('status', 'identity_conflict',
                'reason', 'appellation_outside_region');
        end if;
    end if;
    if v_wine.wine_reference_type = 'release' then
        select release.id, product.id, product.producer_id
        into v_release_id, v_product_id, v_producer_id
        from public.wine_reference_releases release
        join public.wine_reference_products product on product.id = release.product_id
        where release.id = v_wine.wine_reference_id
          and release.vintage_year = v_wine.vintage;
    elsif v_wine.wine_reference_type = 'product' then
        select product.id, product.producer_id into v_product_id, v_producer_id
        from public.wine_reference_products product
        where product.id = v_wine.wine_reference_id;
    end if;
    if v_wine.wine_reference_id is not null and v_producer_id is null then
        return pg_catalog.jsonb_build_object('status', 'identity_conflict',
            'reason', 'wine_reference_mismatch');
    end if;
    select * into v_match from private.drinking_window_preview_draft_match_for_wine(
        p_wine_id, v_version.id, v_producer_id, v_product_id, v_release_id,
        v_appellation_id, v_region_id, v_color, v_wine.vintage, null
    );
    if v_match.status <> 'draft_match' then
        return pg_catalog.jsonb_build_object('status', v_match.status,
            'reason', case when v_match.status = 'no_match'
                then 'no_applicable_published_row' else v_match.reason end);
    end if;
    select r.rationale into v_rationale from public.drinking_window_reference_rows r
    where r.id = v_match.reference_row_id and r.version_id = v_version.id;
    return pg_catalog.jsonb_build_object(
        'status', 'match', 'version_id', v_version.id,
        'version_number', v_version.version_number,
        'version_sha256', v_version.content_sha256,
        'reference_row_id', v_match.reference_row_id,
        'matched_scope', v_match.matched_scope,
        'first_trial_year', v_match.first_trial_year,
        'best_start_year', v_match.best_start_year,
        'best_end_year', v_match.best_end_year,
        'rationale', v_rationale
    );
end;
$$;

commit;
