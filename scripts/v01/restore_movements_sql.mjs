import { canonicalUuid } from "./restore_metadata_lib.mjs"

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function jsonQuote(value) {
  const json = JSON.stringify(value)
  let delimiter = "$v01history$"
  while (json.includes(delimiter)) delimiter = `$v01history${delimiter.length}$`
  return `${delimiter}${json}${delimiter}`
}

export function renderLegacyMovementsSql({ mode, plan, importedBy, expectedPreviewFingerprint }) {
  if (!new Set(["preview", "rehearsal", "apply"]).has(mode)) throw new Error("Invalid mode")
  if (plan.report.blockers.length) throw new Error("Plan has unresolved blockers")
  if (plan.rows.length === 0) throw new Error("Plan contains no historic stock events")
  const household = canonicalUuid(plan.household_id)
  const importer = canonicalUuid(importedBy)
  if (!/^[0-9a-f]{64}$/u.test(plan.source_sha256) || !/^[0-9a-f]{64}$/u.test(plan.plan_sha256)) {
    throw new Error("Invalid plan provenance")
  }
  if (mode !== "preview" && !/^[0-9a-f]{32}$/u.test(expectedPreviewFingerprint ?? "")) {
    throw new Error("A reviewed preview fingerprint is required")
  }
  const writing = mode !== "preview"

  return `-- CellarManager v0.1 movement history (${mode})
-- Source SHA-256: ${plan.source_sha256}
-- Plan SHA-256: ${plan.plan_sha256}
-- Private: contains archived wine and location data; never commit this file.
-- Opening stock is not a purchase. No statement writes holdings or operations.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

${writing ? `select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cellarmanager-v01-history|${household}', 0)
);` : ""}

do $identity$
begin
    if not exists (
        select 1 from public.household_members
        where household_id = ${quote(household)}::uuid
          and user_id = ${quote(importer)}::uuid
          and role = 'owner'
    ) then
        raise exception 'Importer is not an owner of the target household';
    end if;
end;
$identity$;

create temporary table _v01_history_proposed on commit drop as
select * from jsonb_to_recordset(${jsonQuote(plan.rows)}::jsonb) as proposed(
    id uuid,
    household_id uuid,
    wine_id uuid,
    archive_source_sha256 text,
    source_record_id uuid,
    source_holding_id uuid,
    event_type text,
    quantity integer,
    remove_reason text,
    occurred_at timestamptz,
    recorded_at timestamptz,
    source_from_cellar_id uuid,
    source_from_location text,
    source_to_cellar_id uuid,
    source_to_location text
);

do $plan_guard$
begin
    if (select count(*) from _v01_history_proposed) <> ${plan.rows.length}
       or exists (select 1 from _v01_history_proposed where household_id <> ${quote(household)}::uuid
                  or archive_source_sha256 <> ${quote(plan.source_sha256)})
       or (select count(distinct source_record_id) from _v01_history_proposed) <> ${plan.rows.length}
       or (select count(distinct id) from _v01_history_proposed) <> ${plan.rows.length} then
        raise exception 'Historic movement plan is incomplete or inconsistent';
    end if;
end;
$plan_guard$;

create temporary table _v01_history_inventory_before on commit drop as
select jsonb_build_object(
    'wines', (select count(*) from public.wines where household_id = ${quote(household)}::uuid),
    'cellars', (select count(*) from public.cellars where household_id = ${quote(household)}::uuid),
    'locations', (select count(*) from public.locations where household_id = ${quote(household)}::uuid),
    'holdings', (select count(*) from public.holdings where household_id = ${quote(household)}::uuid),
    'bottles', (select coalesce(sum(quantity), 0) from public.holdings where household_id = ${quote(household)}::uuid),
    'operations', (select count(*) from public.inventory_operations where household_id = ${quote(household)}::uuid)
) as counts;

create temporary table _v01_history_state on commit drop as
select proposed.*,
    target.id as target_wine_id,
    existing.id as existing_id,
    to_jsonb(existing) - 'imported_at' - 'imported_by' as existing_payload,
    case
        when target.id is null then 'missing-wine'
        when existing.id is null then 'new'
        when to_jsonb(existing) - 'imported_at' - 'imported_by' = to_jsonb(proposed)
            then 'existing-identical'
        else 'conflict'
    end as outcome
from _v01_history_proposed proposed
left join public.wines target
  on target.id = proposed.wine_id and target.household_id = proposed.household_id
left join public.legacy_inventory_events existing
  on existing.household_id = proposed.household_id
 and existing.source_record_id = proposed.source_record_id;

create temporary table _v01_history_fingerprint on commit drop as
select md5(
    coalesce(string_agg(
        state.id::text || ':' || coalesce(state.target_wine_id::text, 'missing') || ':' ||
        coalesce(state.existing_payload::text, 'new'),
        '|' order by state.id
    ), '') || (select counts::text from _v01_history_inventory_before)
) as fingerprint
from _v01_history_state state;

select jsonb_pretty(jsonb_build_object(
    'mode', ${quote(mode)},
    'source_sha256', ${quote(plan.source_sha256)},
    'plan_sha256', ${quote(plan.plan_sha256)},
    'preview_fingerprint', (select fingerprint from _v01_history_fingerprint),
    'inventory_before', (select counts from _v01_history_inventory_before),
    'proposed_events', (select count(*) from _v01_history_proposed),
    'opening_balance_events', (select count(*) from _v01_history_proposed where event_type = 'OPENING_BALANCE'),
    'confirmed_drink_events', (select count(*) from _v01_history_proposed where event_type = 'REMOVE'),
    'outcomes', (select jsonb_object_agg(outcome, amount) from (
        select outcome, count(*) as amount from _v01_history_state group by outcome
    ) outcomes)
)) as legacy_history_preview;

${writing ? `do $guard$
begin
    if (select fingerprint from _v01_history_fingerprint) <> ${quote(expectedPreviewFingerprint)} then
        raise exception 'Historic movement preview changed';
    end if;
    if exists (select 1 from _v01_history_state where outcome in ('missing-wine', 'conflict')) then
        raise exception 'Historic movement import has missing wines or conflicting rows';
    end if;
end;
$guard$;

insert into public.legacy_inventory_events (
    id, household_id, wine_id, archive_source_sha256, source_record_id,
    source_holding_id, event_type, quantity, remove_reason, occurred_at,
    recorded_at, source_from_cellar_id, source_from_location,
    source_to_cellar_id, source_to_location, imported_by
)
select id, household_id, wine_id, archive_source_sha256, source_record_id,
    source_holding_id, event_type, quantity, remove_reason, occurred_at,
    recorded_at, source_from_cellar_id, source_from_location,
    source_to_cellar_id, source_to_location, ${quote(importer)}::uuid
from _v01_history_state where outcome = 'new';

do $after_guard$
declare
    v_inventory jsonb;
begin
    select jsonb_build_object(
        'wines', (select count(*) from public.wines where household_id = ${quote(household)}::uuid),
        'cellars', (select count(*) from public.cellars where household_id = ${quote(household)}::uuid),
        'locations', (select count(*) from public.locations where household_id = ${quote(household)}::uuid),
        'holdings', (select count(*) from public.holdings where household_id = ${quote(household)}::uuid),
        'bottles', (select coalesce(sum(quantity), 0) from public.holdings where household_id = ${quote(household)}::uuid),
        'operations', (select count(*) from public.inventory_operations where household_id = ${quote(household)}::uuid)
    ) into v_inventory;
    if v_inventory <> (select counts from _v01_history_inventory_before) then
        raise exception 'Current inventory changed during historic movement import';
    end if;
    if (select count(*) from _v01_history_proposed proposed
        join public.legacy_inventory_events target
          on target.id = proposed.id
         and to_jsonb(target) - 'imported_at' - 'imported_by' = to_jsonb(proposed)
    ) <> ${plan.rows.length} then
        raise exception 'Historic movement import did not preserve every proposed row';
    end if;
end;
$after_guard$;` : ""}

${mode === "apply" ? "commit;" : "rollback;"}
`
}
