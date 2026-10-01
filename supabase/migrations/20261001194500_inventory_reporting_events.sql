-- 0.7.1: a read-only reporting contract over accepted inventory history.
-- Current stock remains authoritative in public.holdings. This view is not a
-- replay source and deliberately excludes local pending and server-rejected
-- requests. Legacy v0.1 history can be normalized alongside it in 0.7.2.
create view public.inventory_reporting_events
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
    true as was_applied_to_stock
from public.inventory_operations as operation
where operation.status = 'ACCEPTED';

comment on view public.inventory_reporting_events is
    'Read-only v0.7 reporting events. Only accepted operations; holdings, not this view, remain the current stock authority. occurred_at is client-claimed; recorded_at is server time.';

revoke all on public.inventory_reporting_events
from public, anon, authenticated, powersync_role, service_role;
grant select on public.inventory_reporting_events to authenticated, service_role;
