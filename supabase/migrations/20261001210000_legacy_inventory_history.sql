-- 0.7.2: archived v0.1 movements are historical evidence, never operations to
-- replay into the current authoritative holdings. Import is separate, guarded,
-- and explicitly limited to opening stock and confirmed removals.
create table public.legacy_inventory_events (
    id uuid primary key,
    household_id uuid not null,
    wine_id uuid not null,
    archive_source_sha256 text not null
        check (archive_source_sha256 ~ '^[0-9a-f]{64}$'),
    source_record_id uuid not null,
    source_holding_id uuid,
    event_type text not null
        check (event_type in ('OPENING_BALANCE', 'REMOVE')),
    quantity integer not null check (quantity > 0),
    remove_reason text,
    occurred_at timestamptz not null,
    recorded_at timestamptz not null,
    source_from_cellar_id uuid,
    source_from_location text
        check (length(source_from_location) <= 120),
    source_to_cellar_id uuid,
    source_to_location text
        check (length(source_to_location) <= 120),
    imported_at timestamptz not null default now(),
    imported_by uuid not null,

    constraint legacy_inventory_events_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id),
    constraint legacy_inventory_events_source_unique
        unique (household_id, source_record_id),
    constraint legacy_inventory_events_shape_check
        check (
            (event_type = 'OPENING_BALANCE'
                and remove_reason is null
                and source_from_cellar_id is null
                and source_from_location is null
                and source_to_cellar_id is not null)
            or
            (event_type = 'REMOVE'
                and remove_reason = 'DRANK'
                and source_from_cellar_id is not null
                and source_to_cellar_id is null
                and source_to_location is null)
        )
);

create index legacy_inventory_events_household_time_idx
    on public.legacy_inventory_events(household_id, occurred_at desc, id desc);
create index legacy_inventory_events_wine_time_idx
    on public.legacy_inventory_events(household_id, wine_id, occurred_at desc);

comment on table public.legacy_inventory_events is
    'Verified v0.1 history only. No trigger or RPC applies these rows to holdings; initial import is opening balance, never acquisition.';

alter table public.legacy_inventory_events enable row level security;
create policy legacy_inventory_events_select_member
on public.legacy_inventory_events
for select to authenticated
using ((select private.is_household_member(household_id)));

revoke all on public.legacy_inventory_events
from public, anon, authenticated, powersync_role, service_role;
grant select on public.legacy_inventory_events
to authenticated, powersync_role, service_role;
grant insert on public.legacy_inventory_events to service_role;

alter publication powersync add table public.legacy_inventory_events;

-- Keep the v0.7.1 columns unchanged and append the original legacy location
-- labels. They are not mapped onto mutable modern locations.
create or replace view public.inventory_reporting_events
with (security_invoker = true) as
select
    'operation:' || operation.id::text as event_key,
    'ACCEPTED_OPERATION'::text as event_source,
    operation.id::text as source_record_id,
    operation.household_id,
    operation.wine_id,
    operation.operation_type as event_type,
    operation.quantity,
    operation.source_location_id,
    operation.destination_location_id,
    operation.remove_reason,
    operation.user_id as actor_user_id,
    operation.created_at_client as occurred_at,
    'INSTANT'::text as occurred_at_precision,
    operation.received_at_server as recorded_at,
    true as was_applied_to_stock,
    null::uuid as source_legacy_cellar_id,
    null::text as source_legacy_location,
    null::uuid as destination_legacy_cellar_id,
    null::text as destination_legacy_location
from public.inventory_operations as operation
where operation.status = 'ACCEPTED'
union all
select
    'legacy-v01:' || legacy.source_record_id::text,
    'LEGACY_V01'::text,
    legacy.source_record_id::text,
    legacy.household_id,
    legacy.wine_id,
    legacy.event_type,
    legacy.quantity,
    null::uuid,
    null::uuid,
    legacy.remove_reason,
    null::uuid,
    legacy.occurred_at,
    'INSTANT'::text,
    legacy.recorded_at,
    false,
    legacy.source_from_cellar_id,
    legacy.source_from_location,
    legacy.source_to_cellar_id,
    legacy.source_to_location
from public.legacy_inventory_events as legacy;

comment on view public.inventory_reporting_events is
    'Read-only accepted modern operations and provenance-labelled legacy history. Legacy rows never apply stock; holdings remain the current stock authority.';

revoke all on public.inventory_reporting_events
from public, anon, authenticated, powersync_role, service_role;
grant select on public.inventory_reporting_events to authenticated, service_role;
