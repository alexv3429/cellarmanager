begin;

-- Curator trust is explicit, scoped, reversible, and independent from account
-- count. Browser users cannot grant themselves this role.
create table public.enrichment_curator_eligibilities (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null,
    eligibility_status text not null default 'active',
    profile_scopes text[] not null,
    rationale text not null,
    granted_by text not null,
    granted_at timestamptz not null default now(),
    revoked_at timestamptz,

    constraint enrichment_curator_display_name_check
        check (length(trim(display_name)) between 2 and 120),
    constraint enrichment_curator_status_check
        check (eligibility_status in ('active', 'suspended', 'revoked')),
    constraint enrichment_curator_scopes_check
        check (
            cardinality(profile_scopes) between 1 and 7
            and profile_scopes <@ array[
                'place', 'place-adjustment', 'vintage', 'producer-era',
                'producer-vintage-interaction', 'cuvee', 'release'
            ]::text[]
            and array_position(profile_scopes, null) is null
        ),
    constraint enrichment_curator_rationale_check
        check (length(trim(rationale)) between 10 and 1000),
    constraint enrichment_curator_grant_check
        check (length(trim(granted_by)) between 3 and 200),
    constraint enrichment_curator_revocation_check
        check (
            (eligibility_status = 'active' and revoked_at is null)
            or (eligibility_status in ('suspended', 'revoked') and revoked_at is not null)
        )
);


create or replace function private.valid_enrichment_https_urls(
    p_urls text[],
    p_minimum integer,
    p_maximum integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select
        cardinality(p_urls) between p_minimum and p_maximum
        and array_position(p_urls, null) is null
        and coalesce(bool_and(
            length(url) <= 2048
            and url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$'
        ), p_minimum = 0)
    from unnest(p_urls) url;
$$;

revoke execute
on function private.valid_enrichment_https_urls(text[], integer, integer)
from public, anon, authenticated;


create table public.enrichment_profile_revisions (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null
        references public.enrichment_profile_review_cases(id),
    predecessor_profile_id uuid not null
        references public.enrichment_profiles(id),
    proposed_payload jsonb not null,
    proposal_sha256 text not null,
    evidence_urls text[] not null,
    revision_status text not null default 'proposed',
    proposed_by uuid not null
        references public.enrichment_curator_eligibilities(user_id),
    proposed_at timestamptz not null default now(),
    superseded_at timestamptz,
    published_at timestamptz,
    published_profile_id uuid references public.enrichment_profiles(id),
    published_version_id uuid references public.enrichment_knowledge_versions(id),

    constraint enrichment_profile_revisions_payload_check
        check (jsonb_typeof(proposed_payload) = 'object'),
    constraint enrichment_profile_revisions_hash_check
        check (proposal_sha256 ~ '^[0-9a-f]{64}$'),
    constraint enrichment_profile_revisions_evidence_check
        check (private.valid_enrichment_https_urls(evidence_urls, 1, 12)),
    constraint enrichment_profile_revisions_status_check
        check (revision_status in (
            'proposed', 'approved', 'disputed', 'superseded', 'published'
        )),
    constraint enrichment_profile_revisions_lifecycle_check
        check (
            (
                revision_status in ('proposed', 'approved', 'disputed')
                and superseded_at is null
                and published_at is null
                and published_profile_id is null
                and published_version_id is null
            )
            or (
                revision_status = 'superseded'
                and superseded_at is not null
                and published_at is null
                and published_profile_id is null
                and published_version_id is null
            )
            or (
                revision_status = 'published'
                and superseded_at is null
                and published_at is not null
                and published_profile_id is not null
                and published_version_id is not null
            )
        )
);

create unique index enrichment_profile_revisions_one_open_case_idx
    on public.enrichment_profile_revisions(case_id)
    where revision_status in ('proposed', 'approved', 'disputed');

create index enrichment_profile_revisions_case_history_idx
    on public.enrichment_profile_revisions(case_id, proposed_at desc, id);


create table public.enrichment_profile_revision_decisions (
    id uuid primary key default gen_random_uuid(),
    decision_sequence bigint generated always as identity unique,
    revision_id uuid not null
        references public.enrichment_profile_revisions(id),
    curator_id uuid not null
        references public.enrichment_curator_eligibilities(user_id),
    verdict text not null,
    rationale text not null,
    evidence_urls text[] not null default '{}'::text[],
    decided_at timestamptz not null default now(),

    constraint enrichment_profile_revision_decisions_verdict_check
        check (verdict in ('approve', 'disagree')),
    constraint enrichment_profile_revision_decisions_rationale_check
        check (length(trim(rationale)) between 10 and 2000),
    constraint enrichment_profile_revision_decisions_evidence_check
        check (private.valid_enrichment_https_urls(evidence_urls, 0, 12))
);

create index enrichment_profile_revision_decisions_revision_idx
    on public.enrichment_profile_revision_decisions(
        revision_id, curator_id, decision_sequence desc
    );


create table public.enrichment_profile_governance_events (
    id bigint generated always as identity primary key,
    event_type text not null,
    actor_id uuid references auth.users(id) on delete set null,
    case_id uuid references public.enrichment_profile_review_cases(id),
    revision_id uuid references public.enrichment_profile_revisions(id),
    profile_id uuid references public.enrichment_profiles(id),
    knowledge_version_id uuid references public.enrichment_knowledge_versions(id),
    detail jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),

    constraint enrichment_profile_governance_events_type_check
        check (event_type in (
            'eligibility-granted', 'eligibility-suspended',
            'eligibility-revoked', 'revision-proposed', 'revision-approved',
            'revision-disagreed', 'revision-superseded',
            'revision-published', 'case-dismissed'
        )),
    constraint enrichment_profile_governance_events_detail_check
        check (jsonb_typeof(detail) = 'object')
);

create index enrichment_profile_governance_events_case_idx
    on public.enrichment_profile_governance_events(case_id, occurred_at, id);


alter table public.enrichment_curator_eligibilities enable row level security;
alter table public.enrichment_profile_revisions enable row level security;
alter table public.enrichment_profile_revision_decisions enable row level security;
alter table public.enrichment_profile_governance_events enable row level security;

revoke all privileges on table
    public.enrichment_curator_eligibilities,
    public.enrichment_profile_revisions,
    public.enrichment_profile_revision_decisions,
    public.enrichment_profile_governance_events
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.enrichment_curator_eligibilities,
    public.enrichment_profile_revisions,
    public.enrichment_profile_revision_decisions,
    public.enrichment_profile_governance_events
to service_role;


-- One normalized profile snapshot powers comparison, validation, and history.
create or replace function private.enrichment_profile_revision_snapshot(
    p_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'profile_id', profile.id,
        'profile_type', profile.profile_type,
        'confidence', profile.confidence,
        'rationale', profile.rationale,
        'reviewed_at', profile.reviewed_at,
        'created_at', profile.created_at,
        'knowledge_version', jsonb_build_object(
            'id', version.id,
            'number', version.version_number,
            'label', version.label,
            'status', version.status,
            'published_at', version.published_at,
            'content_sha256', version.content_sha256
        ),
        'typed', case profile.profile_type
            when 'place' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_place_profiles typed
                where typed.profile_id = profile.id
            )
            when 'place-adjustment' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_place_adjustment_profiles typed
                where typed.profile_id = profile.id
            )
            when 'vintage' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_vintage_profiles typed
                where typed.profile_id = profile.id
            )
            when 'producer-era' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_producer_era_profiles typed
                where typed.profile_id = profile.id
            )
            when 'producer-vintage-interaction' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_producer_vintage_interaction_profiles typed
                where typed.profile_id = profile.id
            )
            when 'cuvee' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_cuvee_profiles typed
                where typed.profile_id = profile.id
            )
            when 'release' then (
                select to_jsonb(typed) - 'profile_id' - 'knowledge_version_id' - 'profile_type'
                from public.enrichment_release_profiles typed
                where typed.profile_id = profile.id
            )
        end,
        'evidence', coalesce((
            select jsonb_agg(jsonb_build_object(
                'url', evidence.source_record_url,
                'claim_type', evidence.claim_type,
                'reviewed_at', evidence.reviewed_at,
                'role', link.evidence_role
            ) order by evidence.source_record_url, evidence.id)
            from public.enrichment_profile_evidence link
            join public.enrichment_evidence evidence on evidence.id = link.evidence_id
            where link.profile_id = profile.id
        ), '[]'::jsonb)
    )
    from public.enrichment_profiles profile
    join public.enrichment_knowledge_versions version
      on version.id = profile.knowledge_version_id
    where profile.id = p_profile_id;
$$;

revoke execute
on function private.enrichment_profile_revision_snapshot(uuid)
from public, anon, authenticated;


create or replace function private.require_enrichment_curator(
    p_user_id uuid,
    p_profile_type text
)
returns public.enrichment_curator_eligibilities
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_curator public.enrichment_curator_eligibilities%rowtype;
begin
    select curator.* into v_curator
    from public.enrichment_curator_eligibilities curator
    where curator.user_id = p_user_id
      and curator.eligibility_status = 'active'
      and p_profile_type = any(curator.profile_scopes);

    if not found then
        raise exception using
            errcode = '42501',
            message = 'An active curator grant for this profile type is required';
    end if;

    return v_curator;
end;
$$;

revoke execute
on function private.require_enrichment_curator(uuid, text)
from public, anon, authenticated;


create or replace function private.validate_enrichment_profile_revision(
    p_profile_id uuid,
    p_proposal jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_current jsonb := private.enrichment_profile_revision_snapshot(p_profile_id);
    v_profile_type text;
    v_typed jsonb;
    v_current_typed jsonb;
    v_mutable_keys text[];
    v_current_keys text[];
    v_proposed_keys text[];
    v_confidence numeric;
    v_rationale text;
    v_age_values numeric[];
    v_trait_values numeric[];
    v_normalized jsonb;
begin
    if v_current is null or jsonb_typeof(p_proposal) <> 'object' then
        raise exception using errcode = '22023', message = 'Profile revision payload is invalid';
    end if;

    v_profile_type := v_current ->> 'profile_type';
    if p_proposal ->> 'profile_type' <> v_profile_type
       or jsonb_typeof(p_proposal -> 'typed') <> 'object'
    then
        raise exception using errcode = '22023', message = 'Profile identity cannot change inside a revision';
    end if;

    v_typed := p_proposal -> 'typed';
    v_current_typed := v_current -> 'typed';
    select array_agg(key order by key) into v_current_keys
    from jsonb_object_keys(v_current_typed) key;
    select array_agg(key order by key) into v_proposed_keys
    from jsonb_object_keys(v_typed) key;
    if v_proposed_keys is distinct from v_current_keys then
        raise exception using errcode = '22023', message = 'Profile revision fields do not match the published profile';
    end if;

    v_confidence := (p_proposal ->> 'confidence')::numeric;
    v_rationale := nullif(trim(p_proposal ->> 'rationale'), '');
    if v_confidence not between 0 and 1
       or v_rationale is null
       or length(v_rationale) not between 10 and 4000
    then
        raise exception using errcode = '22023', message = 'Profile confidence or rationale is invalid';
    end if;

    if v_profile_type = 'place' then
        v_mutable_keys := array[
            'first_trial_age', 'best_start_age', 'best_end_age',
            'outer_horizon_age', 'body', 'acidity', 'tannin', 'sweetness',
            'alcohol', 'freshness', 'savory', 'concentration'
        ];
        v_age_values := array[
            (v_typed ->> 'first_trial_age')::numeric,
            (v_typed ->> 'best_start_age')::numeric,
            (v_typed ->> 'best_end_age')::numeric,
            (v_typed ->> 'outer_horizon_age')::numeric
        ];
        v_trait_values := array[
            (v_typed ->> 'body')::numeric, (v_typed ->> 'acidity')::numeric,
            (v_typed ->> 'tannin')::numeric, (v_typed ->> 'sweetness')::numeric,
            (v_typed ->> 'alcohol')::numeric, (v_typed ->> 'freshness')::numeric,
            (v_typed ->> 'savory')::numeric, (v_typed ->> 'concentration')::numeric
        ];
        if exists (select 1 from unnest(v_age_values) value where value <> trunc(value) or value not between 0 and 100)
           or not (v_age_values[1] <= v_age_values[2] and v_age_values[2] <= v_age_values[3] and v_age_values[3] <= v_age_values[4])
           or exists (select 1 from unnest(v_trait_values) value where value not between 0 and 5)
        then
            raise exception using errcode = '22023', message = 'Place ages or structural values are outside the reviewed bounds';
        end if;
    else
        v_mutable_keys := array[
            'first_trial_age_adjustment', 'best_start_age_adjustment',
            'best_end_age_adjustment', 'outer_horizon_age_adjustment',
            'body_adjustment', 'acidity_adjustment', 'tannin_adjustment',
            'sweetness_adjustment', 'alcohol_adjustment',
            'freshness_adjustment', 'savory_adjustment',
            'concentration_adjustment'
        ];
        if v_profile_type = 'vintage' then
            v_mutable_keys := array_append(v_mutable_keys, 'condition_tags');
        end if;
        v_age_values := array[
            (v_typed ->> 'first_trial_age_adjustment')::numeric,
            (v_typed ->> 'best_start_age_adjustment')::numeric,
            (v_typed ->> 'best_end_age_adjustment')::numeric,
            (v_typed ->> 'outer_horizon_age_adjustment')::numeric
        ];
        v_trait_values := array[
            (v_typed ->> 'body_adjustment')::numeric,
            (v_typed ->> 'acidity_adjustment')::numeric,
            (v_typed ->> 'tannin_adjustment')::numeric,
            (v_typed ->> 'sweetness_adjustment')::numeric,
            (v_typed ->> 'alcohol_adjustment')::numeric,
            (v_typed ->> 'freshness_adjustment')::numeric,
            (v_typed ->> 'savory_adjustment')::numeric,
            (v_typed ->> 'concentration_adjustment')::numeric
        ];
        if exists (select 1 from unnest(v_age_values) value where value <> trunc(value) or value not between -5 and 10)
           or exists (select 1 from unnest(v_trait_values) value where value not between -2 and 2)
           or (
                v_profile_type = 'vintage'
                and (
                    jsonb_typeof(v_typed -> 'condition_tags') <> 'array'
                    or jsonb_array_length(v_typed -> 'condition_tags') > 16
                )
           )
        then
            raise exception using errcode = '22023', message = 'Profile adjustments are outside the reviewed bounds';
        end if;
    end if;

    if (v_typed - v_mutable_keys) is distinct from (v_current_typed - v_mutable_keys) then
        raise exception using errcode = '22023', message = 'Canonical profile identity fields cannot be revised';
    end if;

    v_normalized := jsonb_build_object(
        'profile_type', v_profile_type,
        'confidence', v_confidence,
        'rationale', v_rationale,
        'typed', v_typed
    );

    if v_normalized = jsonb_build_object(
        'profile_type', v_profile_type,
        'confidence', (v_current ->> 'confidence')::numeric,
        'rationale', v_current ->> 'rationale',
        'typed', v_current_typed
    ) then
        raise exception using errcode = '22023', message = 'A revision must change at least one reviewed value';
    end if;

    return v_normalized;
end;
$$;

revoke execute
on function private.validate_enrichment_profile_revision(uuid, jsonb)
from public, anon, authenticated;


-- Service-owned eligibility changes are the only way to grant shared-library
-- authority. This function is also used by operator tooling.
create or replace function public.set_enrichment_curator_eligibility(
    p_user_id uuid,
    p_display_name text,
    p_status text,
    p_profile_scopes text[],
    p_rationale text,
    p_operator text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event text;
begin
    if p_status not in ('active', 'suspended', 'revoked') then
        raise exception using errcode = '22023', message = 'Curator eligibility status is invalid';
    end if;

    insert into public.enrichment_curator_eligibilities (
        user_id, display_name, eligibility_status, profile_scopes,
        rationale, granted_by, granted_at, revoked_at
    ) values (
        p_user_id, trim(p_display_name), p_status, p_profile_scopes,
        trim(p_rationale), trim(p_operator), now(),
        case when p_status = 'active' then null else now() end
    )
    on conflict (user_id) do update set
        display_name = excluded.display_name,
        eligibility_status = excluded.eligibility_status,
        profile_scopes = excluded.profile_scopes,
        rationale = excluded.rationale,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = excluded.revoked_at;

    v_event := case p_status
        when 'active' then 'eligibility-granted'
        when 'suspended' then 'eligibility-suspended'
        else 'eligibility-revoked'
    end;
    insert into public.enrichment_profile_governance_events (
        event_type, actor_id, detail
    ) values (
        v_event, p_user_id,
        jsonb_build_object(
            'profile_scopes', p_profile_scopes,
            'rationale', trim(p_rationale),
            'operator', trim(p_operator)
        )
    );

    return jsonb_build_object(
        'status', p_status,
        'user_id', p_user_id,
        'profile_scopes', p_profile_scopes
    );
end;
$$;

revoke all
on function public.set_enrichment_curator_eligibility(uuid, text, text, text[], text, text)
from public, anon, authenticated;

grant execute
on function public.set_enrichment_curator_eligibility(uuid, text, text, text[], text, text)
to service_role;


create or replace function public.propose_enrichment_profile_revision(
    p_case_id uuid,
    p_proposal jsonb,
    p_evidence_urls text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_case public.enrichment_profile_review_cases%rowtype;
    v_profile_id uuid;
    v_proposal jsonb;
    v_revision_id uuid;
    v_superseded_revision_id uuid;
    v_hash text;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    select review_case.* into v_case
    from public.enrichment_profile_review_cases review_case
    where review_case.id = p_case_id
    for update;

    if not found or v_case.case_status not in ('open', 'reviewing') then
        raise exception using errcode = '22023', message = 'Profile review case is not open';
    end if;
    perform private.require_enrichment_curator(v_user_id, v_case.profile_type);

    select profile.id into v_profile_id
    from public.enrichment_profiles profile
    join public.enrichment_knowledge_versions version
      on version.id = profile.knowledge_version_id
     and version.status = 'active'
    cross join lateral (
        select private.enrichment_profile_review_subject(profile.id) as subject
    ) resolved
    where resolved.subject ->> 'subject_key' = v_case.subject_key
    limit 1;

    if not found then
        raise exception using errcode = '55000', message = 'The reported subject is not present in the active library';
    end if;

    if exists (
        select 1 from public.enrichment_profile_revisions revision
        where revision.case_id = p_case_id
          and revision.revision_status = 'approved'
    ) then
        raise exception using errcode = '55000', message = 'An approved revision is already awaiting publication';
    end if;

    update public.enrichment_profile_revisions revision
    set revision_status = 'superseded', superseded_at = now()
    where revision.case_id = p_case_id
      and revision.revision_status in ('proposed', 'disputed')
    returning revision.id into v_superseded_revision_id;

    if v_superseded_revision_id is not null then
        insert into public.enrichment_profile_governance_events (
            event_type, actor_id, case_id, revision_id, detail
        ) values (
            'revision-superseded', v_user_id, p_case_id,
            v_superseded_revision_id,
            jsonb_build_object('reason', 'replaced-by-new-proposal')
        );
    end if;

    v_proposal := private.validate_enrichment_profile_revision(v_profile_id, p_proposal);
    if cardinality(p_evidence_urls) not between 1 and 12 then
        raise exception using errcode = '22023', message = 'At least one HTTPS evidence link is required';
    end if;
    v_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_proposal::text, 'UTF8'), 'sha256'),
        'hex'
    );

    insert into public.enrichment_profile_revisions (
        case_id, predecessor_profile_id, proposed_payload, proposal_sha256,
        evidence_urls, proposed_by
    ) values (
        p_case_id, v_profile_id, v_proposal, v_hash,
        p_evidence_urls, v_user_id
    ) returning id into v_revision_id;

    update public.enrichment_profile_review_cases review_case
    set case_status = 'reviewing', updated_at = now()
    where review_case.id = p_case_id;

    update public.enrichment_profile_review_subscriptions subscription
    set notified_at = now(), seen_at = null
    where subscription.case_id = p_case_id;

    insert into public.enrichment_profile_governance_events (
        event_type, actor_id, case_id, revision_id, profile_id, detail
    ) values (
        'revision-proposed', v_user_id, p_case_id, v_revision_id, v_profile_id,
        jsonb_build_object('proposal_sha256', v_hash, 'evidence_urls', p_evidence_urls)
    );

    return jsonb_build_object(
        'status', 'proposed',
        'case_id', p_case_id,
        'revision_id', v_revision_id,
        'proposal_sha256', v_hash
    );
end;
$$;

revoke all
on function public.propose_enrichment_profile_revision(uuid, jsonb, text[])
from public, anon;

grant execute
on function public.propose_enrichment_profile_revision(uuid, jsonb, text[])
to authenticated;


create or replace function public.review_enrichment_profile_revision(
    p_revision_id uuid,
    p_verdict text,
    p_rationale text,
    p_evidence_urls text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_revision public.enrichment_profile_revisions%rowtype;
    v_case public.enrichment_profile_review_cases%rowtype;
    v_status text;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if p_verdict not in ('approve', 'disagree')
       or length(trim(p_rationale)) not between 10 and 2000
       or not private.valid_enrichment_https_urls(p_evidence_urls, 0, 12)
    then
        raise exception using errcode = '22023', message = 'Curator decision is invalid';
    end if;

    select revision.* into v_revision
    from public.enrichment_profile_revisions revision
    where revision.id = p_revision_id
    for update;
    if not found or v_revision.revision_status not in ('proposed', 'approved', 'disputed') then
        raise exception using errcode = '22023', message = 'Profile revision is not reviewable';
    end if;

    select review_case.* into v_case
    from public.enrichment_profile_review_cases review_case
    where review_case.id = v_revision.case_id;
    perform private.require_enrichment_curator(v_user_id, v_case.profile_type);

    insert into public.enrichment_profile_revision_decisions (
        revision_id, curator_id, verdict, rationale, evidence_urls
    ) values (
        p_revision_id, v_user_id, p_verdict, trim(p_rationale), p_evidence_urls
    );

    with latest as (
        select distinct on (decision.curator_id)
            decision.curator_id, decision.verdict
        from public.enrichment_profile_revision_decisions decision
        where decision.revision_id = p_revision_id
        order by decision.curator_id, decision.decision_sequence desc
    )
    select case
        when bool_or(latest.verdict = 'disagree') then 'disputed'
        when bool_or(latest.verdict = 'approve') then 'approved'
        else 'proposed'
    end into v_status
    from latest;

    update public.enrichment_profile_revisions revision
    set revision_status = v_status
    where revision.id = p_revision_id;

    update public.enrichment_profile_review_subscriptions subscription
    set notified_at = now(), seen_at = null
    where subscription.case_id = v_case.id;

    insert into public.enrichment_profile_governance_events (
        event_type, actor_id, case_id, revision_id, profile_id, detail
    ) values (
        case when p_verdict = 'approve' then 'revision-approved' else 'revision-disagreed' end,
        v_user_id, v_case.id, p_revision_id, v_revision.predecessor_profile_id,
        jsonb_build_object('rationale', trim(p_rationale), 'evidence_urls', p_evidence_urls)
    );

    return jsonb_build_object(
        'status', v_status,
        'case_id', v_case.id,
        'revision_id', p_revision_id,
        'verdict', p_verdict
    );
end;
$$;

revoke all
on function public.review_enrichment_profile_revision(uuid, text, text, text[])
from public, anon;

grant execute
on function public.review_enrichment_profile_revision(uuid, text, text, text[])
to authenticated;


create or replace function public.dismiss_enrichment_profile_review_case(
    p_case_id uuid,
    p_rationale text,
    p_evidence_urls text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_case public.enrichment_profile_review_cases%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if length(trim(p_rationale)) not between 10 and 2000 then
        raise exception using errcode = '22023', message = 'A dismissal requires a clear rationale';
    end if;
    if not private.valid_enrichment_https_urls(p_evidence_urls, 0, 12) then
        raise exception using errcode = '22023', message = 'Dismissal evidence links are invalid';
    end if;

    select review_case.* into v_case
    from public.enrichment_profile_review_cases review_case
    where review_case.id = p_case_id
    for update;
    if not found or v_case.case_status not in ('open', 'reviewing') then
        raise exception using errcode = '22023', message = 'Profile review case is not open';
    end if;
    perform private.require_enrichment_curator(v_user_id, v_case.profile_type);

    if exists (
        select 1 from public.enrichment_profile_revisions revision
        where revision.case_id = p_case_id
          and revision.revision_status = 'approved'
    ) then
        raise exception using errcode = '55000', message = 'An approved correction must be published or disputed first';
    end if;

    update public.enrichment_profile_revisions revision
    set revision_status = 'superseded', superseded_at = now()
    where revision.case_id = p_case_id
      and revision.revision_status in ('proposed', 'disputed');

    update public.enrichment_profile_review_cases review_case
    set
        case_status = 'dismissed',
        updated_at = now(),
        resolved_at = now(),
        resolution_summary = trim(p_rationale),
        resolution_profile_id = null
    where review_case.id = p_case_id;

    update public.enrichment_profile_review_subscriptions subscription
    set notified_at = now(), seen_at = null
    where subscription.case_id = p_case_id;

    insert into public.enrichment_profile_governance_events (
        event_type, actor_id, case_id, profile_id, detail
    ) values (
        'case-dismissed', v_user_id, p_case_id, v_case.reported_profile_id,
        jsonb_build_object('rationale', trim(p_rationale), 'evidence_urls', p_evidence_urls)
    );

    return jsonb_build_object('status', 'dismissed', 'case_id', p_case_id);
end;
$$;

revoke all
on function public.dismiss_enrichment_profile_review_case(uuid, text, text[])
from public, anon;

grant execute
on function public.dismiss_enrichment_profile_review_case(uuid, text, text[])
to authenticated;


-- Existing contributors with at least three profile drafts already accepted by
-- the trusted publisher become founding curators. This is a one-time bootstrap,
-- not an automatic promotion rule for future accounts.
insert into public.enrichment_curator_eligibilities (
    user_id, display_name, eligibility_status, profile_scopes,
    rationale, granted_by
)
select
    review.reviewed_by,
    coalesce(
        nullif(trim(user_row.raw_user_meta_data ->> 'full_name'), ''),
        split_part(user_row.email, '@', 1),
        'Founding curator'
    ),
    'active',
    array[
        'place', 'place-adjustment', 'vintage', 'producer-era',
        'producer-vintage-interaction', 'cuvee', 'release'
    ]::text[],
    'Founding curator: at least three profile drafts previously accepted by the trusted publication boundary.',
    'migration:0.4.18'
from public.enrichment_research_reviews review
join public.enrichment_research_drafts draft on draft.id = review.draft_id
join auth.users user_row on user_row.id = review.reviewed_by
where draft.proposal_kind = 'profile'
  and draft.draft_status = 'published'
  and review.verdict in ('accepted', 'edited')
group by review.reviewed_by, user_row.raw_user_meta_data, user_row.email
having count(distinct draft.id) >= 3
on conflict (user_id) do nothing;

insert into public.enrichment_profile_governance_events (
    event_type, actor_id, detail
)
select
    'eligibility-granted', curator.user_id,
    jsonb_build_object(
        'profile_scopes', curator.profile_scopes,
        'rationale', curator.rationale,
        'operator', curator.granted_by
    )
from public.enrichment_curator_eligibilities curator
where curator.granted_by = 'migration:0.4.18';

commit;
