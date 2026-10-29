begin;

-- Some researched releases have no shared identity yet. A curator can create
-- one from an individually reviewed candidate, explicitly choosing any
-- existing producer/product first. This never links household wines or
-- promotes the candidate's dates into a shared window.
create table private.drinking_window_candidate_identity_creations (
    id bigint generated always as identity primary key,
    candidate_id uuid not null references public.drinking_window_candidates(id),
    review_id uuid not null references private.drinking_window_candidate_review_drafts(id),
    producer_id uuid not null references public.wine_reference_producers(id),
    product_id uuid not null references public.wine_reference_products(id),
    release_id uuid not null references public.wine_reference_releases(id),
    created_producer boolean not null,
    created_product boolean not null,
    created_release boolean not null,
    curator_id uuid not null references public.enrichment_curator_eligibilities(user_id),
    identity_reason text not null check (length(pg_catalog.btrim(identity_reason)) between 20 and 1000),
    created_at timestamptz not null default now(),
    unique (review_id)
);
revoke all on private.drinking_window_candidate_identity_creations
from public, anon, authenticated, powersync_role;
grant select on private.drinking_window_candidate_identity_creations to service_role;
create trigger drinking_window_candidate_identity_creations_immutable
before update or delete on private.drinking_window_candidate_identity_creations
for each row execute function private.reject_drinking_window_shadow_update();

create function public.create_drinking_window_candidate_release(
    p_candidate_id uuid, p_expected_review_id uuid,
    p_producer_id uuid, p_product_id uuid,
    p_producer_name text, p_product_name text,
    p_identity_reason text, p_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_candidate public.drinking_window_candidates%rowtype;
    v_review private.drinking_window_candidate_review_drafts%rowtype;
    v_existing private.drinking_window_candidate_identity_creations%rowtype;
    v_producer_id uuid := p_producer_id;
    v_product_id uuid := p_product_id;
    v_release_id uuid;
    v_created_producer boolean := false;
    v_created_product boolean := false;
    v_created_release boolean := false;
    v_count integer;
    v_name text;
    v_product_name text;
begin
    perform private.require_enrichment_curator(auth.uid(), 'drinking-window');
    if p_candidate_id is null or p_expected_review_id is null
       or p_confirmed is distinct from true
       or length(pg_catalog.btrim(coalesce(p_identity_reason,''))) not between 20 and 1000
       or (p_product_id is not null and p_producer_id is null) then
        raise exception using errcode = '22023',
            message = 'Confirm the exact shared identity and your reason';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(927412, 3);
    select * into v_existing from private.drinking_window_candidate_identity_creations
    where review_id = p_expected_review_id;
    if found then
        if v_existing.candidate_id <> p_candidate_id then
            raise exception using errcode = '40001', message = 'Identity review changed';
        end if;
        return pg_catalog.jsonb_build_object(
            'producer_id',v_existing.producer_id,
            'product_id',v_existing.product_id,
            'release_id',v_existing.release_id,
            'created_producer',v_existing.created_producer,
            'created_product',v_existing.created_product,
            'created_release',v_existing.created_release,
            'already_created',true);
    end if;
    select * into v_candidate from public.drinking_window_candidates
    where id = p_candidate_id and candidate_scope = 'release'
      and source_identity ->> 'origin' = 'producer-exchange'
      and review_status <> 'rejected' for share;
    if not found then
        raise exception using errcode = '22023', message = 'Research proposal not found';
    end if;
    select * into v_review from private.drinking_window_candidate_review_drafts
    where candidate_id = p_candidate_id order by created_at desc, id desc limit 1;
    if not found or v_review.id <> p_expected_review_id
       or v_review.proposed_scope <> 'release' or v_review.disposition <> 'propose'
       or v_review.rights_status <> 'reuse-allowed'
       or v_review.first_trial_year is null or v_review.best_start_year is null
       or v_review.best_end_year is null then
        raise exception using errcode = '40001',
            message = 'A current, complete research review is required';
    end if;
    if v_candidate.vintage_year not between 1800 and 2200 then
        raise exception using errcode = '22023', message = 'A vintage is required';
    end if;
    if v_producer_id is not null then
        perform 1 from public.wine_reference_producers where id = v_producer_id;
        if not found then
            raise exception using errcode = '22023', message = 'Choose an existing producer';
        end if;
    else
        v_name := pg_catalog.btrim(coalesce(p_producer_name,''));
        if length(v_name) not between 2 and 200 then
            raise exception using errcode = '22023', message = 'Name the new producer';
        end if;
        select count(*), min(id::text)::uuid into v_count, v_producer_id
        from public.wine_reference_producers
        where private.normalize_wine_reference_text(canonical_name)
            = private.normalize_wine_reference_text(v_name);
        if v_count > 0 then
            raise exception using errcode = '23505',
                message = 'This producer already exists; select it instead';
        end if;
        v_producer_id := pg_catalog.gen_random_uuid();
        insert into public.wine_reference_entities(id,entity_type)
        values (v_producer_id,'producer');
        insert into public.wine_reference_producers(id,canonical_name)
        values (v_producer_id,v_name);
        v_created_producer := true;
    end if;
    if v_product_id is not null then
        perform 1 from public.wine_reference_products
        where id = v_product_id and producer_id = v_producer_id;
        if not found then
            raise exception using errcode = '22023',
                message = 'Choose a cuvée belonging to this producer';
        end if;
    else
        v_product_name := pg_catalog.btrim(coalesce(p_product_name,''));
        if length(v_product_name) not between 2 and 200 then
            raise exception using errcode = '22023', message = 'Name the new cuvée';
        end if;
        select count(*), min(id::text)::uuid into v_count, v_product_id
        from public.wine_reference_products
        where producer_id = v_producer_id
          and private.normalize_wine_reference_text(canonical_name)
            = private.normalize_wine_reference_text(v_product_name);
        if v_count > 0 then
            raise exception using errcode = '23505',
                message = 'This producer already has the cuvée; select it instead';
        end if;
        v_product_id := pg_catalog.gen_random_uuid();
        insert into public.wine_reference_entities(id,entity_type)
        values (v_product_id,'product');
        insert into public.wine_reference_products(id,producer_id,canonical_name)
        values (v_product_id,v_producer_id,v_product_name);
        v_created_product := true;
    end if;
    select count(*), min(id::text)::uuid into v_count, v_release_id
    from public.wine_reference_releases
    where product_id = v_product_id and vintage_year = v_candidate.vintage_year;
    if v_count > 1 then
        raise exception using errcode = '23505',
            message = 'Several releases exist for this vintage; select one manually';
    elsif v_count = 0 then
        v_release_id := pg_catalog.gen_random_uuid();
        insert into public.wine_reference_entities(id,entity_type)
        values (v_release_id,'release');
        insert into public.wine_reference_releases(id,product_id,vintage_year)
        values (v_release_id,v_product_id,v_candidate.vintage_year);
        v_created_release := true;
    end if;
    insert into private.drinking_window_candidate_identity_creations(
        candidate_id,review_id,producer_id,product_id,release_id,
        created_producer,created_product,created_release,curator_id,identity_reason
    ) values (
        p_candidate_id,p_expected_review_id,v_producer_id,v_product_id,v_release_id,
        v_created_producer,v_created_product,v_created_release,auth.uid(),
        pg_catalog.btrim(p_identity_reason)
    );
    return pg_catalog.jsonb_build_object(
        'producer_id',v_producer_id,'product_id',v_product_id,
        'release_id',v_release_id,'created_producer',v_created_producer,
        'created_product',v_created_product,'created_release',v_created_release,
        'already_created',false);
end;
$$;
revoke all on function public.create_drinking_window_candidate_release(
    uuid,uuid,uuid,uuid,text,text,text,boolean) from public, anon;
grant execute on function public.create_drinking_window_candidate_release(
    uuid,uuid,uuid,uuid,text,text,text,boolean) to authenticated;

commit;
