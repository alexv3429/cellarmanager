begin;

-- A pending case keeps the producer wording that existed when it was
-- requested. The exemplar wine can be corrected afterwards, so resume against
-- its current producer text rather than the stale request snapshot.
create or replace function private.resume_enrichment_research_for_producer_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pending record;
begin
    for v_pending in
        select subscription.case_id, subscription.household_id
        from public.enrichment_research_subscriptions subscription
        join public.enrichment_research_cases research_case
          on research_case.id = subscription.case_id
        join public.wines wine
          on wine.id = subscription.exemplar_wine_id
         and wine.household_id = subscription.household_id
        where subscription.household_id = new.household_id
          and research_case.case_status = 'needs-identity-review'
          and private.normalize_wine_reference_text(wine.producer) =
              new.source_producer_normalized
    loop
        perform private.rebind_enrichment_research_subscription(
            v_pending.case_id,
            v_pending.household_id
        );
    end loop;

    return new;
end;
$$;

revoke execute
on function private.resume_enrichment_research_for_producer_preference()
from public, anon, authenticated;

-- Re-run the corrected trigger for already confirmed preferences whose
-- request was left behind by the former snapshot comparison.
update public.wine_reference_household_producer_preferences preference
set
    producer_id = preference.producer_id,
    updated_at = now()
where exists (
    select 1
    from public.enrichment_research_subscriptions subscription
    join public.enrichment_research_cases research_case
      on research_case.id = subscription.case_id
    join public.wines wine
      on wine.id = subscription.exemplar_wine_id
     and wine.household_id = subscription.household_id
    where subscription.household_id = preference.household_id
      and research_case.case_status = 'needs-identity-review'
      and private.normalize_wine_reference_text(wine.producer) =
          preference.source_producer_normalized
);

commit;
