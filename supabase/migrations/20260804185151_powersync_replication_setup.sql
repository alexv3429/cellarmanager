begin;

-- PowerSync uses logical replication to download authoritative database
-- changes. The password is deliberately not stored in this migration.
--
-- PostgreSQL roles are cluster-level objects and may survive a local
-- `supabase db reset`, so role creation must be idempotent.
do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'powersync_role'
    ) then
        execute 'create role powersync_role';
    end if;
end
$$;

-- Keep the role disabled until a deployment-specific password is configured
-- outside Git.
alter role powersync_role
    with replication bypassrls nologin;

-- Restrict PowerSync to reading the application schema and the eight tables
-- required by the offline-sync spike.
grant usage on schema public to powersync_role;

grant select on table
    public.households,
    public.household_members,
    public.devices,
    public.wines,
    public.cellars,
    public.locations,
    public.holdings,
    public.inventory_operations
to powersync_role;

-- PowerSync requires a publication named exactly "powersync".
-- Explicitly listing tables prevents unrelated schemas and tables from being
-- sent through the replication stream.
create publication powersync
for table
    public.households,
    public.household_members,
    public.devices,
    public.wines,
    public.cellars,
    public.locations,
    public.holdings,
    public.inventory_operations;

commit;
