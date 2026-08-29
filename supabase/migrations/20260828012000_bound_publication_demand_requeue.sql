begin;

-- Supabase rejects UPDATE statements without an explicit predicate. Publishing
-- a new shared-library version intentionally requeues every existing demand,
-- but must still express that bounded table-wide intent through its primary
-- key. The previous unqualified UPDATE left reviewed drafts pending forever.
create or replace function public.publish_enrichment_knowledge_version(
    p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version public.enrichment_knowledge_versions%rowtype;
    v_profile_count integer;
    v_payload jsonb;
    v_content_sha256 text;
begin
    select version.*
    into v_version
    from public.enrichment_knowledge_versions version
    where version.id = p_version_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Enrichment knowledge version does not exist';
    end if;

    if v_version.status <> 'draft' then
        raise exception using
            errcode = '22023',
            message = 'Only a draft enrichment knowledge version can be published';
    end if;

    select count(*)::integer
    into v_profile_count
    from public.enrichment_profiles profile
    where profile.knowledge_version_id = p_version_id;

    if v_profile_count = 0 then
        raise exception using
            errcode = '23514',
            message = 'An enrichment knowledge version requires at least one profile';
    end if;

    if not exists (
        select 1
        from public.enrichment_place_profiles place_profile
        where place_profile.knowledge_version_id = p_version_id
    ) then
        raise exception using
            errcode = '23514',
            message = 'An enrichment knowledge version requires a place baseline';
    end if;

    if exists (
        select 1
        from public.enrichment_profiles profile
        where profile.knowledge_version_id = p_version_id
          and profile.review_status <> 'reviewed'
    ) then
        raise exception using
            errcode = '23514',
            message = 'Every enrichment profile must be reviewed before publication';
    end if;

    if exists (
        select 1
        from public.enrichment_profiles profile
        where profile.knowledge_version_id = p_version_id
          and not exists (
              select 1
              from public.enrichment_profile_evidence link
              join public.enrichment_evidence evidence
                on evidence.id = link.evidence_id
              where link.profile_id = profile.id
                and link.evidence_role = 'supports'
                and evidence.review_status = 'reviewed'
          )
    ) then
        raise exception using
            errcode = '23514',
            message = 'Every enrichment profile requires reviewed supporting evidence';
    end if;

    if exists (
        select 1
        from public.enrichment_profiles profile
        join public.enrichment_profile_evidence link
          on link.profile_id = profile.id
        join public.enrichment_evidence evidence
          on evidence.id = link.evidence_id
        where profile.knowledge_version_id = p_version_id
          and evidence.review_status <> 'reviewed'
    ) then
        raise exception using
            errcode = '23514',
            message = 'Published profiles cannot link pending or rejected evidence';
    end if;

    v_payload := private.enrichment_knowledge_version_payload(p_version_id);
    v_content_sha256 := pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(v_payload::text, 'UTF8'),
            'sha256'
        ),
        'hex'
    );

    update public.enrichment_knowledge_versions version
    set status = 'superseded'
    where version.status = 'active';

    update public.enrichment_knowledge_versions version
    set
        status = 'active',
        content_sha256 = v_content_sha256,
        published_at = now()
    where version.id = p_version_id;

    update public.enrichment_jobs job
    set
        job_status = 'cancelled',
        lease_token = null,
        leased_by = null,
        lease_expires_at = null,
        next_attempt_at = null,
        completed_at = now(),
        updated_at = now(),
        last_error_code = 'superseded-knowledge-version'
    where job.job_status in ('queued', 'leased', 'retrying')
      and job.knowledge_version_id <> p_version_id;

    update public.enrichment_demands demand
    set
        demand_status = 'queued',
        attempt_count = 0,
        next_attempt_at = null,
        last_attempted_at = null,
        last_completed_at = null,
        last_error_code = null,
        requested_at = now(),
        updated_at = now()
    where demand.id is not null;

    return jsonb_build_object(
        'knowledge_version_id', p_version_id,
        'profile_count', v_profile_count,
        'content_sha256', v_content_sha256,
        'status', 'active'
    );
end;
$$;

revoke execute
on function public.publish_enrichment_knowledge_version(uuid)
from public, anon, authenticated;

grant execute
on function public.publish_enrichment_knowledge_version(uuid)
to service_role;

commit;
