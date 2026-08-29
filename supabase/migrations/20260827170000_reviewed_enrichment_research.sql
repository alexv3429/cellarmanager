begin;

-- Research is deliberately split into four durable stages:
-- request -> attributable draft -> household review -> trusted publication.
-- Browser users can request and review work that affects their household, but
-- only service_role code can inspect the global queue, write research results,
-- or publish shared knowledge.
create table public.enrichment_research_source_rules (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null,
    source_policy_id uuid not null,
    hostname text not null,
    path_prefix text not null default '/',
    subject_types text[] not null,
    subject_aliases text[] not null default '{}'::text[],
    claim_types text[] not null,
    search_query_template text not null,
    max_pages integer not null default 2,
    status text not null default 'active',
    created_at timestamptz not null default now(),

    constraint enrichment_research_source_rules_policy_fk
        foreign key (source_policy_id, source_id)
        references public.enrichment_source_policies(id, source_id),
    constraint enrichment_research_source_rules_identity_unique
        unique (source_policy_id, hostname, path_prefix),
    constraint enrichment_research_source_rules_hostname_check
        check (
            hostname = lower(trim(hostname))
            and hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
            and hostname not like '%.%..%'
        ),
    constraint enrichment_research_source_rules_path_check
        check (path_prefix like '/%' and position('..' in path_prefix) = 0),
    constraint enrichment_research_source_rules_subjects_check
        check (
            cardinality(subject_types) between 1 and 8
            and subject_types <@ array[
                'fact',
                'place-profile',
                'vintage-profile',
                'producer-profile',
                'cuvee-profile'
            ]::text[]
        ),
    constraint enrichment_research_source_rules_claims_check
        check (
            cardinality(claim_types) between 1 and 8
            and claim_types <@ array[
                'legal-definition',
                'vintage-conditions',
                'producer-style',
                'cuvee-site',
                'wine-structure',
                'maturity-window',
                'food-pairing'
            ]::text[]
        ),
    constraint enrichment_research_source_rules_aliases_check
        check (
            cardinality(subject_aliases) <= 32
            and array_position(subject_aliases, null) is null
        ),
    constraint enrichment_research_source_rules_query_check
        check (
            length(trim(search_query_template)) between 3 and 500
            and position('{subject}' in search_query_template) > 0
        ),
    constraint enrichment_research_source_rules_max_pages_check
        check (max_pages between 1 and 5),
    constraint enrichment_research_source_rules_status_check
        check (status in ('active', 'retired'))
);

comment on table public.enrichment_research_source_rules is
    'Service-reviewed allowlist for low-rate, pointer-only research against exact HTTPS hosts and paths.';

create or replace function private.validate_enrichment_research_source_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_policy public.enrichment_source_policies%rowtype;
begin
    select policy.*
    into v_policy
    from public.enrichment_source_policies policy
    where policy.id = new.source_policy_id
      and policy.source_id = new.source_id;

    if not found
       or v_policy.status <> 'reviewed'
       or v_policy.display_right <> 'allowed'
       or v_policy.retention_right <> 'allowed'
       or v_policy.cross_household_reuse_right <> 'allowed'
       or v_policy.effective_from > current_date
       or (v_policy.effective_to is not null and v_policy.effective_to < current_date)
    then
        raise exception using
            errcode = '23514',
            message = 'Research sources require a current reviewed pointer-reuse policy';
    end if;

    return new;
end;
$$;

revoke execute
on function private.validate_enrichment_research_source_rule()
from public, anon, authenticated;

create trigger enrichment_research_source_rules_validate
before insert or update on public.enrichment_research_source_rules
for each row execute function private.validate_enrichment_research_source_rule();


create table public.enrichment_research_cases (
    id uuid primary key default gen_random_uuid(),
    subject_key text not null unique,
    subject_type text not null,
    gap_type text not null,
    claim_type text not null,
    field_name text,
    subject_snapshot jsonb not null,
    place_id uuid references public.enrichment_places(id),
    producer_id uuid references public.wine_reference_producers(id),
    product_id uuid references public.wine_reference_products(id),
    release_id uuid references public.wine_reference_releases(id),
    vintage_year integer,
    wine_color text,
    case_status text not null default 'queued',
    priority integer not null default 0,
    attempt_count integer not null default 0,
    next_attempt_at timestamptz,
    lease_token uuid,
    leased_by text,
    lease_expires_at timestamptz,
    last_error_code text,
    requested_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    published_at timestamptz,

    constraint enrichment_research_cases_subject_key_check
        check (length(subject_key) between 3 and 500),
    constraint enrichment_research_cases_subject_type_check
        check (subject_type in (
            'fact',
            'place-profile',
            'vintage-profile',
            'producer-profile',
            'cuvee-profile'
        )),
    constraint enrichment_research_cases_gap_type_check
        check (gap_type in (
            'fact-country',
            'fact-grapes',
            'fact-sweetness',
            'fact-alcohol',
            'profile-place',
            'profile-vintage',
            'profile-producer',
            'profile-cuvee'
        )),
    constraint enrichment_research_cases_claim_type_check
        check (claim_type in (
            'legal-definition',
            'vintage-conditions',
            'producer-style',
            'cuvee-site',
            'wine-structure',
            'maturity-window',
            'food-pairing'
        )),
    constraint enrichment_research_cases_snapshot_check
        check (jsonb_typeof(subject_snapshot) = 'object'),
    constraint enrichment_research_cases_vintage_check
        check (vintage_year is null or vintage_year between 1800 and 2200),
    constraint enrichment_research_cases_color_check
        check (
            wine_color is null
            or wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
        ),
    constraint enrichment_research_cases_status_check
        check (case_status in (
            'queued',
            'researching',
            'draft-ready',
            'owner-reviewed',
            'needs-identity-review',
            'needs-source-review',
            'not-found',
            'retrying',
            'failed',
            'published'
        )),
    constraint enrichment_research_cases_priority_check
        check (priority between 0 and 1000000000),
    constraint enrichment_research_cases_attempt_check
        check (attempt_count between 0 and 20),
    constraint enrichment_research_cases_lease_check
        check (
            (case_status = 'researching'
                and lease_token is not null
                and leased_by is not null
                and lease_expires_at is not null)
            or (case_status <> 'researching'
                and lease_token is null
                and leased_by is null
                and lease_expires_at is null)
        ),
    constraint enrichment_research_cases_publication_check
        check (
            (case_status = 'published' and published_at is not null)
            or (case_status <> 'published' and published_at is null)
        )
);

create index enrichment_research_cases_queue_idx
    on public.enrichment_research_cases(case_status, priority desc, requested_at)
    where case_status in ('queued', 'retrying');


create table public.enrichment_research_subscriptions (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null
        references public.enrichment_research_cases(id)
        on delete cascade,
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    exemplar_wine_id uuid not null,
    requested_by uuid not null
        references auth.users(id)
        on delete cascade,
    subscription_status text not null default 'open',
    requested_at timestamptz not null default now(),
    notified_at timestamptz,
    seen_at timestamptz,

    constraint enrichment_research_subscriptions_case_household_unique
        unique (case_id, household_id),
    constraint enrichment_research_subscriptions_wine_fk
        foreign key (exemplar_wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint enrichment_research_subscriptions_status_check
        check (subscription_status in ('open', 'reviewed', 'rejected', 'published')),
    constraint enrichment_research_subscriptions_seen_check
        check (seen_at is null or notified_at is not null)
);

create index enrichment_research_subscriptions_household_idx
    on public.enrichment_research_subscriptions(household_id, requested_at desc);


create table public.enrichment_research_drafts (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null
        references public.enrichment_research_cases(id)
        on delete cascade,
    revision integer not null,
    proposal_kind text not null,
    proposal jsonb not null,
    rationale text not null,
    confidence numeric(4, 3) not null,
    synthesis_model text not null,
    draft_status text not null default 'ready',
    created_at timestamptz not null default now(),
    published_at timestamptz,

    constraint enrichment_research_drafts_case_revision_unique
        unique (case_id, revision),
    constraint enrichment_research_drafts_revision_check
        check (revision > 0),
    constraint enrichment_research_drafts_kind_check
        check (proposal_kind in ('fact', 'profile')),
    constraint enrichment_research_drafts_proposal_check
        check (jsonb_typeof(proposal) = 'object'),
    constraint enrichment_research_drafts_rationale_check
        check (length(trim(rationale)) between 10 and 4000),
    constraint enrichment_research_drafts_confidence_check
        check (confidence between 0 and 1),
    constraint enrichment_research_drafts_model_check
        check (length(trim(synthesis_model)) between 3 and 200),
    constraint enrichment_research_drafts_status_check
        check (draft_status in ('ready', 'superseded', 'published', 'rejected')),
    constraint enrichment_research_drafts_publication_check
        check (
            (draft_status = 'published' and published_at is not null)
            or (draft_status <> 'published' and published_at is null)
        )
);

create unique index enrichment_research_drafts_one_ready_idx
    on public.enrichment_research_drafts(case_id)
    where draft_status = 'ready';


create table public.enrichment_research_draft_sources (
    draft_id uuid not null
        references public.enrichment_research_drafts(id)
        on delete cascade,
    source_rule_id uuid not null
        references public.enrichment_research_source_rules(id),
    source_id uuid not null,
    source_policy_id uuid not null,
    source_record_url text not null,
    retrieved_at timestamptz not null,
    created_at timestamptz not null default now(),

    primary key (draft_id, source_record_url),
    constraint enrichment_research_draft_sources_policy_fk
        foreign key (source_policy_id, source_id)
        references public.enrichment_source_policies(id, source_id),
    constraint enrichment_research_draft_sources_url_check
        check (source_record_url like 'https://%')
);

create or replace function private.https_url_hostname(p_url text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select lower(split_part(split_part(substring(p_url from 9), '/', 1), ':', 1));
$$;

revoke execute
on function private.https_url_hostname(text)
from public, anon, authenticated;

create or replace function private.https_url_path(p_url text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select coalesce(
        nullif(
            regexp_replace(
                split_part(split_part(substring(p_url from 9), '?', 1), '#', 1),
                '^[^/]*',
                ''
            ),
            ''
        ),
        '/'
    );
$$;

revoke execute
on function private.https_url_path(text)
from public, anon, authenticated;

create or replace function private.validate_enrichment_research_draft_source()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_rule public.enrichment_research_source_rules%rowtype;
begin
    select rule.*
    into v_rule
    from public.enrichment_research_source_rules rule
    where rule.id = new.source_rule_id;

    if not found
       or v_rule.status <> 'active'
       or v_rule.source_id <> new.source_id
       or v_rule.source_policy_id <> new.source_policy_id
       or private.https_url_hostname(new.source_record_url) <> v_rule.hostname
       or not (
           v_rule.path_prefix = '/'
           or private.https_url_path(new.source_record_url) = rtrim(v_rule.path_prefix, '/')
           or private.https_url_path(new.source_record_url)
                like rtrim(v_rule.path_prefix, '/') || '/%'
       )
    then
        raise exception using
            errcode = '23514',
            message = 'Research draft source is outside its reviewed allowlist rule';
    end if;

    return new;
end;
$$;

revoke execute
on function private.validate_enrichment_research_draft_source()
from public, anon, authenticated;

create trigger enrichment_research_draft_sources_validate
before insert or update on public.enrichment_research_draft_sources
for each row execute function private.validate_enrichment_research_draft_source();


create table public.enrichment_research_reviews (
    id uuid primary key default gen_random_uuid(),
    draft_id uuid not null
        references public.enrichment_research_drafts(id)
        on delete cascade,
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    reviewed_by uuid not null
        references auth.users(id)
        on delete cascade,
    verdict text not null,
    reviewed_proposal jsonb,
    note text,
    created_at timestamptz not null default now(),

    constraint enrichment_research_reviews_verdict_check
        check (verdict in ('accepted', 'edited', 'rejected')),
    constraint enrichment_research_reviews_proposal_check
        check (
            (verdict = 'rejected' and reviewed_proposal is null)
            or (
                verdict in ('accepted', 'edited')
                and jsonb_typeof(reviewed_proposal) = 'object'
            )
        ),
    constraint enrichment_research_reviews_note_check
        check (note is null or length(trim(note)) between 1 and 2000)
);

create index enrichment_research_reviews_latest_idx
    on public.enrichment_research_reviews(draft_id, household_id, created_at desc);


create table public.enrichment_researched_fact_claims (
    id uuid primary key default gen_random_uuid(),
    draft_id uuid not null unique
        references public.enrichment_research_drafts(id),
    product_id uuid references public.wine_reference_products(id),
    release_id uuid references public.wine_reference_releases(id),
    field_name text not null,
    claim_value jsonb not null,
    rationale text not null,
    confidence numeric(4, 3) not null,
    reviewed_by uuid not null references auth.users(id),
    reviewed_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint enrichment_researched_fact_claims_scope_check
        check (num_nonnulls(product_id, release_id) = 1),
    constraint enrichment_researched_fact_claims_field_check
        check (field_name in ('country', 'grapes', 'sweetness', 'alcohol')),
    constraint enrichment_researched_fact_claims_value_check
        check (jsonb_typeof(claim_value) in ('string', 'number', 'array')),
    constraint enrichment_researched_fact_claims_rationale_check
        check (length(trim(rationale)) between 10 and 4000),
    constraint enrichment_researched_fact_claims_confidence_check
        check (confidence between 0 and 1)
);

create table public.enrichment_researched_fact_claim_evidence (
    claim_id uuid not null
        references public.enrichment_researched_fact_claims(id),
    evidence_id uuid not null
        references public.enrichment_evidence(id),
    primary key (claim_id, evidence_id)
);

create index enrichment_researched_fact_claims_product_idx
    on public.enrichment_researched_fact_claims(product_id, field_name);

create index enrichment_researched_fact_claims_release_idx
    on public.enrichment_researched_fact_claims(release_id, field_name);

create or replace function private.protect_published_research_artifact()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception using
        errcode = '23514',
        message = 'Published research artifacts are immutable';
end;
$$;

revoke execute
on function private.protect_published_research_artifact()
from public, anon, authenticated;

create trigger enrichment_researched_fact_claims_immutable
before update or delete on public.enrichment_researched_fact_claims
for each row execute function private.protect_published_research_artifact();

create trigger enrichment_researched_fact_claim_evidence_immutable
before update or delete on public.enrichment_researched_fact_claim_evidence
for each row execute function private.protect_published_research_artifact();


alter table public.enrichment_research_source_rules enable row level security;
alter table public.enrichment_research_cases enable row level security;
alter table public.enrichment_research_subscriptions enable row level security;
alter table public.enrichment_research_drafts enable row level security;
alter table public.enrichment_research_draft_sources enable row level security;
alter table public.enrichment_research_reviews enable row level security;
alter table public.enrichment_researched_fact_claims enable row level security;
alter table public.enrichment_researched_fact_claim_evidence enable row level security;

revoke all on table public.enrichment_research_source_rules from public, anon, authenticated;
revoke all on table public.enrichment_research_cases from public, anon, authenticated;
revoke all on table public.enrichment_research_subscriptions from public, anon, authenticated;
revoke all on table public.enrichment_research_drafts from public, anon, authenticated;
revoke all on table public.enrichment_research_draft_sources from public, anon, authenticated;
revoke all on table public.enrichment_research_reviews from public, anon, authenticated;
revoke all on table public.enrichment_researched_fact_claims from public, anon, authenticated;
revoke all on table public.enrichment_researched_fact_claim_evidence from public, anon, authenticated;

grant select, insert, update, delete on table public.enrichment_research_source_rules to service_role;
grant select, insert, update, delete on table public.enrichment_research_cases to service_role;
grant select, insert, update, delete on table public.enrichment_research_subscriptions to service_role;
grant select, insert, update, delete on table public.enrichment_research_drafts to service_role;
grant select, insert, update, delete on table public.enrichment_research_draft_sources to service_role;
grant select, insert, update, delete on table public.enrichment_research_reviews to service_role;
grant select, insert on table public.enrichment_researched_fact_claims to service_role;
grant select, insert on table public.enrichment_researched_fact_claim_evidence to service_role;


-- Resolve the shared identity that a household request is actually about.
-- Raw text is retained for display but is never enough to publish a producer
-- or cuvee profile without a confirmed shared reference or owner preference.
create or replace function private.enrichment_research_subject(
    p_wine_id uuid,
    p_gap_type text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
    v_wine public.wines%rowtype;
    v_product_id uuid;
    v_release_id uuid;
    v_producer_id uuid;
    v_place_id uuid;
    v_color text;
    v_subject_type text;
    v_claim_type text;
    v_field_name text;
    v_identity_status text := 'queued';
    v_identity_id text;
    v_subject_key text;
    v_title text;
begin
    select wine.* into v_wine
    from public.wines wine
    where wine.id = p_wine_id;

    if not found then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;

    v_color := private.canonical_enrichment_wine_color(v_wine.color);

    if v_wine.wine_reference_type = 'product' then
        v_product_id := v_wine.wine_reference_id;
    elsif v_wine.wine_reference_type = 'release' then
        v_release_id := v_wine.wine_reference_id;
        select release.product_id into v_product_id
        from public.wine_reference_releases release
        where release.id = v_release_id;
    elsif v_wine.wine_reference_type = 'package' then
        select package.release_id, release.product_id
        into v_release_id, v_product_id
        from public.wine_reference_packages package
        join public.wine_reference_releases release on release.id = package.release_id
        where package.id = v_wine.wine_reference_id;
    end if;

    if v_product_id is not null then
        select product.producer_id into v_producer_id
        from public.wine_reference_products product
        where product.id = v_product_id;
    end if;

    if v_producer_id is null then
        select preference.producer_id into v_producer_id
        from public.wine_reference_household_producer_preferences preference
        where preference.household_id = v_wine.household_id
          and preference.source_producer_normalized =
              private.normalize_wine_reference_text(v_wine.producer);
    end if;

    select alias.place_id into v_place_id
    from public.enrichment_place_aliases alias
    where alias.normalized_value = private.normalize_wine_reference_text(
        coalesce(nullif(trim(v_wine.appellation), ''), nullif(trim(v_wine.area), ''))
    )
    limit 1;

    case p_gap_type
        when 'fact-country' then
            v_subject_type := 'fact';
            v_claim_type := 'legal-definition';
            v_field_name := 'country';
        when 'fact-grapes' then
            v_subject_type := 'fact';
            v_claim_type := 'legal-definition';
            v_field_name := 'grapes';
        when 'fact-sweetness' then
            v_subject_type := 'fact';
            v_claim_type := 'wine-structure';
            v_field_name := 'sweetness';
        when 'fact-alcohol' then
            v_subject_type := 'fact';
            v_claim_type := 'wine-structure';
            v_field_name := 'alcohol';
        when 'profile-place' then
            v_subject_type := 'place-profile';
            v_claim_type := 'wine-structure';
        when 'profile-vintage' then
            v_subject_type := 'vintage-profile';
            v_claim_type := 'vintage-conditions';
        when 'profile-producer' then
            v_subject_type := 'producer-profile';
            v_claim_type := 'producer-style';
        when 'profile-cuvee' then
            v_subject_type := 'cuvee-profile';
            v_claim_type := 'cuvee-site';
        else
            raise exception using
                errcode = '22023',
                message = 'This catalog gap is not researchable';
    end case;

    if v_subject_type = 'fact' then
        if v_field_name = 'alcohol' then
            v_identity_id := v_release_id::text;
        else
            v_identity_id := coalesce(v_release_id, v_product_id)::text;
        end if;
        if v_identity_id is null then
            v_identity_status := 'needs-identity-review';
            v_identity_id := private.normalize_wine_reference_text(
                concat_ws(' ', v_wine.producer, v_wine.cuvee, v_wine.vintage, v_wine.color)
            );
        end if;
        v_title := initcap(v_field_name) || ': ' || v_wine.producer || ' — ' || v_wine.cuvee;
    elsif v_subject_type in ('place-profile', 'vintage-profile') then
        v_identity_id := v_place_id::text;
        if v_place_id is null or (v_subject_type = 'vintage-profile' and v_wine.vintage is null) then
            v_identity_status := 'needs-identity-review';
            v_identity_id := private.normalize_wine_reference_text(
                coalesce(v_wine.appellation, v_wine.area, 'unknown place')
            );
        end if;
        v_title := case when v_subject_type = 'place-profile'
            then 'Place profile: ' || coalesce(v_wine.appellation, v_wine.area, 'Unknown place')
            else 'Vintage profile: ' || coalesce(v_wine.appellation, v_wine.area, 'Unknown place') || ' ' || coalesce(v_wine.vintage::text, 'NV')
        end;
    elsif v_subject_type = 'producer-profile' then
        v_identity_id := v_producer_id::text;
        if v_producer_id is null then
            v_identity_status := 'needs-identity-review';
            v_identity_id := private.normalize_wine_reference_text(v_wine.producer);
        end if;
        v_title := 'Producer profile: ' || v_wine.producer || ' · ' || v_color;
    else
        v_identity_id := v_product_id::text;
        if v_product_id is null then
            v_identity_status := 'needs-identity-review';
            v_identity_id := private.normalize_wine_reference_text(
                concat_ws(' ', v_wine.producer, v_wine.cuvee)
            );
        end if;
        v_title := 'Cuvée profile: ' || v_wine.producer || ' — ' || v_wine.cuvee;
    end if;

    v_subject_key := concat_ws(':',
        v_subject_type,
        v_field_name,
        v_identity_id,
        case when v_subject_type = 'vintage-profile' then v_wine.vintage::text else null end,
        v_color
    );

    return jsonb_build_object(
        'subject_key', v_subject_key,
        'subject_type', v_subject_type,
        'gap_type', p_gap_type,
        'claim_type', v_claim_type,
        'field_name', v_field_name,
        'identity_status', v_identity_status,
        'place_id', v_place_id,
        'producer_id', v_producer_id,
        'product_id', v_product_id,
        'release_id', v_release_id,
        'vintage_year', v_wine.vintage,
        'wine_color', v_color,
        'snapshot', jsonb_build_object(
            'title', v_title,
            'producer', v_wine.producer,
            'cuvee', v_wine.cuvee,
            'vintage', v_wine.vintage,
            'color', v_color,
            'appellation', v_wine.appellation,
            'area', v_wine.area,
            'search_subject', trim(concat_ws(' ',
                v_wine.producer,
                case when v_subject_type = 'cuvee-profile' then v_wine.cuvee else null end,
                case when v_subject_type = 'vintage-profile' then v_wine.vintage::text else null end,
                coalesce(v_wine.appellation, v_wine.area)
            ))
        )
    );
end;
$$;

revoke execute
on function private.enrichment_research_subject(uuid, text)
from public, anon, authenticated;


create or replace function public.get_household_enrichment_research_inbox(
    p_household_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if not exists (
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    select coalesce(jsonb_agg(item.payload order by item.requested_at desc, item.case_id), '[]'::jsonb)
    into v_result
    from (
        select
            subscription.requested_at,
            research_case.id as case_id,
            jsonb_build_object(
                'case_id', research_case.id,
                'subject_key', research_case.subject_key,
                'subject_type', research_case.subject_type,
                'gap_type', research_case.gap_type,
                'status', research_case.case_status,
                'subject', research_case.subject_snapshot,
                'requested_at', subscription.requested_at,
                'notified_at', subscription.notified_at,
                'seen_at', subscription.seen_at,
                'subscription_status', subscription.subscription_status,
                'last_error_code', research_case.last_error_code,
                'draft', case when draft.id is null then null else jsonb_build_object(
                    'id', draft.id,
                    'revision', draft.revision,
                    'proposal_kind', draft.proposal_kind,
                    'proposal', draft.proposal,
                    'rationale', draft.rationale,
                    'confidence', draft.confidence,
                    'synthesis_model', draft.synthesis_model,
                    'created_at', draft.created_at,
                    'sources', coalesce(sources.items, '[]'::jsonb),
                    'review', review.payload
                ) end
            ) as payload
        from public.enrichment_research_subscriptions subscription
        join public.enrichment_research_cases research_case
          on research_case.id = subscription.case_id
        left join lateral (
            select candidate.*
            from public.enrichment_research_drafts candidate
            where candidate.case_id = research_case.id
              and candidate.draft_status in ('ready', 'published')
            order by candidate.revision desc
            limit 1
        ) draft on true
        left join lateral (
            select jsonb_agg(jsonb_build_object(
                'name', source.source_name,
                'url', draft_source.source_record_url,
                'retrieved_at', draft_source.retrieved_at,
                'attribution', policy.attribution_text
            ) order by source.source_name, draft_source.source_record_url) as items
            from public.enrichment_research_draft_sources draft_source
            join public.enrichment_sources source on source.id = draft_source.source_id
            join public.enrichment_source_policies policy on policy.id = draft_source.source_policy_id
            where draft_source.draft_id = draft.id
        ) sources on true
        left join lateral (
            select jsonb_build_object(
                'id', candidate.id,
                'verdict', candidate.verdict,
                'proposal', candidate.reviewed_proposal,
                'note', candidate.note,
                'created_at', candidate.created_at
            ) as payload
            from public.enrichment_research_reviews candidate
            where candidate.draft_id = draft.id
              and candidate.household_id = p_household_id
            order by candidate.created_at desc, candidate.id desc
            limit 1
        ) review on true
        where subscription.household_id = p_household_id
    ) item;

    return jsonb_build_object(
        'status', 'available',
        'items', v_result,
        'unread_count', (
            select count(*)::integer
            from public.enrichment_research_subscriptions subscription
            where subscription.household_id = p_household_id
              and subscription.notified_at is not null
              and subscription.seen_at is null
        )
    );
end;
$$;

revoke all
on function public.get_household_enrichment_research_inbox(uuid)
from public, anon;

grant execute
on function public.get_household_enrichment_research_inbox(uuid)
to authenticated;


create or replace function public.request_enrichment_research(
    p_household_id uuid,
    p_wine_id uuid,
    p_gap_type text,
    p_priority integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_subject jsonb;
    v_case_id uuid;
    v_case_status text;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if p_priority not between 0 and 1000000000 then
        raise exception using errcode = '22023', message = 'Research priority is outside its allowed range';
    end if;

    if not exists (
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
          and member.role = 'owner'
    ) then
        raise exception using errcode = '42501', message = 'Only household owners can request shared research';
    end if;

    if not exists (
        select 1 from public.wines wine
        where wine.id = p_wine_id
          and wine.household_id = p_household_id
    ) then
        raise exception using errcode = '22023', message = 'Wine does not belong to this household';
    end if;

    v_subject := private.enrichment_research_subject(p_wine_id, p_gap_type);
    v_case_status := v_subject ->> 'identity_status';

    insert into public.enrichment_research_cases (
        subject_key,
        subject_type,
        gap_type,
        claim_type,
        field_name,
        subject_snapshot,
        place_id,
        producer_id,
        product_id,
        release_id,
        vintage_year,
        wine_color,
        case_status,
        priority
    ) values (
        v_subject ->> 'subject_key',
        v_subject ->> 'subject_type',
        v_subject ->> 'gap_type',
        v_subject ->> 'claim_type',
        v_subject ->> 'field_name',
        v_subject -> 'snapshot',
        (v_subject ->> 'place_id')::uuid,
        (v_subject ->> 'producer_id')::uuid,
        (v_subject ->> 'product_id')::uuid,
        (v_subject ->> 'release_id')::uuid,
        (v_subject ->> 'vintage_year')::integer,
        v_subject ->> 'wine_color',
        v_case_status,
        p_priority
    )
    on conflict (subject_key) do update
    set
        priority = greatest(public.enrichment_research_cases.priority, excluded.priority),
        requested_at = now(),
        updated_at = now(),
        case_status = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then 'queued'
            else public.enrichment_research_cases.case_status
        end,
        attempt_count = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then 0
            else public.enrichment_research_cases.attempt_count
        end,
        next_attempt_at = null,
        last_error_code = case
            when public.enrichment_research_cases.case_status in ('not-found', 'failed')
                then null
            else public.enrichment_research_cases.last_error_code
        end
    returning id, case_status into v_case_id, v_case_status;

    insert into public.enrichment_research_subscriptions (
        case_id,
        household_id,
        exemplar_wine_id,
        requested_by,
        notified_at
    ) values (
        v_case_id,
        p_household_id,
        p_wine_id,
        v_user_id,
        case when v_case_status in ('draft-ready', 'owner-reviewed', 'published') then now() else null end
    )
    on conflict (case_id, household_id) do update
    set
        exemplar_wine_id = excluded.exemplar_wine_id,
        requested_by = excluded.requested_by,
        requested_at = now(),
        notified_at = coalesce(public.enrichment_research_subscriptions.notified_at, excluded.notified_at);

    return public.get_household_enrichment_research_inbox(p_household_id);
end;
$$;

revoke all
on function public.request_enrichment_research(uuid, uuid, text, integer)
from public, anon;

grant execute
on function public.request_enrichment_research(uuid, uuid, text, integer)
to authenticated;


create or replace function public.mark_enrichment_research_seen(
    p_household_id uuid,
    p_case_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if not exists (
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    update public.enrichment_research_subscriptions subscription
    set seen_at = now()
    where subscription.household_id = p_household_id
      and subscription.notified_at is not null
      and (p_case_id is null or subscription.case_id = p_case_id);

    return public.get_household_enrichment_research_inbox(p_household_id);
end;
$$;

revoke all
on function public.mark_enrichment_research_seen(uuid, uuid)
from public, anon;

grant execute
on function public.mark_enrichment_research_seen(uuid, uuid)
to authenticated;


create or replace function private.validate_enrichment_research_proposal(
    p_case_id uuid,
    p_proposal jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
    v_case public.enrichment_research_cases%rowtype;
    v_profile_type text;
    v_key text;
    v_number numeric;
    v_previous_age numeric;
    v_item jsonb;
    v_percentage_total numeric := 0;
begin
    select research_case.* into v_case
    from public.enrichment_research_cases research_case
    where research_case.id = p_case_id;

    if not found or jsonb_typeof(p_proposal) <> 'object' then
        raise exception using errcode = '22023', message = 'Research proposal is invalid';
    end if;

    if jsonb_typeof(p_proposal -> 'rationale') <> 'string'
       or length(trim(p_proposal ->> 'rationale')) not between 10 and 1200
       or jsonb_typeof(p_proposal -> 'confidence') <> 'number'
       or (p_proposal ->> 'confidence')::numeric not between 0 and 0.85
    then
        raise exception using errcode = '22023', message = 'Research rationale or confidence is invalid';
    end if;

    if v_case.subject_type = 'fact' then
        if p_proposal ->> 'field_name' <> v_case.field_name
           or p_proposal -> 'value' is null
        then
            raise exception using errcode = '22023', message = 'Research fact does not match its subject';
        end if;

        if v_case.field_name = 'country' then
            if jsonb_typeof(p_proposal -> 'value') <> 'string'
               or length(trim(p_proposal ->> 'value')) not between 1 and 80
            then
                raise exception using errcode = '22023', message = 'Research country is invalid';
            end if;
        elsif v_case.field_name = 'grapes' then
            if jsonb_typeof(p_proposal -> 'value') <> 'array'
               or jsonb_array_length(p_proposal -> 'value') not between 1 and 20
            then
                raise exception using errcode = '22023', message = 'Research grape list is invalid';
            end if;
            for v_item in select value from jsonb_array_elements(p_proposal -> 'value')
            loop
                if jsonb_typeof(v_item) <> 'object'
                   or jsonb_typeof(v_item -> 'name') <> 'string'
                   or length(trim(v_item ->> 'name')) not between 1 and 120
                then
                    raise exception using errcode = '22023', message = 'Research grape is invalid';
                end if;
                if v_item -> 'percentage' is not null
                   and v_item -> 'percentage' <> 'null'::jsonb
                then
                    if jsonb_typeof(v_item -> 'percentage') <> 'number'
                       or (v_item ->> 'percentage')::numeric not between 0.1 and 100
                    then
                        raise exception using errcode = '22023', message = 'Research grape percentage is invalid';
                    end if;
                    v_percentage_total := v_percentage_total + (v_item ->> 'percentage')::numeric;
                end if;
            end loop;
            if v_percentage_total > 100 then
                raise exception using errcode = '22023', message = 'Research grape percentages exceed 100 percent';
            end if;
        elsif v_case.field_name = 'sweetness' then
            if jsonb_typeof(p_proposal -> 'value') <> 'string'
               or p_proposal ->> 'value' not in (
                   'bone-dry', 'dry', 'off-dry', 'medium-sweet', 'sweet'
               )
            then
                raise exception using errcode = '22023', message = 'Research sweetness is invalid';
            end if;
        elsif v_case.field_name = 'alcohol' then
            if jsonb_typeof(p_proposal -> 'value') <> 'number'
               or (p_proposal ->> 'value')::numeric not between 0.1 and 30
            then
                raise exception using errcode = '22023', message = 'Research alcohol is invalid';
            end if;
        else
            raise exception using errcode = '22023', message = 'Research fact field is unsupported';
        end if;
        return;
    end if;

    v_profile_type := p_proposal ->> 'profile_type';
    if (v_case.subject_type = 'place-profile' and v_profile_type not in ('place', 'place-adjustment'))
       or (v_case.subject_type = 'vintage-profile' and v_profile_type <> 'vintage')
       or (v_case.subject_type = 'producer-profile' and v_profile_type <> 'producer-era')
       or (v_case.subject_type = 'cuvee-profile' and v_profile_type <> 'cuvee')
    then
        raise exception using errcode = '22023', message = 'Research profile does not match its subject';
    end if;

    if v_profile_type = 'place' then
        if jsonb_typeof(p_proposal -> 'ages') <> 'object'
           or jsonb_typeof(p_proposal -> 'traits') <> 'object'
        then
            raise exception using errcode = '22023', message = 'Research place profile is incomplete';
        end if;
        v_previous_age := null;
        foreach v_key in array array['first_trial', 'best_start', 'best_end', 'outer_horizon']
        loop
            if jsonb_typeof(p_proposal #> array['ages', v_key]) <> 'number' then
                raise exception using errcode = '22023', message = 'Research drinking age is invalid';
            end if;
            v_number := (p_proposal #>> array['ages', v_key])::numeric;
            if v_number not between 0 and 100 or v_number <> trunc(v_number)
               or (v_previous_age is not null and v_number < v_previous_age)
            then
                raise exception using errcode = '22023', message = 'Research drinking ages must be bounded and ordered';
            end if;
            v_previous_age := v_number;
        end loop;
        foreach v_key in array array['body', 'acidity', 'tannin', 'sweetness', 'alcohol', 'freshness', 'savory', 'concentration']
        loop
            if jsonb_typeof(p_proposal #> array['traits', v_key]) <> 'number'
               or (p_proposal #>> array['traits', v_key])::numeric not between 0 and 5
            then
                raise exception using errcode = '22023', message = 'Research structure trait is invalid';
            end if;
        end loop;
    else
        if jsonb_typeof(p_proposal -> 'age_adjustments') <> 'object'
           or jsonb_typeof(p_proposal -> 'trait_adjustments') <> 'object'
        then
            raise exception using errcode = '22023', message = 'Research profile adjustments are incomplete';
        end if;
        foreach v_key in array array['first_trial', 'best_start', 'best_end', 'outer_horizon']
        loop
            if jsonb_typeof(p_proposal #> array['age_adjustments', v_key]) <> 'number' then
                raise exception using errcode = '22023', message = 'Research drinking adjustment is invalid';
            end if;
            v_number := (p_proposal #>> array['age_adjustments', v_key])::numeric;
            if v_number not between -5 and 10 or v_number <> trunc(v_number) then
                raise exception using errcode = '22023', message = 'Research drinking adjustment is invalid';
            end if;
        end loop;
        foreach v_key in array array['body', 'acidity', 'tannin', 'sweetness', 'alcohol', 'freshness', 'savory', 'concentration']
        loop
            if jsonb_typeof(p_proposal #> array['trait_adjustments', v_key]) <> 'number'
               or (p_proposal #>> array['trait_adjustments', v_key])::numeric not between -2 and 2
            then
                raise exception using errcode = '22023', message = 'Research structure adjustment is invalid';
            end if;
        end loop;
    end if;

    if v_profile_type = 'producer-era' then
        foreach v_key in array array['first_vintage_year', 'final_vintage_year']
        loop
            if jsonb_typeof(p_proposal -> v_key) <> 'number' then
                raise exception using errcode = '22023', message = 'Research producer era is invalid';
            end if;
            v_number := (p_proposal ->> v_key)::numeric;
            if v_number not between 1800 and 2200 or v_number <> trunc(v_number) then
                raise exception using errcode = '22023', message = 'Research producer era is invalid';
            end if;
        end loop;
        if (p_proposal ->> 'final_vintage_year')::integer <
           (p_proposal ->> 'first_vintage_year')::integer
        then
            raise exception using errcode = '22023', message = 'Research producer era is reversed';
        end if;
    elsif v_profile_type = 'vintage' then
        if jsonb_typeof(p_proposal -> 'condition_tags') <> 'array'
           or jsonb_array_length(p_proposal -> 'condition_tags') > 16
           or exists (
               select 1
               from jsonb_array_elements(p_proposal -> 'condition_tags') tag(value)
               where jsonb_typeof(tag.value) <> 'string'
                  or length(trim(tag.value #>> '{}')) not between 1 and 80
           )
        then
            raise exception using errcode = '22023', message = 'Research vintage condition tags are invalid';
        end if;
    end if;
end;
$$;

revoke execute
on function private.validate_enrichment_research_proposal(uuid, jsonb)
from public, anon, authenticated;


create or replace function public.review_enrichment_research_draft(
    p_household_id uuid,
    p_draft_id uuid,
    p_verdict text,
    p_proposal jsonb default null,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_case_id uuid;
    v_draft_proposal jsonb;
    v_reviewed_proposal jsonb;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if p_verdict not in ('accepted', 'edited', 'rejected') then
        raise exception using errcode = '22023', message = 'Research verdict is invalid';
    end if;

    if not exists (
        select 1 from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
          and member.role = 'owner'
    ) then
        raise exception using errcode = '42501', message = 'Only household owners can review research drafts';
    end if;

    select draft.case_id, draft.proposal
    into v_case_id, v_draft_proposal
    from public.enrichment_research_drafts draft
    join public.enrichment_research_subscriptions subscription
      on subscription.case_id = draft.case_id
     and subscription.household_id = p_household_id
    where draft.id = p_draft_id
      and draft.draft_status = 'ready';

    if not found then
        raise exception using errcode = '22023', message = 'Research draft is not available to this household';
    end if;

    if p_verdict = 'accepted' then
        v_reviewed_proposal := v_draft_proposal;
    elsif p_verdict = 'edited' then
        if p_proposal is null or jsonb_typeof(p_proposal) <> 'object' then
            raise exception using errcode = '22023', message = 'Edited research requires a structured proposal';
        end if;
        v_reviewed_proposal := p_proposal;
    else
        v_reviewed_proposal := null;
    end if;

    if v_reviewed_proposal is not null then
        perform private.validate_enrichment_research_proposal(
            v_case_id,
            v_reviewed_proposal
        );
    end if;

    insert into public.enrichment_research_reviews (
        draft_id,
        household_id,
        reviewed_by,
        verdict,
        reviewed_proposal,
        note
    ) values (
        p_draft_id,
        p_household_id,
        v_user_id,
        p_verdict,
        v_reviewed_proposal,
        nullif(trim(p_note), '')
    );

    update public.enrichment_research_subscriptions subscription
    set
        subscription_status = case when p_verdict = 'rejected' then 'rejected' else 'reviewed' end,
        seen_at = coalesce(subscription.seen_at, now())
    where subscription.case_id = v_case_id
      and subscription.household_id = p_household_id;

    if p_verdict <> 'rejected' then
        update public.enrichment_research_cases research_case
        set case_status = 'owner-reviewed', updated_at = now()
        where research_case.id = v_case_id
          and research_case.case_status in ('draft-ready', 'owner-reviewed');
    end if;

    return public.get_household_enrichment_research_inbox(p_household_id);
end;
$$;

revoke all
on function public.review_enrichment_research_draft(uuid, uuid, text, jsonb, text)
from public, anon;

grant execute
on function public.review_enrichment_research_draft(uuid, uuid, text, jsonb, text)
to authenticated;


-- Trusted worker boundary. It receives no household identifiers and returns
-- only the shared subject plus the exact allowlist rules it may use.
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


create or replace function public.complete_enrichment_research_case(
    p_case_id uuid,
    p_lease_token uuid,
    p_outcome text,
    p_result jsonb default null,
    p_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_case public.enrichment_research_cases%rowtype;
    v_revision integer;
    v_draft_id uuid;
    v_source jsonb;
    v_rule public.enrichment_research_source_rules%rowtype;
begin
    if p_outcome not in ('draft', 'needs-source-review', 'not-found', 'retrying', 'failed') then
        raise exception using errcode = '22023', message = 'Research outcome is invalid';
    end if;

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

    if p_outcome = 'draft' then
        if jsonb_typeof(p_result) <> 'object'
           or jsonb_typeof(p_result -> 'proposal') <> 'object'
           or jsonb_typeof(p_result -> 'sources') <> 'array'
           or jsonb_array_length(p_result -> 'sources') = 0
           or length(trim(p_result ->> 'rationale')) < 10
           or (p_result ->> 'confidence')::numeric not between 0 and 1
           or length(trim(p_result ->> 'synthesis_model')) < 3
        then
            raise exception using errcode = '22023', message = 'Research draft result is incomplete';
        end if;

        perform private.validate_enrichment_research_proposal(
            p_case_id,
            p_result -> 'proposal'
        );

        update public.enrichment_research_drafts draft
        set draft_status = 'superseded'
        where draft.case_id = p_case_id
          and draft.draft_status = 'ready';

        select coalesce(max(draft.revision), 0) + 1
        into v_revision
        from public.enrichment_research_drafts draft
        where draft.case_id = p_case_id;

        insert into public.enrichment_research_drafts (
            case_id,
            revision,
            proposal_kind,
            proposal,
            rationale,
            confidence,
            synthesis_model
        ) values (
            p_case_id,
            v_revision,
            case when v_case.subject_type = 'fact' then 'fact' else 'profile' end,
            p_result -> 'proposal',
            trim(p_result ->> 'rationale'),
            (p_result ->> 'confidence')::numeric,
            trim(p_result ->> 'synthesis_model')
        ) returning id into v_draft_id;

        for v_source in select value from jsonb_array_elements(p_result -> 'sources')
        loop
            select rule.* into v_rule
            from public.enrichment_research_source_rules rule
            where rule.id = (v_source ->> 'rule_id')::uuid
              and rule.status = 'active'
              and v_case.subject_type = any(rule.subject_types)
              and v_case.claim_type = any(rule.claim_types)
              and (
                  cardinality(rule.subject_aliases) = 0
                  or private.normalize_wine_reference_text(
                      v_case.subject_snapshot ->> 'producer'
                  ) = any(rule.subject_aliases)
              );

            if not found then
                raise exception using errcode = '23514', message = 'Research result cites a source outside the case allowlist';
            end if;

            insert into public.enrichment_research_draft_sources (
                draft_id,
                source_rule_id,
                source_id,
                source_policy_id,
                source_record_url,
                retrieved_at
            ) values (
                v_draft_id,
                v_rule.id,
                v_rule.source_id,
                v_rule.source_policy_id,
                v_source ->> 'url',
                coalesce((v_source ->> 'retrieved_at')::timestamptz, now())
            );
        end loop;

        update public.enrichment_research_cases research_case
        set
            case_status = 'draft-ready',
            lease_token = null,
            leased_by = null,
            lease_expires_at = null,
            next_attempt_at = null,
            last_error_code = null,
            updated_at = now()
        where research_case.id = p_case_id;

        update public.enrichment_research_subscriptions subscription
        set notified_at = now(), seen_at = null, subscription_status = 'open'
        where subscription.case_id = p_case_id;
    else
        if p_outcome = 'retrying' and (p_retry_at is null or p_retry_at <= now()) then
            raise exception using errcode = '22023', message = 'Research retry time must be in the future';
        end if;

        update public.enrichment_research_cases research_case
        set
            case_status = p_outcome,
            lease_token = null,
            leased_by = null,
            lease_expires_at = null,
            next_attempt_at = case when p_outcome = 'retrying' then p_retry_at else null end,
            last_error_code = nullif(trim(coalesce(p_result ->> 'error_code', p_outcome)), ''),
            updated_at = now()
        where research_case.id = p_case_id;
    end if;

    return jsonb_build_object(
        'case_id', p_case_id,
        'status', case when p_outcome = 'draft' then 'draft-ready' else p_outcome end,
        'draft_id', v_draft_id
    );
end;
$$;

revoke execute
on function public.complete_enrichment_research_case(uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated;

grant execute
on function public.complete_enrichment_research_case(uuid, uuid, text, jsonb, timestamptz)
to service_role;


-- The initial real-world rule is intentionally narrow: the official
-- Jean-Marc Burgaud site, producer-profile subjects only, and pointer-only
-- provenance. Page bodies and search-provider payloads are never retained.
insert into public.enrichment_sources (
    id,
    source_key,
    source_name,
    source_kind,
    homepage_url
) values (
    private.enrichment_seed_uuid('source:jean-marc-burgaud-official'),
    'jean-marc-burgaud-official',
    'Domaine Jean-Marc Burgaud official site',
    'producer',
    'https://jean-marc-burgaud.com/'
)
on conflict (id) do nothing;

insert into public.enrichment_source_policies (
    id,
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
    private.enrichment_seed_uuid('policy:jean-marc-burgaud-official:v1'),
    private.enrichment_seed_uuid('source:jean-marc-burgaud-official'),
    1,
    'reviewed',
    '2026-08-27',
    '2026-08-27',
    'https://jean-marc-burgaud.com/',
    'allowed',
    'prohibited',
    'prohibited',
    'prohibited',
    'allowed',
    'allowed',
    'Domaine Jean-Marc Burgaud',
    'Pointer-only citations and short-lived in-memory analysis are allowed. Source HTML, search results, and copied claims are not retained or synchronized.'
)
on conflict (id) do nothing;

insert into public.enrichment_research_source_rules (
    id,
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
    private.enrichment_seed_uuid('research-rule:jean-marc-burgaud-official:v1'),
    private.enrichment_seed_uuid('source:jean-marc-burgaud-official'),
    private.enrichment_seed_uuid('policy:jean-marc-burgaud-official:v1'),
    'jean-marc-burgaud.com',
    '/',
    array['producer-profile'],
    array['burgaud', 'jean marc burgaud', 'domaine jean marc burgaud'],
    array['producer-style'],
    'site:jean-marc-burgaud.com {subject} domaine vins style garde',
    2
)
on conflict (id) do nothing;


-- Clone the complete active snapshot before adding one reviewed profile. A
-- partial version would silently remove unrelated place, vintage, producer,
-- cuvee, release, and dish knowledge when activated.
create or replace function private.clone_active_enrichment_knowledge_version(
    p_label text,
    p_model_version text,
    p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_active_id uuid;
    v_new_id uuid := gen_random_uuid();
    v_version_number integer;
begin
    if length(trim(p_label)) < 3 or length(trim(p_model_version)) < 3 then
        raise exception using errcode = '22023', message = 'Knowledge version label is incomplete';
    end if;

    lock table public.enrichment_knowledge_versions in share row exclusive mode;

    select version.id into v_active_id
    from public.enrichment_knowledge_versions version
    where version.status = 'active';

    if not found then
        raise exception using errcode = '55000', message = 'No active enrichment knowledge version exists';
    end if;

    select coalesce(max(version.version_number), 0) + 1
    into v_version_number
    from public.enrichment_knowledge_versions version;

    insert into public.enrichment_knowledge_versions (
        id,
        version_number,
        label,
        model_key,
        model_version,
        created_by
    ) values (
        v_new_id,
        v_version_number,
        trim(p_label),
        'cellarmanager-curated-inference',
        trim(p_model_version),
        p_created_by
    );

    create temporary table if not exists enrichment_profile_clone_map (
        old_id uuid primary key,
        new_id uuid not null unique
    ) on commit drop;
    truncate table pg_temp.enrichment_profile_clone_map;

    insert into pg_temp.enrichment_profile_clone_map (old_id, new_id)
    select profile.id, gen_random_uuid()
    from public.enrichment_profiles profile
    where profile.knowledge_version_id = v_active_id;

    insert into public.enrichment_profiles (
        id,
        knowledge_version_id,
        profile_type,
        review_status,
        confidence,
        rationale,
        reviewed_by,
        reviewed_at,
        created_at
    )
    select
        map.new_id,
        v_new_id,
        profile.profile_type,
        profile.review_status,
        profile.confidence,
        profile.rationale,
        profile.reviewed_by,
        profile.reviewed_at,
        profile.created_at
    from public.enrichment_profiles profile
    join pg_temp.enrichment_profile_clone_map map on map.old_id = profile.id
    where profile.knowledge_version_id = v_active_id;

    insert into public.enrichment_place_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.place_id,
        typed.wine_color, typed.first_trial_age, typed.best_start_age,
        typed.best_end_age, typed.outer_horizon_age, typed.body,
        typed.acidity, typed.tannin, typed.sweetness, typed.alcohol,
        typed.freshness, typed.savory, typed.concentration
    from public.enrichment_place_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_place_adjustment_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.place_id,
        typed.wine_color, typed.first_trial_age_adjustment,
        typed.best_start_age_adjustment, typed.best_end_age_adjustment,
        typed.outer_horizon_age_adjustment, typed.body_adjustment,
        typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_place_adjustment_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_vintage_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.place_id,
        typed.vintage_year, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment,
        typed.tannin_adjustment, typed.sweetness_adjustment,
        typed.alcohol_adjustment, typed.freshness_adjustment,
        typed.savory_adjustment, typed.condition_tags,
        typed.concentration_adjustment
    from public.enrichment_vintage_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_producer_era_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.producer_id,
        typed.first_vintage_year, typed.final_vintage_year, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment,
        typed.tannin_adjustment, typed.sweetness_adjustment,
        typed.alcohol_adjustment, typed.freshness_adjustment,
        typed.savory_adjustment, typed.concentration_adjustment
    from public.enrichment_producer_era_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_producer_vintage_interaction_profiles
    select
        map.new_id, v_new_id, typed.profile_type, producer_map.new_id,
        typed.required_condition_tags, typed.first_trial_age_adjustment,
        typed.best_start_age_adjustment, typed.best_end_age_adjustment,
        typed.outer_horizon_age_adjustment, typed.body_adjustment,
        typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_producer_vintage_interaction_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    join pg_temp.enrichment_profile_clone_map producer_map
      on producer_map.old_id = typed.producer_era_profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_cuvee_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.product_id,
        typed.place_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment,
        typed.tannin_adjustment, typed.sweetness_adjustment,
        typed.alcohol_adjustment, typed.freshness_adjustment,
        typed.savory_adjustment, typed.concentration_adjustment
    from public.enrichment_cuvee_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_release_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.release_id,
        typed.wine_color, typed.first_trial_age_adjustment,
        typed.best_start_age_adjustment, typed.best_end_age_adjustment,
        typed.outer_horizon_age_adjustment, typed.body_adjustment,
        typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_release_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_dish_profiles
    select
        map.new_id, v_new_id, typed.profile_type, typed.dish_key,
        typed.dish_name, typed.description, typed.intensity, typed.fat,
        typed.acidity, typed.sweetness, typed.salt, typed.umami,
        typed.spice, typed.protein, typed.fish
    from public.enrichment_dish_profiles typed
    join pg_temp.enrichment_profile_clone_map map on map.old_id = typed.profile_id
    where typed.knowledge_version_id = v_active_id;

    insert into public.enrichment_profile_evidence (
        profile_id,
        evidence_id,
        evidence_role,
        created_at
    )
    select
        map.new_id,
        link.evidence_id,
        link.evidence_role,
        link.created_at
    from public.enrichment_profile_evidence link
    join pg_temp.enrichment_profile_clone_map map on map.old_id = link.profile_id;

    return v_new_id;
end;
$$;

revoke execute
on function private.clone_active_enrichment_knowledge_version(text, text, uuid)
from public, anon, authenticated;

grant execute
on function private.clone_active_enrichment_knowledge_version(text, text, uuid)
to service_role;


create or replace function public.publish_enrichment_research_draft(
    p_draft_id uuid,
    p_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_draft public.enrichment_research_drafts%rowtype;
    v_case public.enrichment_research_cases%rowtype;
    v_review public.enrichment_research_reviews%rowtype;
    v_payload jsonb;
    v_source record;
    v_evidence_ids uuid[] := '{}'::uuid[];
    v_evidence_id uuid;
    v_fact_claim_id uuid;
    v_version_id uuid;
    v_profile_id uuid;
    v_profile_type text;
    v_result jsonb;
begin
    select draft.* into v_draft
    from public.enrichment_research_drafts draft
    where draft.id = p_draft_id
    for update;

    if not found or v_draft.draft_status <> 'ready' then
        raise exception using errcode = '22023', message = 'Research draft is not ready for publication';
    end if;

    select research_case.* into v_case
    from public.enrichment_research_cases research_case
    where research_case.id = v_draft.case_id
    for update;

    select review.* into v_review
    from public.enrichment_research_reviews review
    where review.id = p_review_id
      and review.draft_id = p_draft_id
      and review.verdict in ('accepted', 'edited');

    if not found then
        raise exception using errcode = '23514', message = 'Trusted publication requires an accepted household review';
    end if;

    if not exists (
        select 1 from public.enrichment_research_subscriptions subscription
        where subscription.case_id = v_case.id
          and subscription.household_id = v_review.household_id
          and subscription.subscription_status = 'reviewed'
    ) then
        raise exception using errcode = '23514', message = 'Research review is no longer active for its household';
    end if;

    v_payload := v_review.reviewed_proposal;

    perform private.validate_enrichment_research_proposal(
        v_case.id,
        v_payload
    );

    if jsonb_typeof(v_payload) <> 'object'
       or length(trim(coalesce(v_payload ->> 'rationale', v_draft.rationale))) < 10
       or coalesce((v_payload ->> 'confidence')::numeric, v_draft.confidence) not between 0 and 1
    then
        raise exception using errcode = '22023', message = 'Reviewed research proposal is incomplete';
    end if;

    for v_source in
        select draft_source.*, rule.status as rule_status
        from public.enrichment_research_draft_sources draft_source
        join public.enrichment_research_source_rules rule
          on rule.id = draft_source.source_rule_id
        where draft_source.draft_id = p_draft_id
        order by draft_source.source_record_url
    loop
        if v_source.rule_status <> 'active' then
            raise exception using errcode = '23514', message = 'A research source rule was retired before publication';
        end if;

        insert into public.enrichment_evidence (
            source_id,
            source_policy_id,
            source_record_url,
            content_mode,
            claim_type,
            scope_level,
            place_id,
            producer_id,
            product_id,
            release_id,
            vintage_year,
            wine_color,
            claim_value,
            review_status,
            reviewed_by,
            reviewed_at,
            retrieved_at
        ) values (
            v_source.source_id,
            v_source.source_policy_id,
            v_source.source_record_url,
            'pointer-only',
            v_case.claim_type,
            case
                when v_case.subject_type = 'place-profile' then 'place'
                when v_case.subject_type = 'vintage-profile' then 'vintage'
                when v_case.subject_type = 'producer-profile' then 'producer'
                when v_case.subject_type = 'cuvee-profile' then 'product'
                when v_case.release_id is not null then 'release'
                else 'product'
            end,
            case when v_case.subject_type in ('place-profile', 'vintage-profile') then v_case.place_id else null end,
            case when v_case.subject_type = 'producer-profile' then v_case.producer_id else null end,
            case when v_case.subject_type = 'cuvee-profile' or (v_case.subject_type = 'fact' and v_case.release_id is null) then v_case.product_id else null end,
            case when v_case.subject_type = 'fact' then v_case.release_id else null end,
            case when v_case.subject_type = 'vintage-profile' then v_case.vintage_year else null end,
            v_case.wine_color,
            null,
            'reviewed',
            v_review.reviewed_by,
            now(),
            v_source.retrieved_at
        ) returning id into v_evidence_id;

        v_evidence_ids := array_append(v_evidence_ids, v_evidence_id);
    end loop;

    if cardinality(v_evidence_ids) = 0 then
        raise exception using errcode = '23514', message = 'Research publication requires at least one reviewed source pointer';
    end if;

    if v_draft.proposal_kind = 'fact' then
        if v_case.field_name is null
           or v_payload ->> 'field_name' <> v_case.field_name
           or v_payload -> 'value' is null
           or jsonb_typeof(v_payload -> 'value') not in ('string', 'number', 'array')
        then
            raise exception using errcode = '22023', message = 'Reviewed fact proposal does not match its research subject';
        end if;

        insert into public.enrichment_researched_fact_claims (
            draft_id,
            product_id,
            release_id,
            field_name,
            claim_value,
            rationale,
            confidence,
            reviewed_by,
            reviewed_at
        ) values (
            p_draft_id,
            case when v_case.release_id is null then v_case.product_id else null end,
            v_case.release_id,
            v_case.field_name,
            v_payload -> 'value',
            trim(coalesce(v_payload ->> 'rationale', v_draft.rationale)),
            coalesce((v_payload ->> 'confidence')::numeric, v_draft.confidence),
            v_review.reviewed_by,
            now()
        ) returning id into v_fact_claim_id;

        insert into public.enrichment_researched_fact_claim_evidence (claim_id, evidence_id)
        select v_fact_claim_id, unnest(v_evidence_ids);

        v_result := jsonb_build_object(
            'publication_type', 'fact',
            'fact_claim_id', v_fact_claim_id
        );
    else
        v_profile_type := v_payload ->> 'profile_type';

        if v_profile_type not in ('place', 'place-adjustment', 'vintage', 'producer-era', 'cuvee') then
            raise exception using errcode = '22023', message = 'Reviewed profile type is not publishable by this workflow';
        end if;

        if (v_case.subject_type = 'place-profile' and v_profile_type not in ('place', 'place-adjustment'))
           or (v_case.subject_type = 'vintage-profile' and v_profile_type <> 'vintage')
           or (v_case.subject_type = 'producer-profile' and v_profile_type <> 'producer-era')
           or (v_case.subject_type = 'cuvee-profile' and v_profile_type <> 'cuvee')
        then
            raise exception using errcode = '22023', message = 'Reviewed profile type does not match its research subject';
        end if;

        v_version_id := private.clone_active_enrichment_knowledge_version(
            'Reviewed research: ' || coalesce(v_case.subject_snapshot ->> 'title', v_case.subject_key),
            'reviewed-research-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
            v_review.reviewed_by
        );
        v_profile_id := gen_random_uuid();

        insert into public.enrichment_profiles (
            id,
            knowledge_version_id,
            profile_type,
            review_status,
            confidence,
            rationale,
            reviewed_by,
            reviewed_at
        ) values (
            v_profile_id,
            v_version_id,
            v_profile_type,
            'reviewed',
            coalesce((v_payload ->> 'confidence')::numeric, v_draft.confidence),
            trim(coalesce(v_payload ->> 'rationale', v_draft.rationale)),
            v_review.reviewed_by,
            now()
        );

        if v_profile_type = 'place' then
            insert into public.enrichment_place_profiles values (
                v_profile_id, v_version_id, 'place', v_case.place_id, v_case.wine_color,
                (v_payload #>> '{ages,first_trial}')::integer,
                (v_payload #>> '{ages,best_start}')::integer,
                (v_payload #>> '{ages,best_end}')::integer,
                (v_payload #>> '{ages,outer_horizon}')::integer,
                (v_payload #>> '{traits,body}')::numeric,
                (v_payload #>> '{traits,acidity}')::numeric,
                (v_payload #>> '{traits,tannin}')::numeric,
                (v_payload #>> '{traits,sweetness}')::numeric,
                (v_payload #>> '{traits,alcohol}')::numeric,
                (v_payload #>> '{traits,freshness}')::numeric,
                (v_payload #>> '{traits,savory}')::numeric,
                (v_payload #>> '{traits,concentration}')::numeric
            );
        elsif v_profile_type = 'place-adjustment' then
            insert into public.enrichment_place_adjustment_profiles values (
                v_profile_id, v_version_id, 'place-adjustment', v_case.place_id, v_case.wine_color,
                (v_payload #>> '{age_adjustments,first_trial}')::integer,
                (v_payload #>> '{age_adjustments,best_start}')::integer,
                (v_payload #>> '{age_adjustments,best_end}')::integer,
                (v_payload #>> '{age_adjustments,outer_horizon}')::integer,
                (v_payload #>> '{trait_adjustments,body}')::numeric,
                (v_payload #>> '{trait_adjustments,acidity}')::numeric,
                (v_payload #>> '{trait_adjustments,tannin}')::numeric,
                (v_payload #>> '{trait_adjustments,sweetness}')::numeric,
                (v_payload #>> '{trait_adjustments,alcohol}')::numeric,
                (v_payload #>> '{trait_adjustments,freshness}')::numeric,
                (v_payload #>> '{trait_adjustments,savory}')::numeric,
                (v_payload #>> '{trait_adjustments,concentration}')::numeric
            );
        elsif v_profile_type = 'vintage' then
            insert into public.enrichment_vintage_profiles values (
                v_profile_id, v_version_id, 'vintage', v_case.place_id,
                v_case.vintage_year, v_case.wine_color,
                (v_payload #>> '{age_adjustments,first_trial}')::integer,
                (v_payload #>> '{age_adjustments,best_start}')::integer,
                (v_payload #>> '{age_adjustments,best_end}')::integer,
                (v_payload #>> '{age_adjustments,outer_horizon}')::integer,
                (v_payload #>> '{trait_adjustments,body}')::numeric,
                (v_payload #>> '{trait_adjustments,acidity}')::numeric,
                (v_payload #>> '{trait_adjustments,tannin}')::numeric,
                (v_payload #>> '{trait_adjustments,sweetness}')::numeric,
                (v_payload #>> '{trait_adjustments,alcohol}')::numeric,
                (v_payload #>> '{trait_adjustments,freshness}')::numeric,
                (v_payload #>> '{trait_adjustments,savory}')::numeric,
                coalesce(array(select jsonb_array_elements_text(v_payload -> 'condition_tags')), '{}'::text[]),
                (v_payload #>> '{trait_adjustments,concentration}')::numeric
            );
        elsif v_profile_type = 'producer-era' then
            insert into public.enrichment_producer_era_profiles values (
                v_profile_id, v_version_id, 'producer-era', v_case.producer_id,
                (v_payload ->> 'first_vintage_year')::integer,
                (v_payload ->> 'final_vintage_year')::integer,
                v_case.wine_color,
                (v_payload #>> '{age_adjustments,first_trial}')::integer,
                (v_payload #>> '{age_adjustments,best_start}')::integer,
                (v_payload #>> '{age_adjustments,best_end}')::integer,
                (v_payload #>> '{age_adjustments,outer_horizon}')::integer,
                (v_payload #>> '{trait_adjustments,body}')::numeric,
                (v_payload #>> '{trait_adjustments,acidity}')::numeric,
                (v_payload #>> '{trait_adjustments,tannin}')::numeric,
                (v_payload #>> '{trait_adjustments,sweetness}')::numeric,
                (v_payload #>> '{trait_adjustments,alcohol}')::numeric,
                (v_payload #>> '{trait_adjustments,freshness}')::numeric,
                (v_payload #>> '{trait_adjustments,savory}')::numeric,
                (v_payload #>> '{trait_adjustments,concentration}')::numeric
            );
        else
            insert into public.enrichment_cuvee_profiles values (
                v_profile_id, v_version_id, 'cuvee', v_case.product_id,
                v_case.place_id, v_case.wine_color,
                (v_payload #>> '{age_adjustments,first_trial}')::integer,
                (v_payload #>> '{age_adjustments,best_start}')::integer,
                (v_payload #>> '{age_adjustments,best_end}')::integer,
                (v_payload #>> '{age_adjustments,outer_horizon}')::integer,
                (v_payload #>> '{trait_adjustments,body}')::numeric,
                (v_payload #>> '{trait_adjustments,acidity}')::numeric,
                (v_payload #>> '{trait_adjustments,tannin}')::numeric,
                (v_payload #>> '{trait_adjustments,sweetness}')::numeric,
                (v_payload #>> '{trait_adjustments,alcohol}')::numeric,
                (v_payload #>> '{trait_adjustments,freshness}')::numeric,
                (v_payload #>> '{trait_adjustments,savory}')::numeric,
                (v_payload #>> '{trait_adjustments,concentration}')::numeric
            );
        end if;

        insert into public.enrichment_profile_evidence (profile_id, evidence_id, evidence_role)
        select v_profile_id, unnest(v_evidence_ids), 'supports';

        v_result := public.publish_enrichment_knowledge_version(v_version_id)
            || jsonb_build_object('publication_type', 'profile', 'profile_id', v_profile_id);
    end if;

    update public.enrichment_research_drafts draft
    set draft_status = 'published', published_at = now()
    where draft.id = p_draft_id;

    update public.enrichment_research_cases research_case
    set case_status = 'published', published_at = now(), updated_at = now()
    where research_case.id = v_case.id;

    update public.enrichment_research_subscriptions subscription
    set subscription_status = 'published', notified_at = now(), seen_at = null
    where subscription.case_id = v_case.id;

    return v_result || jsonb_build_object('draft_id', p_draft_id, 'case_id', v_case.id);
end;
$$;

revoke execute
on function public.publish_enrichment_research_draft(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.publish_enrichment_research_draft(uuid, uuid)
to service_role;


create or replace function public.publish_reviewed_enrichment_research_drafts(
    p_limit integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_candidate record;
    v_results jsonb := '[]'::jsonb;
begin
    if p_limit not between 1 and 5 then
        raise exception using errcode = '22023', message = 'Research publication limit is invalid';
    end if;

    for v_candidate in
        select
            draft.id as draft_id,
            review.id as review_id
        from public.enrichment_research_cases research_case
        join public.enrichment_research_drafts draft
          on draft.case_id = research_case.id
         and draft.draft_status = 'ready'
        join lateral (
            select candidate.id
            from public.enrichment_research_reviews candidate
            join public.enrichment_research_subscriptions subscription
              on subscription.case_id = research_case.id
             and subscription.household_id = candidate.household_id
             and subscription.subscription_status = 'reviewed'
            where candidate.draft_id = draft.id
              and candidate.verdict in ('accepted', 'edited')
            order by candidate.created_at, candidate.id
            limit 1
        ) review on true
        where research_case.case_status = 'owner-reviewed'
        order by research_case.priority desc, research_case.updated_at, research_case.id
        limit p_limit
    loop
        begin
            v_results := v_results || jsonb_build_array(
                public.publish_enrichment_research_draft(
                    v_candidate.draft_id,
                    v_candidate.review_id
                )
            );
        exception
            when others then
                -- One malformed or concurrently published item must not block
                -- unrelated reviewed drafts. Its existing status remains
                -- visible for operator diagnosis and a later retry.
                v_results := v_results || jsonb_build_array(jsonb_build_object(
                    'draft_id', v_candidate.draft_id,
                    'status', 'publication-failed',
                    'sqlstate', sqlstate
                ));
        end;
    end loop;

    return v_results;
end;
$$;

revoke execute
on function public.publish_reviewed_enrichment_research_drafts(integer)
from public, anon, authenticated;

grant execute
on function public.publish_reviewed_enrichment_research_drafts(integer)
to service_role;


create or replace function public.get_researched_wine_fact_suggestions(
    p_wine_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_product_id uuid;
    v_release_id uuid;
    v_values jsonb := '{}'::jsonb;
    v_sources jsonb := '[]'::jsonb;
    v_claim record;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    select wine.* into v_wine
    from public.wines wine
    where wine.id = p_wine_id;

    if not found then
        raise exception using errcode = '22023', message = 'Wine was not found';
    end if;

    if not exists (
        select 1 from public.household_members member
        where member.household_id = v_wine.household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Wine does not belong to this household';
    end if;

    if v_wine.wine_reference_type = 'product' then
        v_product_id := v_wine.wine_reference_id;
    elsif v_wine.wine_reference_type = 'release' then
        v_release_id := v_wine.wine_reference_id;
        select release.product_id into v_product_id
        from public.wine_reference_releases release where release.id = v_release_id;
    elsif v_wine.wine_reference_type = 'package' then
        select package.release_id, release.product_id
        into v_release_id, v_product_id
        from public.wine_reference_packages package
        join public.wine_reference_releases release on release.id = package.release_id
        where package.id = v_wine.wine_reference_id;
    end if;

    for v_claim in
        select distinct on (claim.field_name)
            claim.*
        from public.enrichment_researched_fact_claims claim
        where (v_release_id is not null and claim.release_id = v_release_id)
           or (claim.product_id = v_product_id)
        order by
            claim.field_name,
            case when claim.release_id = v_release_id then 0 else 1 end,
            claim.reviewed_at desc,
            claim.id
    loop
        v_values := v_values || jsonb_build_object(
            case v_claim.field_name
                when 'grapes' then 'grape_composition'
                when 'sweetness' then 'sweetness_category'
                when 'alcohol' then 'alcohol_percent'
                else v_claim.field_name
            end,
            v_claim.claim_value
        );

        v_sources := v_sources || coalesce((
            select jsonb_agg(jsonb_build_object(
                'kind', 'reviewed-web',
                'name', source.source_name,
                'url', evidence.source_record_url,
                'reviewed_at', v_claim.reviewed_at,
                'field', v_claim.field_name,
                'rationale', v_claim.rationale,
                'confidence', v_claim.confidence
            ) order by source.source_name, evidence.source_record_url)
            from public.enrichment_researched_fact_claim_evidence link
            join public.enrichment_evidence evidence on evidence.id = link.evidence_id
            join public.enrichment_sources source on source.id = evidence.source_id
            where link.claim_id = v_claim.id
        ), '[]'::jsonb);
    end loop;

    if v_values = '{}'::jsonb then
        return jsonb_build_object(
            'status', 'unavailable',
            'reason', 'No published reviewed web facts are available',
            'values', null,
            'sources', '[]'::jsonb
        );
    end if;

    return jsonb_build_object(
        'status', 'available',
        'reason', null,
        'values', v_values,
        'sources', v_sources
    );
end;
$$;

revoke all
on function public.get_researched_wine_fact_suggestions(uuid)
from public, anon;

grant execute
on function public.get_researched_wine_fact_suggestions(uuid)
to authenticated;

commit;
