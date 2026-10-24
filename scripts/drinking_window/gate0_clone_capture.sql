-- Private-clone-only rehearsal helper. Never run against a linked project.
-- Run once before the pending batch, then call gate0_check.capture('after')
-- and the aggregate comparison query below after applying the batch.
-- This stores full responses only inside the disposable isolated database.
do $$ begin
    if current_database() !~ '^cm_gate0_' then
        raise exception 'Gate 0 capture is restricted to disposable private clones';
    end if;
end $$;

create schema if not exists gate0_check;

create table if not exists gate0_check.maturity_snapshots (
    phase text not null check (phase in ('before', 'after')),
    kind text not null check (kind in ('wine', 'overview')),
    entity_id uuid not null,
    payload jsonb not null,
    primary key (phase, kind, entity_id)
);

create or replace function gate0_check.capture(p_phase text)
returns table(wine_count bigint, overview_count bigint)
language plpgsql as $$
declare
    v_item record;
    v_user_id uuid;
begin
    if current_database() !~ '^cm_gate0_' then
        raise exception 'Gate 0 capture is restricted to disposable private clones';
    end if;
    if p_phase not in ('before', 'after') then
        raise exception 'Invalid capture phase';
    end if;
    if exists (select 1 from gate0_check.maturity_snapshots where phase = p_phase) then
        raise exception 'Capture phase % already exists', p_phase;
    end if;

    for v_item in select wine.id, wine.household_id
        from public.wines wine where wine.merged_into_wine_id is null
    loop
        select member.user_id into v_user_id
        from public.household_members member
        where member.household_id = v_item.household_id
        order by case when member.role = 'owner' then 0 else 1 end, member.user_id
        limit 1;
        if v_user_id is null then
            raise exception 'No household member to test a wine';
        end if;
        perform set_config('request.jwt.claim.sub', v_user_id::text, true);
        insert into gate0_check.maturity_snapshots(phase, kind, entity_id, payload)
        values (p_phase, 'wine', v_item.id, public.get_wine_maturity(v_item.id));
    end loop;

    for v_item in select household.id from public.households household loop
        select member.user_id into v_user_id
        from public.household_members member
        where member.household_id = v_item.id
        order by case when member.role = 'owner' then 0 else 1 end, member.user_id
        limit 1;
        if v_user_id is null then
            raise exception 'No household member to test an overview';
        end if;
        perform set_config('request.jwt.claim.sub', v_user_id::text, true);
        insert into gate0_check.maturity_snapshots(phase, kind, entity_id, payload)
        values (p_phase, 'overview', v_item.id,
            public.get_household_maturity_overview(v_item.id));
    end loop;
    perform set_config('request.jwt.claim.sub', '', true);
    return query select
        count(*) filter (where kind = 'wine'),
        count(*) filter (where kind = 'overview')
    from gate0_check.maturity_snapshots where phase = p_phase;
end;
$$;

create or replace function gate0_check.core_payload(p_kind text, p_payload jsonb)
returns jsonb language sql immutable as $$
    select case when p_kind = 'wine' then
        p_payload - 'effective_source' - 'reference' - 'reference_status'
    when p_kind = 'overview' then
        (select coalesce(jsonb_agg(
            item.value - 'effective_source' - 'reference_row_id'
                       - 'reference_version_number' order by item.ordinality),
            '[]'::jsonb)
         from jsonb_array_elements(p_payload) with ordinality item(value, ordinality))
    else null end;
$$;

select * from gate0_check.capture('before');

-- After the batch, run:
-- select * from gate0_check.capture('after');
-- select count(*) as missing_or_changed_core_responses
-- from (select * from gate0_check.maturity_snapshots where phase = 'before') b
-- full join (select * from gate0_check.maturity_snapshots where phase = 'after') a
--   on b.kind = a.kind and b.entity_id = a.entity_id
-- where b.entity_id is null or a.entity_id is null
--    or gate0_check.core_payload(b.kind, b.payload)
--       is distinct from gate0_check.core_payload(a.kind, a.payload);
