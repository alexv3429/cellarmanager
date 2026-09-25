begin;

-- New Supabase local stacks grant broad default privileges to service_role.
-- Revoke those defaults for the LWIN cache, then grant only the capabilities
-- required by the trusted import and matching services.
revoke all privileges on table
    public.wine_reference_sources,
    public.wine_reference_lwin_snapshots,
    public.wine_reference_lwin_entries,
    public.wine_reference_identifier_demands,
    public.wine_reference_active_lwin_entries
from service_role;

grant select on table public.wine_reference_sources
to service_role;

grant select, insert on table
    public.wine_reference_lwin_snapshots,
    public.wine_reference_lwin_entries
to service_role;

grant select, insert, update, delete on table
    public.wine_reference_identifier_demands
to service_role;

grant select on table public.wine_reference_active_lwin_entries
to service_role;

commit;
