begin;

-- Missing source coverage is normal when the shared library encounters a new
-- producer. Keep source suggestions as durable workflow data instead of
-- requiring one migration per producer. Suggestions may come from bounded web
-- discovery or from a household owner who supplies an advanced fallback URL.
create table public.enrichment_research_source_suggestions (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null
        references public.enrichment_research_cases(id)
        on delete cascade,
    household_id uuid
        references public.households(id)
        on delete cascade,
    submitted_by uuid references auth.users(id),
    suggestion_origin text not null,
    source_kind text not null,
    source_url text not null,
    suggestion_status text not null default 'pending',
    source_name text,
    last_error_code text,
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,

    constraint enrichment_research_source_suggestions_identity_unique
        unique (case_id, source_url),
    constraint enrichment_research_source_suggestions_origin_check
        check (suggestion_origin in ('automatic', 'owner')),
    constraint enrichment_research_source_suggestions_kind_check
        check (source_kind in (
            'official',
            'institutional',
            'technical',
            'editorial',
            'other'
        )),
    constraint enrichment_research_source_suggestions_url_check
        check (
            length(source_url) between 12 and 2000
            and source_url ~ '^https://[^[:space:]]+$'
            and source_url !~ '^https://[^/]*@'
        ),
    constraint enrichment_research_source_suggestions_status_check
        check (suggestion_status in ('pending', 'accepted', 'rejected')),
    constraint enrichment_research_source_suggestions_review_check
        check (
            (suggestion_status = 'pending' and reviewed_at is null)
            or (suggestion_status <> 'pending' and reviewed_at is not null)
        )
);

comment on table public.enrichment_research_source_suggestions is
    'Bounded source candidates for a research case. Page bodies are never stored; accepted URLs become attributed pointer-only rules.';

create index enrichment_research_source_suggestions_pending_idx
on public.enrichment_research_source_suggestions(case_id, created_at, id)
where suggestion_status = 'pending';

alter table public.enrichment_research_source_suggestions enable row level security;

revoke all
on table public.enrichment_research_source_suggestions
from public, anon, authenticated;

grant select, insert, update, delete
on table public.enrichment_research_source_suggestions
to service_role;


create or replace function private.research_https_hostname(p_url text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
    v_hostname text;
begin
    if length(trim(p_url)) not between 12 and 2000
       or trim(p_url) !~ '^https://[^[:space:]]+$'
       or trim(p_url) ~ '^https://[^/]*@'
    then
        raise exception using errcode = '22023', message = 'Research source must be a public HTTPS URL';
    end if;

    v_hostname := lower(substring(trim(p_url) from '^https://([^/?#:]+)'));
    if v_hostname is null
       or v_hostname = 'localhost'
       or v_hostname like '%.localhost'
       or v_hostname like '%.local'
       or v_hostname ~ '^[0-9.]+$'
       or position(':' in v_hostname) > 0
       or v_hostname !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    then
        raise exception using errcode = '22023', message = 'Research source must use a public DNS hostname';
    end if;

    return v_hostname;
end;
$$;

revoke execute
on function private.research_https_hostname(text)
from public, anon, authenticated;


create or replace function public.suggest_enrichment_research_source(
    p_household_id uuid,
    p_case_id uuid,
    p_source_url text,
    p_source_kind text default 'other'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_url text := trim(p_source_url);
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if p_source_kind not in ('official', 'institutional', 'technical', 'editorial', 'other') then
        raise exception using errcode = '22023', message = 'Research source type is invalid';
    end if;

    perform private.research_https_hostname(v_url);

    if not exists (
        select 1
        from public.household_members member
        join public.enrichment_research_subscriptions subscription
          on subscription.household_id = member.household_id
         and subscription.case_id = p_case_id
        where member.household_id = p_household_id
          and member.user_id = v_user_id
          and member.role = 'owner'
    ) then
        raise exception using errcode = '42501', message = 'Only a subscribed household owner can suggest a research source';
    end if;

    if not exists (
        select 1
        from public.enrichment_research_cases research_case
        where research_case.id = p_case_id
          and research_case.case_status in (
              'needs-source-review',
              'queued',
              'retrying',
              'not-found',
              'failed'
          )
    ) then
        raise exception using errcode = '55000', message = 'This research request is not waiting for another source';
    end if;

    insert into public.enrichment_research_source_suggestions (
        case_id,
        household_id,
        submitted_by,
        suggestion_origin,
        source_kind,
        source_url
    ) values (
        p_case_id,
        p_household_id,
        v_user_id,
        'owner',
        p_source_kind,
        v_url
    )
    on conflict (case_id, source_url) do update
    set
        household_id = excluded.household_id,
        submitted_by = excluded.submitted_by,
        suggestion_origin = 'owner',
        source_kind = excluded.source_kind,
        suggestion_status = 'pending',
        source_name = null,
        last_error_code = null,
        reviewed_at = null,
        created_at = now();

    update public.enrichment_research_cases research_case
    set
        case_status = 'queued',
        attempt_count = 0,
        next_attempt_at = null,
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        last_error_code = null,
        updated_at = now()
    where research_case.id = p_case_id
      and research_case.case_status in (
          'needs-source-review',
          'retrying',
          'not-found',
          'failed'
      );

    return public.get_household_enrichment_research_inbox(p_household_id);
end;
$$;

revoke all
on function public.suggest_enrichment_research_source(uuid, uuid, text, text)
from public, anon;

grant execute
on function public.suggest_enrichment_research_source(uuid, uuid, text, text)
to authenticated;


-- Trusted discovery records only bounded URL candidates. Search snippets and
-- page bodies are deliberately not persisted.
create or replace function public.record_discovered_enrichment_research_sources(
    p_case_id uuid,
    p_lease_token uuid,
    p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_case public.enrichment_research_cases%rowtype;
    v_source jsonb;
    v_url text;
    v_kind text;
begin
    select research_case.* into v_case
    from public.enrichment_research_cases research_case
    where research_case.id = p_case_id
    for update;

    if not found
       or v_case.case_status <> 'researching'
       or v_case.lease_token <> p_lease_token
       or v_case.lease_expires_at <= now()
    then
        raise exception using errcode = '55000', message = 'Research lease is missing, stale, or expired';
    end if;

    if jsonb_typeof(p_sources) <> 'array'
       or jsonb_array_length(p_sources) not between 1 and 5
    then
        raise exception using errcode = '22023', message = 'Discovered research sources must be a bounded array';
    end if;

    for v_source in select value from jsonb_array_elements(p_sources)
    loop
        v_url := trim(v_source ->> 'url');
        v_kind := v_source ->> 'kind';
        perform private.research_https_hostname(v_url);
        if v_kind not in ('official', 'institutional', 'technical', 'editorial', 'other') then
            raise exception using errcode = '22023', message = 'Discovered research source type is invalid';
        end if;

        insert into public.enrichment_research_source_suggestions (
            case_id,
            suggestion_origin,
            source_kind,
            source_url
        ) values (
            p_case_id,
            'automatic',
            v_kind,
            v_url
        )
        on conflict (case_id, source_url) do nothing;
    end loop;

    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'suggestion_id', suggestion.id,
            'url', suggestion.source_url,
            'kind', suggestion.source_kind,
            'origin', suggestion.suggestion_origin
        ) order by suggestion.created_at, suggestion.id)
        from public.enrichment_research_source_suggestions suggestion
        where suggestion.case_id = p_case_id
          and suggestion.suggestion_status = 'pending'
    ), '[]'::jsonb);
end;
$$;

revoke execute
on function public.record_discovered_enrichment_research_sources(uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute
on function public.record_discovered_enrichment_research_sources(uuid, uuid, jsonb)
to service_role;


create or replace function public.accept_enrichment_research_source_suggestion(
    p_case_id uuid,
    p_lease_token uuid,
    p_suggestion_id uuid,
    p_source_name text,
    p_attribution text,
    p_final_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_case public.enrichment_research_cases%rowtype;
    v_suggestion public.enrichment_research_source_suggestions%rowtype;
    v_source_id uuid;
    v_policy_id uuid;
    v_rule_id uuid;
    v_hostname text;
    v_submitted_hostname text;
    v_path text;
    v_source_key text;
    v_aliases text[];
    v_source_kind text;
begin
    select research_case.* into v_case
    from public.enrichment_research_cases research_case
    where research_case.id = p_case_id
    for update;

    if not found
       or v_case.case_status <> 'researching'
       or v_case.lease_token <> p_lease_token
       or v_case.lease_expires_at <= now()
    then
        raise exception using errcode = '55000', message = 'Research lease is missing, stale, or expired';
    end if;

    select suggestion.* into v_suggestion
    from public.enrichment_research_source_suggestions suggestion
    where suggestion.id = p_suggestion_id
      and suggestion.case_id = p_case_id
      and suggestion.suggestion_status = 'pending'
    for update;

    if not found then
        raise exception using errcode = '55000', message = 'Research source suggestion is no longer pending';
    end if;

    if length(trim(p_source_name)) not between 3 and 240
       or length(trim(p_attribution)) not between 2 and 240
    then
        raise exception using errcode = '22023', message = 'Research source attribution is invalid';
    end if;

    v_submitted_hostname := private.research_https_hostname(v_suggestion.source_url);
    v_hostname := private.research_https_hostname(trim(p_final_url));
    if v_hostname <> v_submitted_hostname then
        raise exception using errcode = '22023', message = 'Research source redirect changed hostname';
    end if;

    v_path := private.https_url_path(trim(p_final_url));
    v_source_key := 'submitted-web-' || md5(v_hostname);
    v_source_kind := case v_suggestion.source_kind
        when 'official' then 'producer'
        when 'institutional' then 'regulatory'
        when 'editorial' then 'critic'
        else 'provider'
    end;
    v_aliases := case
        when private.normalize_wine_reference_text(
            v_case.subject_snapshot ->> 'producer'
        ) = '' then '{}'::text[]
        else array[private.normalize_wine_reference_text(
            v_case.subject_snapshot ->> 'producer'
        )]
    end;

    insert into public.enrichment_sources (
        source_key,
        source_name,
        source_kind,
        homepage_url
    ) values (
        v_source_key,
        trim(p_source_name),
        v_source_kind,
        'https://' || v_hostname || '/'
    )
    on conflict (source_key) do update
    set source_name = excluded.source_name
    returning id into v_source_id;

    select policy.id into v_policy_id
    from public.enrichment_source_policies policy
    where policy.source_id = v_source_id
      and policy.status = 'reviewed'
      and policy.effective_to is null
    order by policy.policy_version desc
    limit 1;

    if v_policy_id is null then
        insert into public.enrichment_source_policies (
            source_id,
            policy_version,
            status,
            effective_from,
            terms_checked_on,
            evidence_url,
            display_right,
            normalized_storage_right,
            raw_payload_storage_right,
            offline_sync_right,
            retention_right,
            cross_household_reuse_right,
            attribution_text,
            notes
        ) values (
            v_source_id,
            1,
            'reviewed',
            current_date,
            current_date,
            trim(p_final_url),
            'allowed',
            'prohibited',
            'prohibited',
            'prohibited',
            'allowed',
            'allowed',
            trim(p_attribution),
            'Public attributed page used under CellarManager pointer-only research rules. Page text is fetched transiently and is not retained. Every derived proposal still requires owner review and trusted publication.'
        )
        returning id into v_policy_id;
    end if;

    insert into public.enrichment_research_source_rules (
        source_id,
        source_policy_id,
        hostname,
        path_prefix,
        subject_types,
        subject_aliases,
        claim_types,
        search_query_template,
        max_pages
    ) values (
        v_source_id,
        v_policy_id,
        v_hostname,
        v_path,
        array[v_case.subject_type],
        v_aliases,
        array[v_case.claim_type],
        'site:' || v_hostname || ' {subject}',
        1
    )
    on conflict (source_policy_id, hostname, path_prefix) do update
    set
        status = 'active',
        subject_types = array(
            select distinct value
            from unnest(
                public.enrichment_research_source_rules.subject_types
                || excluded.subject_types
            ) value
            order by value
        ),
        subject_aliases = array(
            select distinct value
            from unnest(
                public.enrichment_research_source_rules.subject_aliases
                || excluded.subject_aliases
            ) value
            order by value
        ),
        claim_types = array(
            select distinct value
            from unnest(
                public.enrichment_research_source_rules.claim_types
                || excluded.claim_types
            ) value
            order by value
        )
    returning id into v_rule_id;

    update public.enrichment_research_source_suggestions suggestion
    set
        suggestion_status = 'accepted',
        source_name = trim(p_source_name),
        last_error_code = null,
        reviewed_at = now()
    where suggestion.id = p_suggestion_id;

    return jsonb_build_object(
        'rule_id', v_rule_id,
        'source_id', v_source_id,
        'source_policy_id', v_policy_id,
        'source_name', trim(p_source_name),
        'hostname', v_hostname,
        'path_prefix', v_path,
        'query_template', 'site:' || v_hostname || ' {subject}',
        'max_pages', 1
    );
end;
$$;

revoke execute
on function public.accept_enrichment_research_source_suggestion(uuid, uuid, uuid, text, text, text)
from public, anon, authenticated;

grant execute
on function public.accept_enrichment_research_source_suggestion(uuid, uuid, uuid, text, text, text)
to service_role;


create or replace function public.reject_enrichment_research_source_suggestion(
    p_case_id uuid,
    p_lease_token uuid,
    p_suggestion_id uuid,
    p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.enrichment_research_cases research_case
        where research_case.id = p_case_id
          and research_case.case_status = 'researching'
          and research_case.lease_token = p_lease_token
          and research_case.lease_expires_at > now()
    ) then
        raise exception using errcode = '55000', message = 'Research lease is missing, stale, or expired';
    end if;

    update public.enrichment_research_source_suggestions suggestion
    set
        suggestion_status = 'rejected',
        last_error_code = left(nullif(trim(p_error_code), ''), 120),
        reviewed_at = now()
    where suggestion.id = p_suggestion_id
      and suggestion.case_id = p_case_id
      and suggestion.suggestion_status = 'pending';

    if not found then
        raise exception using errcode = '55000', message = 'Research source suggestion is no longer pending';
    end if;

    return jsonb_build_object('suggestion_id', p_suggestion_id, 'status', 'rejected');
end;
$$;

revoke execute
on function public.reject_enrichment_research_source_suggestion(uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute
on function public.reject_enrichment_research_source_suggestion(uuid, uuid, uuid, text)
to service_role;


-- Include pending owner and automatic candidates in the trusted lease. No
-- household identity is returned to the worker.
create or replace function public.claim_enrichment_research_cases(
    p_worker_id text,
    p_limit integer default 1,
    p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if length(trim(p_worker_id)) not between 3 and 100
       or p_limit not between 1 and 10
       or p_lease_seconds not between 30 and 600
    then
        raise exception using errcode = '22023', message = 'Research worker claim parameters are invalid';
    end if;

    update public.enrichment_research_cases research_case
    set
        case_status = case when attempt_count >= 8 then 'failed' else 'queued' end,
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        last_error_code = case when attempt_count >= 8 then 'research-attempts-exhausted' else 'research-lease-expired' end,
        updated_at = now()
    where research_case.case_status = 'researching'
      and research_case.lease_expires_at <= now();

    with candidates as (
        select research_case.id
        from public.enrichment_research_cases research_case
        where research_case.case_status = 'queued'
           or (
               research_case.case_status = 'retrying'
               and research_case.next_attempt_at <= now()
           )
        order by research_case.priority desc, research_case.requested_at, research_case.id
        for update skip locked
        limit p_limit
    ), claimed as (
        update public.enrichment_research_cases research_case
        set
            case_status = 'researching',
            lease_token = gen_random_uuid(),
            leased_by = trim(p_worker_id),
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempt_count = attempt_count + 1,
            next_attempt_at = null,
            last_error_code = null,
            updated_at = now()
        from candidates
        where research_case.id = candidates.id
        returning research_case.*
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'case_id', claimed.id,
        'lease_token', claimed.lease_token,
        'subject_type', claimed.subject_type,
        'gap_type', claimed.gap_type,
        'claim_type', claimed.claim_type,
        'field_name', claimed.field_name,
        'subject', claimed.subject_snapshot,
        'vintage_year', claimed.vintage_year,
        'wine_color', claimed.wine_color,
        'allowed_sources', coalesce((
            select jsonb_agg(jsonb_build_object(
                'rule_id', rule.id,
                'source_id', rule.source_id,
                'source_policy_id', rule.source_policy_id,
                'source_name', source.source_name,
                'hostname', rule.hostname,
                'path_prefix', rule.path_prefix,
                'query_template', rule.search_query_template,
                'max_pages', rule.max_pages
            ) order by source.source_name, rule.hostname, rule.path_prefix)
            from public.enrichment_research_source_rules rule
            join public.enrichment_sources source on source.id = rule.source_id
            where rule.status = 'active'
              and claimed.subject_type = any(rule.subject_types)
              and claimed.claim_type = any(rule.claim_types)
              and (
                  cardinality(rule.subject_aliases) = 0
                  or private.normalize_wine_reference_text(
                      claimed.subject_snapshot ->> 'producer'
                  ) = any(rule.subject_aliases)
              )
        ), '[]'::jsonb),
        'suggested_sources', coalesce((
            select jsonb_agg(jsonb_build_object(
                'suggestion_id', suggestion.id,
                'url', suggestion.source_url,
                'kind', suggestion.source_kind,
                'origin', suggestion.suggestion_origin
            ) order by suggestion.created_at, suggestion.id)
            from public.enrichment_research_source_suggestions suggestion
            where suggestion.case_id = claimed.id
              and suggestion.suggestion_status = 'pending'
        ), '[]'::jsonb)
    ) order by claimed.priority desc, claimed.requested_at, claimed.id), '[]'::jsonb)
    into v_result
    from claimed;

    return v_result;
end;
$$;

revoke execute
on function public.claim_enrichment_research_cases(text, integer, integer)
from public, anon, authenticated;

grant execute
on function public.claim_enrichment_research_cases(text, integer, integer)
to service_role;

commit;
