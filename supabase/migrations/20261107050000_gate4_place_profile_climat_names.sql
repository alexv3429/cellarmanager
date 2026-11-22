begin;

-- A place profile may spell a climat with its parent appellation as a prefix,
-- while the shared catalogue stores the official short name. Resolve only
-- climat descendants of this exact appellation; preserve ambiguity detection.
-- Regional members, other place kinds and another appellation are unchanged.
do $migration$
declare
    v_definition text;
    v_original text := $original$                    where p.normalized_name = private.normalize_wine_reference_text(
                        v_member ->> 'name')
                      and v_place_id is not null$original$;
    v_replacement text := $replacement$                    where (p.normalized_name = private.normalize_wine_reference_text(
                        v_member ->> 'name')
                      or (v_profile.profile_kind = 'appellation' and p.place_type = 'climat'
                        and private.drinking_window_climat_name_key(p.canonical_name,
                            (select anchor.canonical_name from public.enrichment_places anchor
                             where anchor.id = v_place_id))
                          = private.drinking_window_climat_name_key(v_member ->> 'name',
                            (select anchor.canonical_name from public.enrichment_places anchor
                             where anchor.id = v_place_id))))
                      and v_place_id is not null$replacement$;
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
