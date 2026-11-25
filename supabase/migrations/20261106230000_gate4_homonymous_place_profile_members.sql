begin;

-- A regional profile may explicitly include the region itself. If that region
-- also has a homonymous appellation, its anchored identity is not ambiguous:
-- the profile scope already establishes which place its own name denotes.
-- Other ambiguous descendant names remain quarantined for curator review.
do $migration$
declare
    v_definition text;
    v_original text := $original$                      and v_place_id is not null
                      and private.drinking_window_place_contains(v_place_id,p.id);
                    v_member_place_id := v_target_id;$original$;
    v_replacement text := $replacement$                      and v_place_id is not null
                      and private.drinking_window_place_contains(v_place_id,p.id)
                      and (p.id = v_place_id or p.normalized_name <> (
                        select anchor.normalized_name from public.enrichment_places anchor
                        where anchor.id = v_place_id));
                    v_member_place_id := v_target_id;$replacement$;
begin
    select pg_catalog.pg_get_functiondef(
      'public.preview_drinking_window_place_profile_exchange(uuid,uuid)'::regprocedure)
      into v_definition;
    if (length(v_definition) - length(replace(v_definition,v_original,''))) <> length(v_original) then
        raise exception 'Place profile preview has changed; refusing an unsafe replacement';
    end if;
    execute replace(v_definition,v_original,v_replacement);
end;
$migration$;

commit;
