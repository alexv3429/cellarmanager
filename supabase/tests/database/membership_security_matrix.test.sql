begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Local synthetic seed only; every probe rolls back its own writes as well as
-- the final transaction. Positive controls must succeed, not merely fail with
-- invalid arguments: a validation error is never counted as authorization.
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
    select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.probe(statement text) returns text language plpgsql as $$
begin
    begin
        execute statement;
        raise exception using errcode = 'ZX001', message = 'rollback successful probe';
    exception when sqlstate 'ZX001' then return 'allowed';
        when others then return sqlstate;
    end;
end;
$$;

-- Audit the entire helper/private/service surface, not just current UI links.
select ok(not has_function_privilege('anon', p.oid, 'EXECUTE'), p.oid::regprocedure || ' denies anonymous execution')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname <> 'preview_household_invitation';
select ok(not has_function_privilege('authenticated', p.oid, 'EXECUTE'), p.oid::regprocedure || ' cannot bypass its public guard')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname <> 'is_household_member';
select ok(p.proconfig @> array['search_path=""'], p.oid::regprocedure || ' fixes its definer search path')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prosecdef;
select ok(not has_table_privilege(browser, c.oid, privilege), browser || ' cannot ' || privilege || ' private.' || c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join unnest(array['anon','authenticated']) browser
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege
where n.nspname='private' and c.relkind='r';
select ok(not has_table_privilege('authenticated', 'public.' || relation, privilege), 'No direct ' || privilege || ' on ' || relation)
from unnest(array['households','household_members','devices','wines','cellars','locations','holdings','inventory_operations']) relation
cross join unnest(array['INSERT','UPDATE','DELETE']) privilege;
select ok(not has_function_privilege('authenticated', signature, 'EXECUTE'), 'Household Owner is not service publisher: ' || signature)
from unnest(array['public.claim_household_invitation_email(uuid,uuid,text)', 'public.complete_household_invitation_email(uuid,text)',
    'public.publish_enrichment_knowledge_version(uuid)', 'public.publish_reviewed_enrichment_research_drafts(integer)',
    'public.set_enrichment_curator_eligibility(uuid,text,text,text[],text,text)']) signature;

insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.id(n), 'matrix-' || n || '@example.test', '{"role":"owner","is_admin":true}'::jsonb from generate_series(3,9) n;
insert into public.household_members(id,household_id,user_id,role)
select pg_temp.id(400+n), pg_temp.id(100), pg_temp.id(n), case when n in (4,6,9) then 'owner' else 'member' end
from unnest(array[3,4,5,6,8,9]) n;
-- The same accounts have independent roles in B, including Owner in B but
-- Member in A. Ownership in one household must never bleed into another.
insert into public.household_members(household_id,user_id,role)
select pg_temp.id(200), pg_temp.id(n), case when n in (3,6) then 'owner' else 'member' end
from unnest(array[1,3,4,5,6]) n;
insert into public.devices(id,household_id,user_id,name)
select pg_temp.id(300+n), pg_temp.id(100), pg_temp.id(n), 'Matrix device' from unnest(array[3,4,5,6]) n;
insert into public.devices(id,household_id,user_id,name)
select pg_temp.id(600+n), pg_temp.id(200), pg_temp.id(n), 'Matrix B device' from unnest(array[1,3,4,5,6]) n;
select public.install_refined_pairing_knowledge();
create temp table matrix_dish as select d.dish_key from public.enrichment_dish_profiles d
join public.enrichment_knowledge_versions v on v.id=d.knowledge_version_id and v.status='active' order by d.dish_key limit 1;
insert into public.inventory_operations(id,household_id,device_id,user_id,operation_type,wine_id,source_location_id,quantity,remove_reason,status,error_code,created_at_client)
select pg_temp.id(9000+n), pg_temp.id(n*100), pg_temp.id(n*100+1), pg_temp.id(n), 'REMOVE', pg_temp.id(n*100+10),
    pg_temp.id(n*100+21), 1, 'OTHER', 'REJECTED', 'SYNTHETIC_MATRIX', now() from generate_series(1,2) n;
insert into public.household_wine_observations(id,household_id,wine_id,recorded_by,visibility,observation_type,observed_on,note)
select pg_temp.id(500+n*2+v), pg_temp.id(100), pg_temp.id(110), pg_temp.id(n),
    case when v=0 then 'personal' else 'household' end, 'other', current_date, 'Synthetic private/shared note'
from unnest(array[1,3,4,5,6]) n cross join generate_series(0,1) v;

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
create temp table matrix_invitation as select * from public.create_household_invitation(pg_temp.id(100), 'matrix-7@example.test');
select lives_ok($$select public.revoke_household_member(pg_temp.id(100),pg_temp.id(404))$$, 'Prepare actually revoked Owner');
select lives_ok($$select public.update_household_member_role(pg_temp.id(100),pg_temp.id(406),'member')$$, 'Prepare actually demoted Owner');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
select lives_ok($$select public.leave_household(pg_temp.id(100),pg_temp.id(405),'member')$$, 'Prepare actually departed Member');
reset role;

create temp table matrix_actors(label text, user_id uuid, device_id uuid, membership_id uuid, expected_role text, reads_a boolean, reads_b boolean);
insert into matrix_actors values
('Owner A / Member B',pg_temp.id(1),pg_temp.id(101),(select id from public.household_members where household_id=pg_temp.id(100) and user_id=pg_temp.id(1)),'owner',true,true),
('Member A / Owner B',pg_temp.id(3),pg_temp.id(303),pg_temp.id(403),'member',true,true),
('Demoted Owner A / Owner B',pg_temp.id(6),pg_temp.id(306),pg_temp.id(406),'member',true,true),
('Revoked Owner A / Member B',pg_temp.id(4),pg_temp.id(304),pg_temp.id(404),null,false,true),
('Departed Member A / Member B',pg_temp.id(5),pg_temp.id(305),pg_temp.id(405),null,false,true),
('Pending invitee',pg_temp.id(7),pg_temp.id(307),pg_temp.id(407),null,false,false),
('Unrelated Owner B',pg_temp.id(2),pg_temp.id(201),pg_temp.id(402),null,false,true);

create temp table matrix_actions(label text, required_role text, statement text);
insert into matrix_actions values
('permissions','member',$$select * from public.get_household_permissions(pg_temp.id(100))$$),
('member directory','member',$$select * from public.get_household_members(pg_temp.id(100))$$),
('device directory','member',$$select public.get_household_devices(pg_temp.id(100))$$),
('register own device','member',$$select public.register_device(pg_temp.id(999),pg_temp.id(100),'New synthetic browser')$$),
('rename own device','member',$$select public.manage_household_device(pg_temp.id(100),:device,'rename','Renamed')$$),
('revoke own device','member',$$select public.manage_household_device(pg_temp.id(100),:device,'revoke')$$),
('manage Owner device','owner',$$select public.manage_household_device(pg_temp.id(100),pg_temp.id(101),'rename','Renamed')$$),
('invite','owner',$$select * from public.create_household_invitation(pg_temp.id(100),'another@example.test')$$),
('list invitations','owner',$$select * from public.get_household_invitations(pg_temp.id(100))$$),
('list delivery history','owner',$$select * from public.get_household_invitation_deliveries(pg_temp.id(100))$$),
('replace invitation','owner',$$select * from public.reissue_household_invitation(pg_temp.id(100),(select invitation_id from matrix_invitation))$$),
('cancel invitation','owner',$$select * from public.revoke_household_invitation(pg_temp.id(100),(select invitation_id from matrix_invitation))$$),
('promote collaborator','owner',$$select * from public.update_household_member_role(pg_temp.id(100),pg_temp.id(408),'owner')$$),
('remove collaborator','owner',$$select * from public.revoke_household_member(pg_temp.id(100),pg_temp.id(408))$$),
('transfer ownership','owner',$$select public.transfer_household_ownership(pg_temp.id(100),:membership,pg_temp.id(408),'member')$$),
('leave own household','member',$$select public.leave_household(pg_temp.id(100),:membership,:role)$$),
('catalog edit','owner',$$select public.update_wine_catalog(pg_temp.id(110),'Domaine','Cuvee',2020,'red','Morgon','Beaujolais',750)$$),
('facts edit','owner',$$select public.update_wine_facts(pg_temp.id(110),'France',null,null,null,'[]','dry',13,'[]')$$),
('create cellar','owner',$$select public.create_cellar(pg_temp.id(100),'Synthetic cellar')$$),
('rename cellar','owner',$$select public.rename_cellar(pg_temp.id(120),'Renamed')$$),
('create location','owner',$$select public.create_location(pg_temp.id(100),pg_temp.id(120),'C')$$),
('rename location','owner',$$select public.rename_location(pg_temp.id(121),'Renamed')$$),
('maturity override','owner',$$select public.set_wine_maturity_override(pg_temp.id(110),2025,2027,2031,2034,'aging','Synthetic override')$$),
('clear maturity override','owner',$$select public.clear_wine_maturity_override(pg_temp.id(110))$$),
('serving override','owner',$$select public.set_wine_serving_override(pg_temp.id(110),15,17,15,30,'open-ahead','Synthetic override')$$),
('clear serving override','owner',$$select public.clear_wine_serving_override(pg_temp.id(110))$$),
('personal guidance','member',$$select public.get_wine_personal_guidance(pg_temp.id(110))$$),
('personal note','member',$$select public.save_wine_observation(pg_temp.id(110),null,'personal','other',current_date,null,null,null,null,null,null,null,'Synthetic note')$$),
('shared authored note','member',$$select public.save_wine_observation(pg_temp.id(110),null,'household','other',current_date,null,null,null,null,null,null,null,'Synthetic note')$$),
('own pairing preference','member',$$select public.set_pairing_preference(pg_temp.id(100),(select dish_key from matrix_dish),array['red'],'rich')$$),
('ADD existing','owner',$$select * from public.apply_inventory_operation(pg_temp.id(9800),pg_temp.id(100),:device,'ADD',pg_temp.id(110),null,pg_temp.id(121),1,now(),null)$$),
('MOVE','owner',$$select * from public.apply_inventory_operation(pg_temp.id(9800),pg_temp.id(100),:device,'MOVE',pg_temp.id(110),pg_temp.id(121),pg_temp.id(122),1,now(),null)$$),
('REMOVE','owner',$$select * from public.apply_inventory_operation(pg_temp.id(9800),pg_temp.id(100),:device,'REMOVE',pg_temp.id(110),pg_temp.id(121),null,1,now(),'DRANK')$$),
('ADD legacy','owner',$$select * from public.apply_add_inventory_operation(pg_temp.id(9800),pg_temp.id(100),:device,pg_temp.id(9801),'Synthetic','New wine',2020,pg_temp.id(121),1,now())$$),
('ADD rich','owner',$$select * from public.apply_add_inventory_operation(pg_temp.id(9800),pg_temp.id(100),:device,pg_temp.id(9801),'Synthetic','New wine',2020,'red',null,null,750,pg_temp.id(121),1,now())$$),
('bulk import','owner',$$select * from public.commit_csv_import(pg_temp.id(9802),pg_temp.id(100),:device,jsonb_build_array(jsonb_build_object(
 'record_number',2,'operation_id',pg_temp.id(9800),'requested_wine_id',pg_temp.id(110),'destination_location_id',pg_temp.id(121),
 'quantity',1,'wine_action','reuse','wine_producer','Domaine Test','wine_cuvee','Cuvée Offline','wine_vintage',2020,'wine_color','red','wine_appellation',null,'wine_area',null,'wine_format_ml',750)),now())$$);
grant select on matrix_actors, matrix_actions, matrix_invitation, matrix_dish to authenticated;

-- A fingerprint of every application table proves all successful/denied
-- probes below leave stock, secrets, private notes and membership untouched.
create function pg_temp.application_fingerprint() returns text language plpgsql as $$
declare t record; part text; parts text[] := '{}';
begin
    for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and c.relkind='r' order by 1,2 loop
        execute format('select md5(coalesce(string_agg(row_hash, '''' order by row_hash), '''')) from (select md5(to_jsonb(r)::text) row_hash from %I.%I r) x',t.nspname,t.relname) into part;
        parts := array_append(parts,part);
    end loop;
    return md5(parts::text);
end;
$$;
create temp table matrix_before as select pg_temp.application_fingerprint() fingerprint;

create function pg_temp.run_membership_matrix() returns setof text language plpgsql as $$
declare actor record; action record; relation text; actual bigint; expected text; sql text;
begin
    for actor in select * from matrix_actors order by label loop
        perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
        -- Deliberately stale/untrusted Owner metadata cannot override the DB.
        perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.user_id,'role','authenticated',
            'user_metadata',jsonb_build_object('role','owner','household_id',pg_temp.id(100)))::text,true);
        return next is(public.get_my_household_membership(pg_temp.id(100))->>'role',actor.expected_role,actor.label || ': live role');
        foreach relation in array array['households','household_members','devices','wines','cellars','locations','holdings','inventory_operations'] loop
            execute format('select count(*) from public.%I where %I=$1',relation,case when relation='households' then 'id' else 'household_id' end)
                into actual using pg_temp.id(100);
            return next is(actual > 0,actor.reads_a,actor.label || ': RLS A ' || relation);
            execute format('select count(*) from public.%I where %I=$1',relation,case when relation='households' then 'id' else 'household_id' end)
                into actual using pg_temp.id(200);
            return next is(actual > 0,actor.reads_b,actor.label || ': RLS B ' || relation);
        end loop;
        for action in select * from matrix_actions order by label loop
            sql := replace(replace(replace(action.statement,':device',quote_literal(actor.device_id)),
                ':membership',quote_literal(actor.membership_id)),':role',quote_literal(coalesce(actor.expected_role,'member')));
            expected := case when actor.expected_role='owner' or (actor.expected_role='member' and action.required_role='member') then 'allowed' else '42501' end;
            return next is(pg_temp.probe(sql),expected,actor.label || ': ' || action.label);
        end loop;
        -- Reading or editing another author's private note is never an Owner
        -- capability; a departed user's surviving shared note is not editable.
        return next is((select count(*) from public.household_wine_observations where household_id=pg_temp.id(100)
            and visibility='personal' and recorded_by<>actor.user_id),0::bigint,actor.label || ': other private notes hidden');
        return next is(pg_temp.probe('select public.delete_wine_observation(pg_temp.id(509))'),'42501',actor.label || ': cannot delete revoked author shared note');
    end loop;
end;
$$;
set local role authenticated;
select * from pg_temp.run_membership_matrix();
reset role;
select is(pg_temp.application_fingerprint(),(select fingerprint from matrix_before),'Every probe rolled back: all application table fingerprints unchanged');

-- An accepted link must not recreate revoked membership, even after the same
-- account is invited again. Token history and membership identity stay distinct.
grant select on matrix_invitation to anon;
set local role anon;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{}';
select is((select count(*) from public.preview_household_invitation(repeat('f',64))),0::bigint,'An unknown well-formed token discloses nothing');
select is(pg_temp.probe('select * from public.accept_household_invitation((select invitation_token from matrix_invitation))'),'42501','A bearer token cannot accept without authentication');
set local role authenticated;
select is(pg_temp.probe('select * from public.accept_household_invitation((select invitation_token from matrix_invitation))'),'28000','Authenticated role without a subject is not an account');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local request.jwt.claims='{"email":"matrix-7@example.test","user_metadata":{"role":"owner"}}';
select is(pg_temp.probe('select * from public.accept_household_invitation((select invitation_token from matrix_invitation))'),'42501','Spoofed email/Owner metadata cannot accept for another account');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000007';
create temp table matrix_accepted as select * from public.accept_household_invitation((select invitation_token from matrix_invitation));
select is((select membership_role from matrix_accepted),'member','An invitee with Owner metadata only receives Member access');
select is((select membership_id from public.accept_household_invitation((select invitation_token from matrix_invitation))),
    (select membership_id from matrix_accepted),'Duplicate acceptance returns the same membership');
select lives_ok($$select public.register_device(pg_temp.id(307),pg_temp.id(100),'Invitee browser')$$,'Accepted invitee can register a browser');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
select lives_ok($$select public.revoke_household_member(pg_temp.id(100),(select membership_id from matrix_accepted))$$,'Owner revokes the accepted membership');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000007';
select is(pg_temp.probe('select * from public.accept_household_invitation((select invitation_token from matrix_invitation))'),'22023','Old accepted link cannot undo revocation');
select is(public.get_my_household_membership(pg_temp.id(100))->>'role',null::text,'Revoked invitee has no live household role');
select is((select count(*) from public.wines where household_id=pg_temp.id(100)),0::bigint,'Revoked invitee cannot read cellar rows');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
create temp table matrix_reinvitation as select * from public.create_household_invitation(pg_temp.id(100),'matrix-7@example.test');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000007';
create temp table matrix_rejoined as select * from public.accept_household_invitation((select invitation_token from matrix_reinvitation));
select isnt((select membership_id from matrix_rejoined),(select membership_id from matrix_accepted),'Rejoining creates a new membership identity');
select is(pg_temp.probe('select * from public.accept_household_invitation((select invitation_token from matrix_invitation))'),'22023','Old accepted link cannot resolve a new membership');
select is(pg_temp.probe('select public.leave_household(pg_temp.id(100),(select membership_id from matrix_accepted),''member'')'),'40001','Stale leave request cannot remove the new membership');
select is(public.get_my_household_membership(pg_temp.id(100))->>'membership_id',(select membership_id::text from matrix_rejoined),'Rejoined membership survives stale requests');
select is(pg_temp.probe('select public.register_device(pg_temp.id(307),pg_temp.id(100),''Old browser'')'),'55000','Rejoining cannot revive a revoked registration');

-- Cross-household target IDs are untrusted even for a genuine Owner.
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
select is(pg_temp.probe('select public.manage_household_device(pg_temp.id(100),pg_temp.id(201),''revoke'')'),'42501','Owner A cannot revoke a B device by mixing IDs');
select is(pg_temp.probe('select public.apply_inventory_operation(pg_temp.id(9800),pg_temp.id(100),pg_temp.id(601),''REMOVE'',pg_temp.id(110),pg_temp.id(121),null,1,now(),''DRANK'')'),'42501','Even the same account cannot use its B registration for A uploads');
reset role;

select * from finish();
rollback;
