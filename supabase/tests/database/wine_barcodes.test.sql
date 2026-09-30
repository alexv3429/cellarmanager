begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_table_privilege('authenticated', 'public.wine_barcode_links', 'select'), 'Members may read linked barcodes');
select ok(not has_table_privilege('authenticated', 'public.wine_barcode_links', 'insert'), 'Clients cannot bypass reviewed linking');
select ok(not has_table_privilege('authenticated', 'public.wine_barcode_links', 'delete'), 'Clients cannot bypass reviewed unlinking');
select ok(not has_function_privilege('anon', 'public.link_wine_barcode(uuid,uuid,text)', 'execute'), 'Anonymous linking is denied');
select ok(not has_function_privilege('anon', 'public.unlink_wine_barcode(uuid)', 'execute'), 'Anonymous unlinking is denied');

insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009025', 'barcode-member@example.test');
insert into public.household_members(household_id, user_id, role)
values ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009025', 'member');
insert into public.wines(id, household_id, producer, cuvee, vintage, color)
values ('00000000-0000-4000-8000-000000009026', '00000000-0000-4000-8000-000000000100', 'Domaine Test', 'Cuvée Offline', 2021, 'red');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select lives_ok($$select public.link_wine_barcode('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000110', '00036000291452')$$,
    'Owner may link a checked barcode to own wine');
select lives_ok($$select public.link_wine_barcode('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000110', '00036000291452')$$,
    'Linking twice is idempotent');
select is((select count(*)::integer from public.wine_barcode_links), 1, 'Only one link is stored');
select throws_ok($$select public.link_wine_barcode('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000110', '00036000291453')$$,
    '22023', 'Invalid GTIN', 'Mistyped check digit is rejected by database');
select throws_ok($$select public.link_wine_barcode('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000210', '00036000291452')$$,
    '22023', 'Wine unavailable', 'A wine in another household cannot be linked');
select lives_ok($$select public.link_wine_barcode('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000009026', '00036000291452')$$,
    'A package code may link to another vintage without claiming identity');
select is((select count(*)::integer from public.wine_barcode_links), 2, 'Both vintages stay explicit');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009025';
select is((select count(*)::integer from public.wine_barcode_links), 2, 'Member may find both linked vintages');
select throws_ok($$select public.link_wine_barcode('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000110', '00036000291452')$$,
    '42501', 'Only an Owner can link a wine barcode', 'Member cannot link');
select throws_ok($$select public.unlink_wine_barcode((select id from public.wine_barcode_links limit 1))$$,
    '42501', 'Only an Owner can unlink a wine barcode', 'Member cannot unlink');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.wine_barcode_links), 0, 'Other household cannot read code links');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.unlink_wine_barcode((select id from public.wine_barcode_links limit 1)), true, 'Owner may remove a mistaken link');
select is((select count(*)::integer from public.wine_barcode_links), 1, 'Removing one link leaves the other vintage');

select * from finish();
rollback;
