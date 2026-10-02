-- v0.7.5: a purchase is explicit household financial history, not an
-- inventory ADD. Recording or correcting it never changes holdings.
-- A missing membership must be false, not NULL: PL/pgSQL IF NOT NULL would
-- otherwise skip the denial. This also hardens callers of the shared helper.
create or replace function private.is_household_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(private.current_household_role(p_household_id) = 'owner', false);
$$;

create table public.wine_acquisitions (
    id uuid primary key,
    household_id uuid not null,
    wine_id uuid not null,
    acquisition_kind text not null
        check (acquisition_kind in ('PURCHASE', 'GIFT', 'OTHER')),
    quantity integer not null check (quantity > 0),
    acquired_on date,
    unit_price_amount numeric(12, 2)
        check (unit_price_amount >= 0),
    price_currency text
        check (price_currency ~ '^[A-Z]{3}$'),
    source_name text
        check (length(source_name) <= 200),
    note text
        check (length(note) <= 500),
    source_kind text not null
        check (source_kind in ('MANUAL', 'LEGACY_V01')),
    source_fingerprint text
        check (source_fingerprint ~ '^[0-9a-f]{64}$'),
    source_record_id text
        check (length(source_record_id) between 1 and 200),
    created_at timestamptz not null default now(),
    created_by uuid,
    updated_at timestamptz not null default now(),
    updated_by uuid,
    voided_at timestamptz,
    voided_by uuid,

    constraint wine_acquisitions_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,
    constraint wine_acquisitions_price_shape
        check (
            (unit_price_amount is null and price_currency is null)
            or
            (acquisition_kind = 'PURCHASE'
                and unit_price_amount is not null
                and price_currency is not null)
        ),
    constraint wine_acquisitions_origin_shape
        check (
            (source_kind = 'MANUAL' and source_fingerprint is null
                and source_record_id is null and created_by is not null)
            or
            (source_kind = 'LEGACY_V01' and source_fingerprint is not null
                and source_record_id is not null and voided_at is null)
        ),
    constraint wine_acquisitions_void_shape
        check ((voided_at is null and voided_by is null)
            or (voided_at is not null and voided_by is not null))
);

create index wine_acquisitions_household_wine_date_idx
    on public.wine_acquisitions(household_id, wine_id, acquired_on desc, id);
create unique index wine_acquisitions_legacy_source_unique
    on public.wine_acquisitions(household_id, source_fingerprint, source_record_id)
    where source_kind = 'LEGACY_V01';

comment on table public.wine_acquisitions is
    'Owner-private acquisition history. Quantity and price never alter authoritative holdings or inventory operations.';
comment on column public.wine_acquisitions.unit_price_amount is
    'Price actually paid per bottle in price_currency, not current market value; unknown stays NULL.';
comment on column public.wine_acquisitions.acquired_on is
    'Calendar day when known. NULL means the date is unknown, not today.';

alter table public.wine_acquisitions enable row level security;
create policy wine_acquisitions_owner_read
on public.wine_acquisitions
for select to authenticated
using (exists (
    select 1 from public.household_members member
    where member.household_id = wine_acquisitions.household_id
      and member.user_id = (select auth.uid())
      and member.role = 'owner'
));

revoke all on public.wine_acquisitions
from public, anon, authenticated, powersync_role, service_role;
grant select on public.wine_acquisitions to authenticated, service_role;
grant insert on public.wine_acquisitions to service_role;

create function public.upsert_wine_acquisition(
    p_id uuid,
    p_wine_id uuid,
    p_acquisition_kind text,
    p_quantity integer,
    p_acquired_on date,
    p_unit_price_amount numeric,
    p_price_currency text,
    p_source_name text,
    p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_household_id uuid;
    v_existing public.wine_acquisitions%rowtype;
    v_currency text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_price_currency, ''))), '');
    v_source_name text := nullif(pg_catalog.btrim(coalesce(p_source_name, '')), '');
    v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    if p_id is null or p_wine_id is null then
        raise exception using errcode = '22023', message = 'Acquisition and wine ids are required';
    end if;

    select wine.household_id into v_household_id
    from public.wines wine
    where wine.id = p_wine_id and wine.merged_into_wine_id is null;
    if v_household_id is null then
        raise exception using errcode = '22023', message = 'Current wine was not found';
    end if;
    if not private.is_household_owner(v_household_id) then
        raise exception using errcode = '42501', message = 'Only a household owner can record acquisitions';
    end if;
    if p_acquisition_kind not in ('PURCHASE', 'GIFT', 'OTHER')
       or p_acquisition_kind is null
       or p_quantity is null or p_quantity <= 0
       or pg_catalog.length(coalesce(v_source_name, '')) > 200
       or pg_catalog.length(coalesce(v_note, '')) > 500
       or (p_unit_price_amount is null and v_currency is not null)
       or (p_unit_price_amount is not null and (
           p_acquisition_kind <> 'PURCHASE'
           or p_unit_price_amount < 0
           or p_unit_price_amount > 9999999999.99
           or p_unit_price_amount <> pg_catalog.round(p_unit_price_amount, 2)
           or v_currency is null
           or v_currency !~ '^[A-Z]{3}$'
       ))
    then
        raise exception using errcode = '22023', message = 'Acquisition details are invalid';
    end if;

    select acquisition.* into v_existing
    from public.wine_acquisitions acquisition
    where acquisition.id = p_id
    for update;
    if found then
        if v_existing.household_id <> v_household_id
           or v_existing.wine_id <> p_wine_id
           or v_existing.source_kind <> 'MANUAL'
           or v_existing.voided_at is not null
        then
            raise exception using errcode = '42501', message = 'This acquisition cannot be edited';
        end if;
        update public.wine_acquisitions
        set acquisition_kind = p_acquisition_kind,
            quantity = p_quantity,
            acquired_on = p_acquired_on,
            unit_price_amount = p_unit_price_amount,
            price_currency = v_currency,
            source_name = v_source_name,
            note = v_note,
            updated_at = now(),
            updated_by = v_user_id
        where id = p_id;
    else
        insert into public.wine_acquisitions (
            id, household_id, wine_id, acquisition_kind, quantity,
            acquired_on, unit_price_amount, price_currency, source_name,
            note, source_kind, created_by, updated_by
        ) values (
            p_id, v_household_id, p_wine_id, p_acquisition_kind, p_quantity,
            p_acquired_on, p_unit_price_amount, v_currency, v_source_name,
            v_note, 'MANUAL', v_user_id, v_user_id
        );
    end if;
    return p_id;
end;
$$;

create function public.void_wine_acquisition(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_existing public.wine_acquisitions%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication is required';
    end if;
    select acquisition.* into v_existing
    from public.wine_acquisitions acquisition
    where acquisition.id = p_id
    for update;
    if not found then
        raise exception using errcode = '22023', message = 'Acquisition was not found';
    end if;
    if not private.is_household_owner(v_existing.household_id)
       or v_existing.source_kind <> 'MANUAL'
    then
        raise exception using errcode = '42501', message = 'This acquisition cannot be removed';
    end if;
    if v_existing.voided_at is null then
        update public.wine_acquisitions
        set voided_at = now(), voided_by = v_user_id,
            updated_at = now(), updated_by = v_user_id
        where id = p_id;
    end if;
    return p_id;
end;
$$;

revoke all on function public.upsert_wine_acquisition(uuid, uuid, text, integer, date, numeric, text, text, text)
from public, anon, authenticated;
grant execute on function public.upsert_wine_acquisition(uuid, uuid, text, integer, date, numeric, text, text, text)
to authenticated;
revoke all on function public.void_wine_acquisition(uuid)
from public, anon, authenticated;
grant execute on function public.void_wine_acquisition(uuid) to authenticated;
