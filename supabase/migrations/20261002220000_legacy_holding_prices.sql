-- The accepted v0.1 archive has no acquisition rows or acquisition dates.
-- Its holdings do carry an unqualified price_bought value. Preserve that
-- source fact without inventing a purchase, currency, or acquired quantity.
create table public.legacy_holding_prices (
    household_id uuid not null,
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_holding_id uuid not null,
    wine_id uuid not null,
    price_bought numeric(12, 2) check (price_bought > 0),
    acquired_on date,
    source_quantity integer not null check (source_quantity >= 0),
    source_state text not null check (source_state in ('in_cellar', 'drunk')),
    source_cellar_id uuid,
    source_location text check (length(source_location) <= 120),
    imported_at timestamptz not null default now(),
    imported_by uuid not null,
    primary key (household_id, source_sha256, source_holding_id),
    foreign key (wine_id, household_id)
        references public.wines(id, household_id) on delete cascade,
    check (price_bought is not null or acquired_on is not null)
);

create index legacy_holding_prices_wine_idx
    on public.legacy_holding_prices(household_id, wine_id);

comment on table public.legacy_holding_prices is
    'Owner-private exact v0.1 holding metadata. Price is the archived price_bought field, not a verified acquisition, current value, or stock valuation. The source has no currency.';
comment on column public.legacy_holding_prices.source_quantity is
    'Snapshot holding quantity at v0.1 archive time, NOT the quantity originally acquired.';

alter table public.legacy_holding_prices enable row level security;
create policy legacy_holding_prices_owner_read
on public.legacy_holding_prices
for select to authenticated
using (exists (
    select 1 from public.household_members member
    where member.household_id = legacy_holding_prices.household_id
      and member.user_id = (select auth.uid())
      and member.role = 'owner'
));

revoke all on public.legacy_holding_prices
from public, anon, authenticated, powersync_role, service_role;
grant select on public.legacy_holding_prices to authenticated, service_role;
grant insert on public.legacy_holding_prices to service_role;
