begin;

-- Curators may correct an unpublished exact-release row. The existing subject
-- hash includes its dates, rationale and evidence, so every change makes an
-- earlier approval stale. Published versions remain immutable.
create table private.drinking_window_draft_row_corrections (
    id bigint generated always as identity primary key,
    version_id uuid not null references public.drinking_window_reference_versions(id),
    row_id uuid not null references public.drinking_window_reference_rows(id),
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    action text not null check (action in ('dates', 'attach-evidence', 'remove-evidence')),
    before_hash text not null check (before_hash ~ '^[0-9a-f]{64}$'),
    after_hash text not null check (after_hash ~ '^[0-9a-f]{64}$'),
    before_state jsonb not null,
    after_state jsonb not null,
    created_at timestamptz not null default now()
);
revoke all on private.drinking_window_draft_row_corrections
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_draft_row_corrections to service_role;
create trigger drinking_window_draft_row_corrections_immutable
before update or delete on private.drinking_window_draft_row_corrections
for each row execute function private.reject_drinking_window_shadow_update();

-- Only exact-release maturity-window evidence with a current, reviewed and
-- reusable policy is offered as date support. A URL submitted by an owner is
-- not such a record; its underlying words and rights need separate review.
create function private.drinking_window_reusable_release_evidence(
    p_evidence_id uuid, p_row_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.drinking_window_reference_rows r
        join public.enrichment_evidence e on e.id = p_evidence_id
        join public.enrichment_source_policies policy
          on policy.id = e.source_policy_id and policy.source_id = e.source_id
        where r.id = p_row_id and r.scope = 'release'
          and e.claim_type = 'maturity-window'
          and e.scope_level = 'release' and e.release_id = r.release_id
          and (e.wine_color is null or e.wine_color = r.wine_color)
          and e.review_status = 'reviewed'
          and policy.status = 'reviewed'
          and policy.display_right = 'allowed'
          and policy.normalized_storage_right = 'allowed'
          and policy.cross_household_reuse_right = 'allowed'
          and policy.effective_from <= current_date
          and (policy.effective_to is null or policy.effective_to >= current_date)
    );
$$;
revoke all on function private.drinking_window_reusable_release_evidence(uuid, uuid)
from public, anon, authenticated, powersync_role;

create function public.get_drinking_window_draft_row_correction(
    p_version_id uuid, p_row_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_row public.drinking_window_reference_rows%rowtype;
    v_linked jsonb;
    v_available jsonb;
    v_history jsonb;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    select r.* into v_row
    from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where r.id = p_row_id and r.version_id = p_version_id
      and r.scope = 'release' and v.status = 'draft';
    if not found then
        raise exception using errcode = '22023',
            message = 'Choose an unpublished exact-release row';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'link_id', link.id, 'evidence_id', e.id,
        'claim_part', link.claim_part, 'evidence_role', link.evidence_role,
        'source_name', source.source_name,
        'source_url', coalesce(e.source_record_url, source.homepage_url),
        'review_status', e.review_status,
        'reuse_right', policy.cross_household_reuse_right
    ) order by link.created_at, link.id), '[]'::jsonb) into v_linked
    from public.drinking_window_reference_evidence link
    join public.enrichment_evidence e on e.id = link.evidence_id
    join public.enrichment_sources source on source.id = e.source_id
    join public.enrichment_source_policies policy on policy.id = e.source_policy_id
    where link.version_id = p_version_id and link.reference_row_id = p_row_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'evidence_id', option.id, 'source_name', option.source_name,
        'source_url', option.source_url, 'source_published_on', option.source_published_on
    ) order by option.source_name, option.id), '[]'::jsonb) into v_available
    from (
        select e.id, source.source_name,
            coalesce(e.source_record_url, source.homepage_url) as source_url,
            e.source_published_on
        from public.enrichment_evidence e
        join public.enrichment_sources source on source.id = e.source_id
        where e.release_id = v_row.release_id
          and private.drinking_window_reusable_release_evidence(e.id, p_row_id)
        order by source.source_name, e.id
        limit 100
    ) option;

    select coalesce(jsonb_agg(jsonb_build_object(
        'action', event.action, 'created_at', event.created_at,
        'before_state', event.before_state, 'after_state', event.after_state
    ) order by event.id desc), '[]'::jsonb) into v_history
    from (select * from private.drinking_window_draft_row_corrections
          where version_id = p_version_id and row_id = p_row_id
          order by id desc limit 20) event;

    return jsonb_build_object(
        'hash', private.drinking_window_review_subject_hash(p_version_id, 'row', p_row_id),
        'first_trial_year', v_row.first_trial_year,
        'best_start_year', v_row.best_start_year,
        'best_end_year', v_row.best_end_year,
        'rationale', v_row.rationale,
        'linked', v_linked, 'available', v_available, 'history', v_history
    );
end;
$$;

create function public.correct_drinking_window_draft_row(
    p_version_id uuid, p_row_id uuid, p_expected_hash text,
    p_first_trial_year integer, p_best_start_year integer,
    p_best_end_year integer, p_rationale text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.drinking_window_reference_rows%rowtype;
    v_before_hash text;
    v_after_hash text;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    lock table public.drinking_window_reference_rows in share row exclusive mode;
    select r.* into v_row
    from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where r.id = p_row_id and r.version_id = p_version_id
      and r.scope = 'release' and v.status = 'draft' for update of r;
    if not found then
        raise exception using errcode = '22023',
            message = 'Only an unpublished exact-release row can be corrected';
    end if;
    v_before_hash := private.drinking_window_review_subject_hash(p_version_id, 'row', p_row_id);
    if p_expected_hash is distinct from v_before_hash then
        raise exception using errcode = '40001',
            message = 'This draft changed; refresh before correcting it';
    end if;
    if p_first_trial_year is null or p_best_start_year is null or p_best_end_year is null
       or p_first_trial_year < v_row.vintage_year
       or p_first_trial_year > p_best_start_year
       or p_best_start_year > p_best_end_year
       or p_best_end_year > 2300
       or length(trim(coalesce(p_rationale, ''))) not between 10 and 2000 then
        raise exception using errcode = '22023',
            message = 'Provide three ordered years and a reason of 10–2000 characters';
    end if;
    if (v_row.first_trial_year, v_row.best_start_year, v_row.best_end_year, v_row.rationale)
       is not distinct from
       (p_first_trial_year, p_best_start_year, p_best_end_year, trim(p_rationale)) then
        return v_before_hash;
    end if;
    update public.drinking_window_reference_rows
    set first_trial_year = p_first_trial_year,
        best_start_year = p_best_start_year,
        best_end_year = p_best_end_year,
        rationale = trim(p_rationale)
    where id = p_row_id;
    v_after_hash := private.drinking_window_review_subject_hash(p_version_id, 'row', p_row_id);
    insert into private.drinking_window_draft_row_corrections (
        version_id, row_id, curator_id, action, before_hash, after_hash,
        before_state, after_state
    ) values (
        p_version_id, p_row_id, auth.uid(), 'dates', v_before_hash, v_after_hash,
        jsonb_build_object('first_trial_year', v_row.first_trial_year,
            'best_start_year', v_row.best_start_year,
            'best_end_year', v_row.best_end_year, 'rationale', v_row.rationale),
        jsonb_build_object('first_trial_year', p_first_trial_year,
            'best_start_year', p_best_start_year,
            'best_end_year', p_best_end_year, 'rationale', trim(p_rationale))
    );
    return v_after_hash;
end;
$$;

create function public.change_drinking_window_draft_row_evidence(
    p_version_id uuid, p_row_id uuid, p_expected_hash text,
    p_action text, p_evidence_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.drinking_window_reference_rows%rowtype;
    v_before_hash text;
    v_after_hash text;
    v_changed integer;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    lock table public.drinking_window_reference_versions in share row exclusive mode;
    lock table public.drinking_window_reference_evidence in share row exclusive mode;
    select r.* into v_row
    from public.drinking_window_reference_rows r
    join public.drinking_window_reference_versions v on v.id = r.version_id
    where r.id = p_row_id and r.version_id = p_version_id
      and r.scope = 'release' and v.status = 'draft';
    if not found then
        raise exception using errcode = '22023',
            message = 'Only an unpublished exact-release row can be changed';
    end if;
    v_before_hash := private.drinking_window_review_subject_hash(p_version_id, 'row', p_row_id);
    if p_expected_hash is distinct from v_before_hash then
        raise exception using errcode = '40001',
            message = 'This draft changed; refresh before changing its sources';
    end if;
    if p_evidence_id is null or p_action is null
       or p_action not in ('attach', 'remove') then
        raise exception using errcode = '22023', message = 'Choose a date source and action';
    end if;
    if p_action = 'attach' then
        if not private.drinking_window_reusable_release_evidence(p_evidence_id, p_row_id) then
            raise exception using errcode = '22023',
                message = 'This source is not a reviewed reusable claim for this exact release';
        end if;
        -- One verified record must support the coherent three-date window.
        -- The schema stores first tasting and the optimal period separately,
        -- but the reviewer cannot mix two sources through this action.
        insert into public.drinking_window_reference_evidence (
            version_id, reference_row_id, evidence_id, claim_part, evidence_role
        )
        select p_version_id, p_row_id, p_evidence_id, part.claim_part, 'supports'
        from (values ('first_trial'), ('optimal_period')) part(claim_part)
        on conflict do nothing;
        get diagnostics v_changed = row_count;
        if v_changed = 0 then return v_before_hash; end if;
        if exists (select 1 from public.drinking_window_evidence_fit_issues(p_version_id) issue
                   where issue.subject_kind = 'row' and issue.subject_id = p_row_id
                     and issue.related_id in (
                         select link.id from public.drinking_window_reference_evidence link
                         where link.version_id = p_version_id
                           and link.reference_row_id = p_row_id
                           and link.evidence_id = p_evidence_id
                     )) then
            raise exception using errcode = '22023',
                message = 'This source does not fit the exact release or proposed date claim';
        end if;
    else
        delete from public.drinking_window_reference_evidence link
        where link.version_id = p_version_id and link.reference_row_id = p_row_id
          and link.evidence_id = p_evidence_id
          and link.claim_part in ('first_trial', 'optimal_period')
          and link.evidence_role = 'supports';
        get diagnostics v_changed = row_count;
        if v_changed = 0 then
            raise exception using errcode = '22023', message = 'This source link no longer exists';
        end if;
    end if;
    v_after_hash := private.drinking_window_review_subject_hash(p_version_id, 'row', p_row_id);
    insert into private.drinking_window_draft_row_corrections (
        version_id, row_id, curator_id, action, before_hash, after_hash,
        before_state, after_state
    ) values (
        p_version_id, p_row_id, auth.uid(),
        case when p_action = 'attach' then 'attach-evidence' else 'remove-evidence' end,
        v_before_hash, v_after_hash,
        jsonb_build_object('evidence_id', p_evidence_id,
            'linked', p_action = 'remove'),
        jsonb_build_object('evidence_id', p_evidence_id,
            'linked', p_action = 'attach')
    );
    return v_after_hash;
end;
$$;

revoke all on function public.get_drinking_window_draft_row_correction(uuid, uuid)
from public, anon;
revoke all on function public.correct_drinking_window_draft_row(uuid, uuid, text, integer, integer, integer, text)
from public, anon;
revoke all on function public.change_drinking_window_draft_row_evidence(uuid, uuid, text, text, uuid)
from public, anon;
grant execute on function public.get_drinking_window_draft_row_correction(uuid, uuid)
to authenticated;
grant execute on function public.correct_drinking_window_draft_row(uuid, uuid, text, integer, integer, integer, text)
to authenticated;
grant execute on function public.change_drinking_window_draft_row_evidence(uuid, uuid, text, text, uuid)
to authenticated;

commit;
