begin;

-- The entity-shape checks are deferred so a hierarchy entity and its typed
-- row can be inserted in either order within one transaction. A deferred
-- trigger fires after the calling RPC has returned, so it must retain trusted
-- privileges rather than falling back to the authenticated session role.
alter function private.validate_wine_reference_entity_shape()
security definer;

revoke execute
on function private.validate_wine_reference_entity_shape()
from public, anon, authenticated;

commit;
