-- A GTIN identifies packaging, not a particular vintage or physical bottle.
-- The same code may therefore be linked to more than one household wine.
create table public.wine_barcode_links (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    gtin14 text not null check (gtin14 ~ '^[0-9]{14}$'),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint wine_barcode_links_wine_fk foreign key (wine_id, household_id)
        references public.wines(id, household_id) on delete cascade,
    constraint wine_barcode_links_wine_code_unique unique (wine_id, gtin14)
);

create index wine_barcode_links_lookup_idx
    on public.wine_barcode_links(household_id, gtin14);

alter table public.wine_barcode_links enable row level security;

create policy wine_barcode_links_select_member
on public.wine_barcode_links for select to authenticated
using ((select private.is_household_member(household_id)));

revoke all on public.wine_barcode_links from public, anon, authenticated;
grant select on public.wine_barcode_links to authenticated;

create or replace function private.valid_gtin14(p_code text)
returns boolean
language plpgsql immutable strict
set search_path = ''
as $$
declare
    v_sum integer := 0;
    v_position integer;
begin
    if p_code !~ '^[0-9]{14}$' or p_code !~ '[1-9]' then return false; end if;
    for v_position in 1..13 loop
        v_sum := v_sum + substr(p_code, v_position, 1)::integer
            * case when v_position % 2 = 1 then 3 else 1 end;
    end loop;
    return (10 - v_sum % 10) % 10 = substr(p_code, 14, 1)::integer;
end;
$$;

revoke all on function private.valid_gtin14(text) from public, anon, authenticated;

create or replace function public.link_wine_barcode(
    p_household_id uuid,
    p_wine_id uuid,
    p_gtin14 text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
    v_link_id uuid;
begin
    if auth.uid() is null or not private.is_household_owner(p_household_id) then
        raise exception 'Only an Owner can link a wine barcode' using errcode = '42501';
    end if;
    if not private.valid_gtin14(p_gtin14) then
        raise exception 'Invalid GTIN' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.wines w
        where w.id = p_wine_id and w.household_id = p_household_id
          and w.merged_into_wine_id is null
    ) then
        raise exception 'Wine unavailable' using errcode = '22023';
    end if;
    insert into public.wine_barcode_links (household_id, wine_id, gtin14, created_by)
    values (p_household_id, p_wine_id, p_gtin14, auth.uid())
    on conflict (wine_id, gtin14) do update set gtin14 = excluded.gtin14
    returning id into v_link_id;
    return v_link_id;
end;
$$;

create or replace function public.unlink_wine_barcode(p_link_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
    v_household_id uuid;
begin
    select household_id into v_household_id
    from public.wine_barcode_links where id = p_link_id;
    if v_household_id is null then return false; end if;
    if auth.uid() is null or not private.is_household_owner(v_household_id) then
        raise exception 'Only an Owner can unlink a wine barcode' using errcode = '42501';
    end if;
    delete from public.wine_barcode_links where id = p_link_id;
    return true;
end;
$$;

revoke all on function public.link_wine_barcode(uuid, uuid, text) from public, anon;
revoke all on function public.unlink_wine_barcode(uuid) from public, anon;
grant execute on function public.link_wine_barcode(uuid, uuid, text) to authenticated;
grant execute on function public.unlink_wine_barcode(uuid) to authenticated;
