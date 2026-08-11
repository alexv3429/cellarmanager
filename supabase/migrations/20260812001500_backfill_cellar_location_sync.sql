begin;

-- PowerSync does not automatically replicate non-null defaults introduced by
-- ADD COLUMN for rows that already existed. These semantic no-op updates emit
-- each current row through logical replication so the new location-management
-- fields reach every client without changing their values.
update public.cellars
set is_active = is_active;

update public.locations
set is_active = is_active,
    display_order = display_order,
    capacity = capacity;

commit;
