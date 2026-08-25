begin;

create or replace function private.copy_enrichment_profiles(
    p_source_version_id uuid,
    p_target_version_id uuid,
    p_id_namespace text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    if p_source_version_id = p_target_version_id
       or nullif(trim(p_id_namespace), '') is null then
        raise exception using
            errcode = '22023',
            message = 'Knowledge copy requires distinct versions and an ID namespace';
    end if;

    insert into public.enrichment_profiles (
        id,
        knowledge_version_id,
        profile_type,
        review_status,
        confidence,
        rationale,
        reviewed_by,
        reviewed_at
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || profile.id::text),
        p_target_version_id,
        profile.profile_type,
        profile.review_status,
        profile.confidence,
        profile.rationale,
        profile.reviewed_by,
        profile.reviewed_at
    from public.enrichment_profiles profile
    where profile.knowledge_version_id = p_source_version_id;

    get diagnostics v_count = row_count;

    insert into public.enrichment_place_profiles (
        profile_id, knowledge_version_id, place_id, wine_color,
        first_trial_age, best_start_age, best_end_age, outer_horizon_age,
        body, acidity, tannin, sweetness, alcohol, freshness, savory,
        concentration
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.place_id, typed.wine_color,
        typed.first_trial_age, typed.best_start_age, typed.best_end_age,
        typed.outer_horizon_age, typed.body, typed.acidity, typed.tannin,
        typed.sweetness, typed.alcohol, typed.freshness, typed.savory,
        typed.concentration
    from public.enrichment_place_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_place_adjustment_profiles (
        profile_id, knowledge_version_id, place_id, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.place_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_place_adjustment_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_vintage_profiles (
        profile_id, knowledge_version_id, place_id, vintage_year, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, condition_tags, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.place_id, typed.vintage_year,
        typed.wine_color, typed.first_trial_age_adjustment,
        typed.best_start_age_adjustment, typed.best_end_age_adjustment,
        typed.outer_horizon_age_adjustment, typed.body_adjustment,
        typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.condition_tags, typed.concentration_adjustment
    from public.enrichment_vintage_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_producer_era_profiles (
        profile_id, knowledge_version_id, producer_id,
        first_vintage_year, final_vintage_year, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.producer_id, typed.first_vintage_year,
        typed.final_vintage_year, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_producer_era_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_producer_vintage_interaction_profiles (
        profile_id, knowledge_version_id, producer_era_profile_id,
        required_condition_tags,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id,
        private.enrichment_seed_uuid(
            p_id_namespace || typed.producer_era_profile_id::text
        ),
        typed.required_condition_tags,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_producer_vintage_interaction_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_cuvee_profiles (
        profile_id, knowledge_version_id, product_id, place_id, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.product_id, typed.place_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_cuvee_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_release_profiles (
        profile_id, knowledge_version_id, release_id, wine_color,
        first_trial_age_adjustment, best_start_age_adjustment,
        best_end_age_adjustment, outer_horizon_age_adjustment,
        body_adjustment, acidity_adjustment, tannin_adjustment,
        sweetness_adjustment, alcohol_adjustment, freshness_adjustment,
        savory_adjustment, concentration_adjustment
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.release_id, typed.wine_color,
        typed.first_trial_age_adjustment, typed.best_start_age_adjustment,
        typed.best_end_age_adjustment, typed.outer_horizon_age_adjustment,
        typed.body_adjustment, typed.acidity_adjustment, typed.tannin_adjustment,
        typed.sweetness_adjustment, typed.alcohol_adjustment,
        typed.freshness_adjustment, typed.savory_adjustment,
        typed.concentration_adjustment
    from public.enrichment_release_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_dish_profiles (
        profile_id, knowledge_version_id, dish_key, dish_name, description,
        intensity, fat, acidity, sweetness, salt, umami, spice, protein, fish
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || typed.profile_id::text),
        p_target_version_id, typed.dish_key, typed.dish_name,
        typed.description, typed.intensity, typed.fat, typed.acidity,
        typed.sweetness, typed.salt, typed.umami, typed.spice,
        typed.protein, typed.fish
    from public.enrichment_dish_profiles typed
    where typed.knowledge_version_id = p_source_version_id;

    insert into public.enrichment_profile_evidence (
        profile_id,
        evidence_id,
        evidence_role
    )
    select
        private.enrichment_seed_uuid(p_id_namespace || link.profile_id::text),
        link.evidence_id,
        link.evidence_role
    from public.enrichment_profile_evidence link
    join public.enrichment_profiles profile on profile.id = link.profile_id
    where profile.knowledge_version_id = p_source_version_id;

    return v_count;
end;
$$;

revoke execute on function private.copy_enrichment_profiles(uuid,uuid,text)
from public, anon, authenticated;

grant execute on function private.copy_enrichment_profiles(uuid,uuid,text)
to service_role;

create or replace function public.install_expanded_pairing_knowledge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_v4_id uuid := private.enrichment_seed_uuid('knowledge:pairing-v4');
    v_version_id uuid := private.enrichment_seed_uuid('knowledge:pairing-v5');
    v_evidence_id uuid := private.enrichment_seed_uuid(
        'evidence:cellarmanager-pairing-v1'
    );
    v_dish record;
    v_profile_id uuid;
    v_result jsonb;
begin
    if exists (
        select 1
        from public.enrichment_knowledge_versions version
        where version.id = v_version_id
          and version.status in ('active', 'superseded', 'retired')
    ) then
        select jsonb_build_object(
            'knowledge_version_id', version.id,
            'status', version.status,
            'content_sha256', version.content_sha256,
            'already_installed', true
        )
        into v_result
        from public.enrichment_knowledge_versions version
        where version.id = v_version_id;

        return v_result;
    end if;

    if exists (
        select 1
        from public.enrichment_knowledge_versions version
        where version.version_number = 5
          and version.id <> v_version_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'Knowledge version 5 is already used by another model';
    end if;

    perform public.install_pairing_knowledge();

    insert into public.enrichment_knowledge_versions (
        id,
        version_number,
        label,
        model_key,
        model_version
    )
    values (
        v_version_id,
        5,
        'Expanded reviewed structural food pairing model',
        'hierarchical-maturity',
        'pairing-1.1.0'
    )
    on conflict (id) do nothing;

    perform private.copy_enrichment_profiles(
        v_v4_id,
        v_version_id,
        'profile:pairing-v5:copy:'
    );

    for v_dish in
        select *
        from jsonb_to_recordset($dishes$
        [
          {"key":"custom-dish","name":"Custom dish","description":"A neutral starting point. Adjust the structure below to describe the actual recipe.","intensity":2,"fat":2,"acidity":2,"sweetness":0,"salt":2,"umami":2,"spice":0,"protein":1,"fish":0},
          {"key":"vegetable-crudites","name":"Raw vegetables or crudités","description":"A very light, crisp vegetable dish with modest acidity and almost no richness.","intensity":1,"fat":0,"acidity":2,"sweetness":0,"salt":1,"umami":1,"spice":0,"protein":0,"fish":0},
          {"key":"grilled-vegetables","name":"Grilled vegetables with herbs","description":"Moderate char, olive-oil richness, and savoury vegetables without heavy protein.","intensity":3,"fat":2,"acidity":1,"sweetness":1,"salt":2,"umami":3,"spice":0,"protein":0,"fish":0},
          {"key":"oysters-shellfish","name":"Oysters or raw shellfish","description":"Delicate seafood dominated by salinity, freshness, and tannin sensitivity.","intensity":2,"fat":0,"acidity":1,"sweetness":0,"salt":4,"umami":3,"spice":0,"protein":1,"fish":5},
          {"key":"white-fish-butter","name":"White fish with butter sauce","description":"Delicate fish made richer by a butter or cream sauce.","intensity":3,"fat":4,"acidity":1,"sweetness":0,"salt":2,"umami":2,"spice":0,"protein":2,"fish":5},
          {"key":"sushi-sashimi","name":"Sushi or sashimi","description":"Delicate raw fish with salty soy, seasoned rice, and a strong tannin constraint.","intensity":2,"fat":1,"acidity":2,"sweetness":1,"salt":3,"umami":3,"spice":0,"protein":1,"fish":5},
          {"key":"chicken-cream","name":"Chicken with cream sauce","description":"Mild poultry with substantial creamy richness and modest savoury depth.","intensity":3,"fat":4,"acidity":1,"sweetness":0,"salt":2,"umami":2,"spice":0,"protein":3,"fish":0},
          {"key":"roast-pork","name":"Roast pork","description":"Moderately powerful roast meat with fat, protein, and browned savoury flavours.","intensity":4,"fat":3,"acidity":1,"sweetness":0,"salt":2,"umami":3,"spice":0,"protein":4,"fish":0},
          {"key":"charcuterie","name":"Charcuterie or cured meat","description":"Fatty, salty, savoury cured meat with substantial flavour intensity.","intensity":4,"fat":4,"acidity":0,"sweetness":0,"salt":5,"umami":4,"spice":1,"protein":3,"fish":0},
          {"key":"beef-stew","name":"Slow-cooked beef stew","description":"A powerful, rich, protein-heavy dish with concentrated slow-cooked umami.","intensity":5,"fat":4,"acidity":2,"sweetness":0,"salt":3,"umami":5,"spice":0,"protein":5,"fish":0},
          {"key":"roast-lamb-herbs","name":"Roast lamb with herbs","description":"Rich, aromatic red meat with firm protein and restrained spice.","intensity":4,"fat":3,"acidity":1,"sweetness":0,"salt":2,"umami":3,"spice":1,"protein":5,"fish":0},
          {"key":"game-stew","name":"Game or venison stew","description":"Intense lean game with concentrated savoury slow-cooked flavours.","intensity":5,"fat":3,"acidity":2,"sweetness":0,"salt":3,"umami":4,"spice":1,"protein":5,"fish":0},
          {"key":"creamy-pasta","name":"Creamy pasta","description":"Medium-intensity pasta whose cream or cheese makes richness the main constraint.","intensity":3,"fat":4,"acidity":1,"sweetness":0,"salt":2,"umami":2,"spice":0,"protein":1,"fish":0},
          {"key":"seafood-risotto","name":"Seafood risotto","description":"Creamy rice with seafood salinity, umami, and tannin sensitivity.","intensity":3,"fat":3,"acidity":2,"sweetness":0,"salt":3,"umami":3,"spice":0,"protein":1,"fish":4},
          {"key":"pizza","name":"Tomato and cheese pizza","description":"Tomato acidity combined with melted-cheese fat, salt, and umami.","intensity":4,"fat":3,"acidity":3,"sweetness":1,"salt":3,"umami":4,"spice":0,"protein":1,"fish":0},
          {"key":"mild-coconut-curry","name":"Mild coconut curry","description":"A rich, aromatic curry with coconut sweetness and moderate chilli heat.","intensity":4,"fat":4,"acidity":1,"sweetness":2,"salt":2,"umami":2,"spice":2,"protein":2,"fish":0},
          {"key":"hot-chilli-curry","name":"Hot chilli curry","description":"An intense curry where chilli heat creates a material alcohol and tannin risk.","intensity":5,"fat":3,"acidity":1,"sweetness":1,"salt":2,"umami":3,"spice":5,"protein":3,"fish":0},
          {"key":"soft-cheese","name":"Soft creamy cheese","description":"A creamy, fatty cheese with moderate salt, intensity, and umami.","intensity":3,"fat":4,"acidity":1,"sweetness":0,"salt":2,"umami":3,"spice":0,"protein":2,"fish":0},
          {"key":"blue-cheese","name":"Blue cheese","description":"A very intense, salty, fatty, and umami-rich cheese.","intensity":5,"fat":4,"acidity":1,"sweetness":0,"salt":5,"umami":5,"spice":0,"protein":3,"fish":0},
          {"key":"chocolate-dessert","name":"Chocolate dessert","description":"An intense, rich, very sweet dessert that requires a genuinely sweet wine.","intensity":5,"fat":4,"acidity":0,"sweetness":5,"salt":0,"umami":1,"spice":0,"protein":0,"fish":0},
          {"key":"creme-brulee","name":"Crème brûlée or custard dessert","description":"A rich custard dessert with pronounced sweetness and caramelised intensity.","intensity":4,"fat":4,"acidity":0,"sweetness":5,"salt":0,"umami":0,"spice":0,"protein":0,"fish":0},
          {"key":"fresh-fruit","name":"Fresh fruit","description":"A light dessert where fruit acidity and sweetness both matter.","intensity":2,"fat":0,"acidity":3,"sweetness":3,"salt":0,"umami":0,"spice":0,"protein":0,"fish":0}
        ]
        $dishes$::jsonb) as dish_seed(
            key text,
            name text,
            description text,
            intensity numeric,
            fat numeric,
            acidity numeric,
            sweetness numeric,
            salt numeric,
            umami numeric,
            spice numeric,
            protein numeric,
            fish numeric
        )
    loop
        v_profile_id := private.enrichment_seed_uuid(
            'profile:pairing-v5:dish:' || v_dish.key
        );

        insert into public.enrichment_profiles (
            id,
            knowledge_version_id,
            profile_type,
            review_status,
            confidence,
            rationale,
            reviewed_at
        )
        values (
            v_profile_id,
            v_version_id,
            'dish',
            'reviewed',
            0.68,
            'Reviewed structural dish archetype; ingredients and preparation remain adjustable per request.',
            '2026-08-25T11:00:00Z'
        );

        insert into public.enrichment_dish_profiles (
            profile_id,
            knowledge_version_id,
            dish_key,
            dish_name,
            description,
            intensity,
            fat,
            acidity,
            sweetness,
            salt,
            umami,
            spice,
            protein,
            fish
        )
        values (
            v_profile_id,
            v_version_id,
            v_dish.key,
            v_dish.name,
            v_dish.description,
            v_dish.intensity,
            v_dish.fat,
            v_dish.acidity,
            v_dish.sweetness,
            v_dish.salt,
            v_dish.umami,
            v_dish.spice,
            v_dish.protein,
            v_dish.fish
        );

        insert into public.enrichment_profile_evidence (
            profile_id,
            evidence_id,
            evidence_role
        )
        values (v_profile_id, v_evidence_id, 'supports');
    end loop;

    return public.publish_enrichment_knowledge_version(v_version_id);
end;
$$;

comment on function public.install_expanded_pairing_knowledge() is
    'Copies immutable v4 and publishes v5 with 32 adjustable dish archetypes.';

revoke execute on function public.install_expanded_pairing_knowledge()
from public, anon, authenticated;

grant execute on function public.install_expanded_pairing_knowledge()
to service_role;

commit;
