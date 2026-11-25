begin;

-- The cellar can carry classification separately from cuvée and appellation.
-- Honour explicit Premier/Grand Cru there as well as on the label text. This
-- does not infer a classification from a name or alter the wine itself.
create or replace function private.drinking_window_wine_requires_cru_classification(p_wine_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce((
        select private.normalize_wine_reference_text(
            coalesce(w.appellation, '') || ' ' || coalesce(w.cuvee, '') || ' ' ||
            coalesce(w.classification, ''))
            ~ '(^| )(1c|1er cru|premier cru|gc|grand cru)( |$)'
        from public.wines w where w.id = p_wine_id
    ), false);
$$;

commit;
