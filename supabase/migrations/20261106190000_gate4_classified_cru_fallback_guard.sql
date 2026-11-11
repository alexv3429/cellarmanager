begin;

-- A generic village/region category cannot silently absorb either Premier or
-- Grand Cru. This only recognizes explicit labels; an unmarked Grand Cru still
-- needs a verified canonical classification rather than an inferred identity.
create function private.drinking_window_wine_requires_cru_classification(p_wine_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce((
        select private.normalize_wine_reference_text(
            coalesce(w.appellation, '') || ' ' || coalesce(w.cuvee, ''))
            ~ '(^| )(1c|1er cru|premier cru|gc|grand cru)( |$)'
        from public.wines w where w.id = p_wine_id
    ), false);
$$;
revoke all on function private.drinking_window_wine_requires_cru_classification(uuid)
from public, anon, authenticated, powersync_role, service_role;
grant execute on function private.drinking_window_wine_requires_cru_classification(uuid) to postgres;

-- Compatibility name used by existing selector versions. Its scope is now
-- deliberately broader: both classified levels require explicit membership.
create or replace function private.drinking_window_wine_is_premier_cru(p_wine_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select private.drinking_window_wine_requires_cru_classification(p_wine_id);
$$;
commit;
