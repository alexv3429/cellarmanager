begin;

-- A review case is shared and deduplicated by the stable canonical subject,
-- while every reporter keeps a private subscription and private messages.
-- Opening a case never edits, withdraws, or lowers the published profile.
create table public.enrichment_profile_review_cases (
    id uuid primary key default gen_random_uuid(),
    subject_key text not null,
    profile_type text not null,
    subject_title text not null,
    subject_snapshot jsonb not null,
    reported_profile_id uuid not null
        references public.enrichment_profiles(id),
    case_status text not null default 'open',
    opened_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolution_summary text,
    resolution_profile_id uuid
        references public.enrichment_profiles(id),

    constraint enrichment_profile_review_cases_subject_key_check
        check (length(subject_key) between 3 and 500),
    constraint enrichment_profile_review_cases_title_check
        check (length(trim(subject_title)) between 1 and 500),
    constraint enrichment_profile_review_cases_snapshot_check
        check (jsonb_typeof(subject_snapshot) = 'object'),
    constraint enrichment_profile_review_cases_status_check
        check (case_status in ('open', 'reviewing', 'resolved', 'dismissed')),
    constraint enrichment_profile_review_cases_resolution_check
        check (
            (
                case_status in ('open', 'reviewing')
                and resolved_at is null
                and resolution_summary is null
                and resolution_profile_id is null
            )
            or (
                case_status in ('resolved', 'dismissed')
                and resolved_at is not null
                and length(trim(resolution_summary)) between 10 and 4000
                and (case_status = 'resolved' or resolution_profile_id is null)
            )
        )
);

create unique index enrichment_profile_review_cases_one_open_subject_idx
    on public.enrichment_profile_review_cases(subject_key)
    where case_status in ('open', 'reviewing');

create index enrichment_profile_review_cases_status_idx
    on public.enrichment_profile_review_cases(case_status, updated_at desc);


create table public.enrichment_profile_review_subscriptions (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null
        references public.enrichment_profile_review_cases(id)
        on delete cascade,
    household_id uuid not null
        references public.households(id)
        on delete cascade,
    wine_id uuid not null,
    requested_by uuid not null
        references auth.users(id)
        on delete cascade,
    joined_existing boolean not null default false,
    requested_at timestamptz not null default now(),
    notified_at timestamptz,
    seen_at timestamptz,

    constraint enrichment_profile_review_subscriptions_unique
        unique (case_id, household_id, requested_by),
    constraint enrichment_profile_review_subscriptions_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint enrichment_profile_review_subscriptions_seen_check
        check (seen_at is null or notified_at is not null)
);

create index enrichment_profile_review_subscriptions_reporter_idx
    on public.enrichment_profile_review_subscriptions(
        requested_by,
        household_id,
        requested_at desc
    );


create table public.enrichment_profile_review_messages (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null
        references public.enrichment_profile_review_subscriptions(id)
        on delete cascade,
    message_kind text not null,
    comment text not null,
    evidence_url text,
    created_at timestamptz not null default now(),

    constraint enrichment_profile_review_messages_kind_check
        check (message_kind in (
            'drinking-window',
            'wine-style',
            'wrong-identity',
            'evidence-problem',
            'other',
            'additional-information'
        )),
    constraint enrichment_profile_review_messages_comment_check
        check (length(trim(comment)) between 10 and 2000),
    constraint enrichment_profile_review_messages_evidence_check
        check (
            evidence_url is null
            or (
                length(evidence_url) between 9 and 2048
                and evidence_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$'
            )
        )
);

create index enrichment_profile_review_messages_subscription_idx
    on public.enrichment_profile_review_messages(subscription_id, created_at, id);


alter table public.enrichment_profile_review_cases enable row level security;
alter table public.enrichment_profile_review_subscriptions enable row level security;
alter table public.enrichment_profile_review_messages enable row level security;

revoke all privileges on table
    public.enrichment_profile_review_cases,
    public.enrichment_profile_review_subscriptions,
    public.enrichment_profile_review_messages
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.enrichment_profile_review_cases,
    public.enrichment_profile_review_subscriptions,
    public.enrichment_profile_review_messages
to service_role;


-- Resolve a version-specific profile to a stable subject key. New immutable
-- releases clone profile rows, so profile UUID alone is not a deduplication key.
create or replace function private.enrichment_profile_review_subject(
    p_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    with target as (
        select profile.id, profile.profile_type, profile.knowledge_version_id
        from public.enrichment_profiles profile
        join public.enrichment_knowledge_versions version
          on version.id = profile.knowledge_version_id
        where profile.id = p_profile_id
          and profile.review_status = 'reviewed'
          and version.status = 'active'
    ), subjects as (
        select
            target.profile_type,
            'place:' || typed.place_id::text || ':' || typed.wine_color as subject_key,
            place.canonical_name || ' · ' || typed.wine_color || ' place baseline' as subject_title,
            jsonb_build_object(
                'place_id', typed.place_id,
                'place', place.canonical_name,
                'color', typed.wine_color
            ) as subject_snapshot
        from target
        join public.enrichment_place_profiles typed on typed.profile_id = target.id
        join public.enrichment_places place on place.id = typed.place_id

        union all

        select
            target.profile_type,
            'place-adjustment:' || typed.place_id::text || ':' || typed.wine_color,
            place.canonical_name || ' · ' || typed.wine_color || ' place refinement',
            jsonb_build_object(
                'place_id', typed.place_id,
                'place', place.canonical_name,
                'color', typed.wine_color
            )
        from target
        join public.enrichment_place_adjustment_profiles typed on typed.profile_id = target.id
        join public.enrichment_places place on place.id = typed.place_id

        union all

        select
            target.profile_type,
            'vintage:' || typed.place_id::text || ':' || typed.vintage_year::text || ':' || typed.wine_color,
            place.canonical_name || ' ' || typed.vintage_year::text || ' · ' || typed.wine_color || ' vintage',
            jsonb_build_object(
                'place_id', typed.place_id,
                'place', place.canonical_name,
                'vintage', typed.vintage_year,
                'color', typed.wine_color
            )
        from target
        join public.enrichment_vintage_profiles typed on typed.profile_id = target.id
        join public.enrichment_places place on place.id = typed.place_id

        union all

        select
            target.profile_type,
            'producer-era:' || typed.producer_id::text || ':' || typed.first_vintage_year::text || ':' || typed.final_vintage_year::text || ':' || typed.wine_color,
            producer.canonical_name || ' · ' || typed.wine_color || ' · ' || typed.first_vintage_year::text || '–' || case when typed.final_vintage_year = 2200 then 'present' else typed.final_vintage_year::text end,
            jsonb_build_object(
                'producer_id', typed.producer_id,
                'producer', producer.canonical_name,
                'first_vintage', typed.first_vintage_year,
                'final_vintage', typed.final_vintage_year,
                'color', typed.wine_color
            )
        from target
        join public.enrichment_producer_era_profiles typed on typed.profile_id = target.id
        join public.wine_reference_producers producer on producer.id = typed.producer_id

        union all

        select
            target.profile_type,
            'producer-vintage-interaction:' || parent.producer_id::text || ':' || parent.first_vintage_year::text || ':' || parent.final_vintage_year::text || ':' || parent.wine_color || ':' || tags.value,
            producer.canonical_name || ' · ' || array_to_string(typed.required_condition_tags, ' + ') || ' interaction',
            jsonb_build_object(
                'producer_id', parent.producer_id,
                'producer', producer.canonical_name,
                'first_vintage', parent.first_vintage_year,
                'final_vintage', parent.final_vintage_year,
                'color', parent.wine_color,
                'condition_tags', typed.required_condition_tags
            )
        from target
        join public.enrichment_producer_vintage_interaction_profiles typed on typed.profile_id = target.id
        join public.enrichment_producer_era_profiles parent on parent.profile_id = typed.producer_era_profile_id
        join public.wine_reference_producers producer on producer.id = parent.producer_id
        cross join lateral (
            select array_to_string(array_agg(tag order by tag), ',') as value
            from unnest(typed.required_condition_tags) tag
        ) tags

        union all

        select
            target.profile_type,
            'cuvee:' || typed.product_id::text || ':' || coalesce(typed.place_id::text, '-') || ':' || typed.wine_color,
            producer.canonical_name || ' — ' || product.canonical_name || ' · ' || typed.wine_color,
            jsonb_build_object(
                'producer_id', producer.id,
                'producer', producer.canonical_name,
                'product_id', product.id,
                'cuvee', product.canonical_name,
                'place_id', typed.place_id,
                'color', typed.wine_color
            )
        from target
        join public.enrichment_cuvee_profiles typed on typed.profile_id = target.id
        join public.wine_reference_products product on product.id = typed.product_id
        join public.wine_reference_producers producer on producer.id = product.producer_id

        union all

        select
            target.profile_type,
            'release:' || typed.release_id::text || ':' || typed.wine_color,
            producer.canonical_name || ' — ' || product.canonical_name || ' ' || coalesce(release.vintage_year::text, release.release_designator, 'NV') || ' · ' || typed.wine_color,
            jsonb_build_object(
                'producer_id', producer.id,
                'producer', producer.canonical_name,
                'product_id', product.id,
                'cuvee', product.canonical_name,
                'release_id', release.id,
                'vintage', release.vintage_year,
                'release_designator', release.release_designator,
                'color', typed.wine_color
            )
        from target
        join public.enrichment_release_profiles typed on typed.profile_id = target.id
        join public.wine_reference_releases release on release.id = typed.release_id
        join public.wine_reference_products product on product.id = release.product_id
        join public.wine_reference_producers producer on producer.id = product.producer_id
    )
    select jsonb_build_object(
        'profile_id', p_profile_id,
        'profile_type', subject.profile_type,
        'subject_key', subject.subject_key,
        'subject_title', subject.subject_title,
        'subject_snapshot', subject.subject_snapshot
    )
    from subjects subject
    limit 1;
$$;

revoke execute
on function private.enrichment_profile_review_subject(uuid)
from public, anon, authenticated;


create or replace function public.get_enrichment_profile_review_inbox(
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
    v_items jsonb;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    select coalesce(
        jsonb_agg(item.payload order by item.updated_at desc, item.case_id),
        '[]'::jsonb
    )
    into v_items
    from (
        select
            review_case.id as case_id,
            review_case.updated_at,
            jsonb_build_object(
                'case_id', review_case.id,
                'subject_key', review_case.subject_key,
                'profile_id', review_case.reported_profile_id,
                'profile_type', review_case.profile_type,
                'subject_title', review_case.subject_title,
                'subject', review_case.subject_snapshot,
                'status', review_case.case_status,
                'opened_at', review_case.opened_at,
                'updated_at', review_case.updated_at,
                'resolved_at', review_case.resolved_at,
                'resolution_summary', review_case.resolution_summary,
                'resolution_profile_id', review_case.resolution_profile_id,
                'wine_id', subscription.wine_id,
                'joined_existing', subscription.joined_existing,
                'requested_at', subscription.requested_at,
                'notified_at', subscription.notified_at,
                'seen_at', subscription.seen_at,
                'messages', coalesce(messages.items, '[]'::jsonb)
            ) as payload
        from public.enrichment_profile_review_subscriptions subscription
        join public.enrichment_profile_review_cases review_case
          on review_case.id = subscription.case_id
        left join lateral (
            select jsonb_agg(jsonb_build_object(
                'id', message.id,
                'kind', message.message_kind,
                'comment', message.comment,
                'evidence_url', message.evidence_url,
                'created_at', message.created_at
            ) order by message.created_at, message.id) as items
            from public.enrichment_profile_review_messages message
            where message.subscription_id = subscription.id
        ) messages on true
        where subscription.household_id = p_household_id
          and subscription.requested_by = v_user_id
    ) item;

    return jsonb_build_object(
        'status', 'available',
        'items', v_items,
        'unread_count', (
            select count(*)::integer
            from public.enrichment_profile_review_subscriptions subscription
            where subscription.household_id = p_household_id
              and subscription.requested_by = v_user_id
              and subscription.notified_at is not null
              and subscription.seen_at is null
        )
    );
end;
$$;

revoke all
on function public.get_enrichment_profile_review_inbox(uuid)
from public, anon;

grant execute
on function public.get_enrichment_profile_review_inbox(uuid)
to authenticated;


create or replace function public.request_enrichment_profile_review(
    p_household_id uuid,
    p_wine_id uuid,
    p_profile_id uuid,
    p_category text,
    p_comment text,
    p_evidence_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_subject jsonb;
    v_case public.enrichment_profile_review_cases%rowtype;
    v_subscription public.enrichment_profile_review_subscriptions%rowtype;
    v_joined_existing boolean := false;
    v_comment text := nullif(trim(p_comment), '');
    v_evidence_url text := nullif(trim(p_evidence_url), '');
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    if p_category not in (
        'drinking-window',
        'wine-style',
        'wrong-identity',
        'evidence-problem',
        'other'
    ) then
        raise exception using errcode = '22023', message = 'Review category is invalid';
    end if;

    if v_comment is null or length(v_comment) not between 10 and 2000 then
        raise exception using errcode = '22023', message = 'Review comment must contain 10 to 2000 characters';
    end if;

    if v_evidence_url is not null and (
        length(v_evidence_url) > 2048
        or v_evidence_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$'
    ) then
        raise exception using errcode = '22023', message = 'Evidence must use a valid HTTPS URL';
    end if;

    if not exists (
        select 1
        from public.wines wine
        join public.wine_enrichment_projections projection
          on projection.household_id = wine.household_id
         and projection.wine_id = wine.id
         and projection.status = 'current'
        join public.wine_enrichment_projection_profiles link
          on link.projection_id = projection.id
         and link.profile_id = p_profile_id
        where wine.id = p_wine_id
          and wine.household_id = p_household_id
    ) then
        raise exception using
            errcode = '42501',
            message = 'This published profile is not part of the current guidance for that wine';
    end if;

    v_subject := private.enrichment_profile_review_subject(p_profile_id);
    if v_subject is null then
        raise exception using
            errcode = '22023',
            message = 'Only a reviewed profile from the active shared library can be reported';
    end if;

    select review_case.*
    into v_case
    from public.enrichment_profile_review_cases review_case
    where review_case.subject_key = v_subject ->> 'subject_key'
      and review_case.case_status in ('open', 'reviewing')
    for update;

    if found then
        v_joined_existing := true;
    else
        begin
            insert into public.enrichment_profile_review_cases (
                subject_key,
                profile_type,
                subject_title,
                subject_snapshot,
                reported_profile_id
            ) values (
                v_subject ->> 'subject_key',
                v_subject ->> 'profile_type',
                v_subject ->> 'subject_title',
                v_subject -> 'subject_snapshot',
                p_profile_id
            )
            returning * into v_case;
        exception when unique_violation then
            select review_case.*
            into v_case
            from public.enrichment_profile_review_cases review_case
            where review_case.subject_key = v_subject ->> 'subject_key'
              and review_case.case_status in ('open', 'reviewing')
            for update;
            v_joined_existing := true;
        end;
    end if;

    insert into public.enrichment_profile_review_subscriptions (
        case_id,
        household_id,
        wine_id,
        requested_by,
        joined_existing
    ) values (
        v_case.id,
        p_household_id,
        p_wine_id,
        v_user_id,
        v_joined_existing
    )
    on conflict (case_id, household_id, requested_by)
    do update set wine_id = excluded.wine_id
    returning * into v_subscription;

    insert into public.enrichment_profile_review_messages (
        subscription_id,
        message_kind,
        comment,
        evidence_url
    ) values (
        v_subscription.id,
        p_category,
        v_comment,
        v_evidence_url
    );

    update public.enrichment_profile_review_cases review_case
    set updated_at = now()
    where review_case.id = v_case.id;

    return public.get_enrichment_profile_review_inbox(p_household_id);
end;
$$;

revoke all
on function public.request_enrichment_profile_review(uuid, uuid, uuid, text, text, text)
from public, anon;

grant execute
on function public.request_enrichment_profile_review(uuid, uuid, uuid, text, text, text)
to authenticated;


create or replace function public.add_enrichment_profile_review_message(
    p_household_id uuid,
    p_case_id uuid,
    p_comment text,
    p_evidence_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_subscription_id uuid;
    v_case_status text;
    v_comment text := nullif(trim(p_comment), '');
    v_evidence_url text := nullif(trim(p_evidence_url), '');
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;

    if v_comment is null or length(v_comment) not between 10 and 2000 then
        raise exception using errcode = '22023', message = 'Review comment must contain 10 to 2000 characters';
    end if;

    if v_evidence_url is not null and (
        length(v_evidence_url) > 2048
        or v_evidence_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$'
    ) then
        raise exception using errcode = '22023', message = 'Evidence must use a valid HTTPS URL';
    end if;

    select subscription.id, review_case.case_status
    into v_subscription_id, v_case_status
    from public.enrichment_profile_review_subscriptions subscription
    join public.enrichment_profile_review_cases review_case
      on review_case.id = subscription.case_id
    where subscription.case_id = p_case_id
      and subscription.household_id = p_household_id
      and subscription.requested_by = v_user_id;

    if not found then
        raise exception using errcode = '42501', message = 'Profile review subscription is required';
    end if;

    if v_case_status not in ('open', 'reviewing') then
        raise exception using errcode = '22023', message = 'This profile review case is already closed';
    end if;

    insert into public.enrichment_profile_review_messages (
        subscription_id,
        message_kind,
        comment,
        evidence_url
    ) values (
        v_subscription_id,
        'additional-information',
        v_comment,
        v_evidence_url
    );

    update public.enrichment_profile_review_cases review_case
    set updated_at = now()
    where review_case.id = p_case_id;

    return public.get_enrichment_profile_review_inbox(p_household_id);
end;
$$;

revoke all
on function public.add_enrichment_profile_review_message(uuid, uuid, text, text)
from public, anon;

grant execute
on function public.add_enrichment_profile_review_message(uuid, uuid, text, text)
to authenticated;


create or replace function public.mark_enrichment_profile_review_seen(
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
        select 1
        from public.household_members member
        where member.household_id = p_household_id
          and member.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Household access is required';
    end if;

    update public.enrichment_profile_review_subscriptions subscription
    set seen_at = now()
    where subscription.household_id = p_household_id
      and subscription.requested_by = v_user_id
      and subscription.notified_at is not null
      and (p_case_id is null or subscription.case_id = p_case_id);

    return public.get_enrichment_profile_review_inbox(p_household_id);
end;
$$;

revoke all
on function public.mark_enrichment_profile_review_seen(uuid, uuid)
from public, anon;

grant execute
on function public.mark_enrichment_profile_review_seen(uuid, uuid)
to authenticated;


-- 0.4.18 will add curator eligibility and a human review UI. This service-only
-- transition already makes status/outcome notifications testable and keeps the
-- browser unable to resolve its own report.
create or replace function public.update_enrichment_profile_review_case(
    p_case_id uuid,
    p_status text,
    p_resolution_summary text default null,
    p_resolution_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_case public.enrichment_profile_review_cases%rowtype;
    v_summary text := nullif(trim(p_resolution_summary), '');
begin
    if p_status not in ('reviewing', 'resolved', 'dismissed') then
        raise exception using errcode = '22023', message = 'Profile review status is invalid';
    end if;

    select review_case.*
    into v_case
    from public.enrichment_profile_review_cases review_case
    where review_case.id = p_case_id
    for update;

    if not found then
        raise exception using errcode = 'P0002', message = 'Profile review case was not found';
    end if;

    if v_case.case_status in ('resolved', 'dismissed') then
        raise exception using errcode = '22023', message = 'Closed profile review cases are immutable';
    end if;

    if p_status in ('resolved', 'dismissed') and (
        v_summary is null or length(v_summary) not between 10 and 4000
    ) then
        raise exception using errcode = '22023', message = 'A closed review case requires a clear outcome';
    end if;

    if p_status = 'resolved' and p_resolution_profile_id is not null
       and not exists (
            select 1
            from public.enrichment_profiles profile
            where profile.id = p_resolution_profile_id
              and profile.review_status = 'reviewed'
       ) then
        raise exception using errcode = '22023', message = 'Resolution profile must be reviewed';
    end if;

    update public.enrichment_profile_review_cases review_case
    set
        case_status = p_status,
        updated_at = now(),
        resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end,
        resolution_summary = case when p_status in ('resolved', 'dismissed') then v_summary else null end,
        resolution_profile_id = case when p_status = 'resolved' then p_resolution_profile_id else null end
    where review_case.id = p_case_id;

    update public.enrichment_profile_review_subscriptions subscription
    set notified_at = now(), seen_at = null
    where subscription.case_id = p_case_id;

    return jsonb_build_object(
        'status', p_status,
        'case_id', p_case_id,
        'notified_reporters', (
            select count(*)::integer
            from public.enrichment_profile_review_subscriptions subscription
            where subscription.case_id = p_case_id
        )
    );
end;
$$;

revoke all
on function public.update_enrichment_profile_review_case(uuid, text, text, uuid)
from public, anon, authenticated;

grant execute
on function public.update_enrichment_profile_review_case(uuid, text, text, uuid)
to service_role;

commit;
