begin;

-- A curator must be able to correct a region fallback that actually applies
-- to one appellation. Keep the group and row IDs, dates and evidence; the
-- existing review hashes invalidate the old approvals when scope changes.
alter table public.drinking_window_reference_rows
    alter constraint drinking_window_reference_rows_group_fk
    deferrable initially immediate;

create function public.narrow_drinking_window_region_group(
    p_version_id uuid, p_group_id uuid, p_appellation_id uuid,
    p_expected_hash text, p_reason text, p_confirm boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_group public.drinking_window_ageing_groups%rowtype;
    v_row public.drinking_window_reference_rows%rowtype;
    v_before jsonb;
    v_after jsonb;
    v_before_hash text;
    v_after_hash text;
    v_count integer := 0;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_confirm is distinct from true
       or length(pg_catalog.btrim(coalesce(p_reason,''))) not between 30 and 1000 then
        raise exception using errcode='22023', message='Explain the corrected appellation scope';
    end if;
    perform 1 from public.drinking_window_reference_versions
      where id=p_version_id and status='draft' for update;
    if not found then
        raise exception using errcode='22023', message='Choose an unpublished working version';
    end if;
    select * into v_group from public.drinking_window_ageing_groups
      where id=p_group_id and version_id=p_version_id for update;
    if not found or v_group.scope <> 'region' or v_group.appellation_id is not null
       or not exists(select 1 from public.enrichment_places p
           where p.id=p_appellation_id and p.place_type='appellation'
             and private.drinking_window_place_contains(v_group.region_id,p.id)) then
        raise exception using errcode='22023', message='Choose a region group and an appellation in its region';
    end if;
    v_before_hash := private.drinking_window_review_subject_hash(p_version_id,'group',p_group_id);
    if p_expected_hash is distinct from v_before_hash then
        raise exception using errcode='40001', message='This group changed; refresh before correcting it';
    end if;
    -- The group lock serializes new members; lock existing members as well so
    -- another curator cannot move one while the scope is being checked.
    perform 1 from public.drinking_window_ageing_group_memberships m
      where m.version_id=p_version_id and m.group_id=p_group_id for update;
    -- Never narrow a multi-appellation group or infer membership from its name.
    if not exists(select 1 from public.drinking_window_ageing_group_memberships m
        where m.version_id=p_version_id and m.group_id=p_group_id)
       or exists(select 1 from public.drinking_window_ageing_group_memberships m
        where m.version_id=p_version_id and m.group_id=p_group_id
          and (m.member_place_id is null or not private.drinking_window_place_contains(
                p_appellation_id,m.member_place_id))) then
        raise exception using errcode='22023', message='All group members must already belong to the chosen appellation';
    end if;
    v_before := pg_catalog.to_jsonb(v_group);
    set constraints public.drinking_window_reference_rows_group_fk deferred;
    update public.drinking_window_ageing_groups
       set scope='appellation', appellation_id=p_appellation_id
     where id=p_group_id;
    for v_row in select * from public.drinking_window_reference_rows
      where version_id=p_version_id and ageing_group_id=p_group_id for update loop
        v_after_hash := private.drinking_window_review_subject_hash(p_version_id,'row',v_row.id);
        update public.drinking_window_reference_rows
          set scope='appellation',appellation_id=p_appellation_id where id=v_row.id;
        insert into private.drinking_window_fallback_corrections(
          version_id,subject_kind,subject_id,curator_id,before_hash,after_hash,before_state,after_state)
        select p_version_id,'row',v_row.id,auth.uid(),v_after_hash,
          private.drinking_window_review_subject_hash(p_version_id,'row',v_row.id),
          pg_catalog.to_jsonb(v_row),pg_catalog.to_jsonb(r)
        from public.drinking_window_reference_rows r where r.id=v_row.id;
        v_count := v_count + 1;
    end loop;
    set constraints public.drinking_window_reference_rows_group_fk immediate;
    select pg_catalog.to_jsonb(g) into v_after from public.drinking_window_ageing_groups g
      where g.id=p_group_id;
    v_after_hash := private.drinking_window_review_subject_hash(p_version_id,'group',p_group_id);
    insert into private.drinking_window_fallback_corrections(
      version_id,subject_kind,subject_id,curator_id,before_hash,after_hash,before_state,after_state)
    values(p_version_id,'group',p_group_id,auth.uid(),v_before_hash,v_after_hash,
      v_before,v_after || pg_catalog.jsonb_build_object('scope_correction_reason',pg_catalog.btrim(p_reason)));
    return pg_catalog.jsonb_build_object('group_id',p_group_id,'rows_changed',v_count,
      'new_hash',v_after_hash,'approval_requires_review',true);
end;
$$;
revoke all on function public.narrow_drinking_window_region_group(uuid,uuid,uuid,text,text,boolean)
from public, anon;
grant execute on function public.narrow_drinking_window_region_group(uuid,uuid,uuid,text,text,boolean)
to authenticated;

commit;
