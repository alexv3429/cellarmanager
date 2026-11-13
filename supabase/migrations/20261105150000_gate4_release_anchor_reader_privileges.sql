begin;

-- The longstanding wine-context function is owned by postgres. On the linked
-- project, migrations run as supabase_admin; the new invoker-rights helper
-- therefore needs these two narrow internal grants. Browser roles retain no
-- access to either private object.
grant select on private.drinking_window_reviewed_release_anchors to postgres;
grant execute on function private.drinking_window_unique_reviewed_release(
    public.wines,uuid,uuid,uuid,text) to postgres;

commit;
