import { DatabaseSync } from "node:sqlite"

import { canonicalUuid, sha256, sha256File } from "./restore_metadata_lib.mjs"

const DATE = /^\d{4}-\d{2}-\d{2}$/u
const STATES = new Set(["in_cellar", "drunk"])

function optionalUuid(value) {
  return value === null || value === undefined || value === ""
    ? null : canonicalUuid(value)
}

function sourceDate(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "string" || !DATE.test(value)) throw new Error("Invalid acquired_date")
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid acquired_date")
  }
  return value
}

function sourcePrice(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 9999999999.99) {
    throw new Error("Invalid price_bought")
  }
  const cents = Math.round(value * 100)
  if (Math.abs(value * 100 - cents) > 0.000001) throw new Error("Price has more than two decimal places")
  return (cents / 100).toFixed(2)
}

export function normalizeLegacyHoldingPrices({ holdings, wines, acquisitions, allocations, householdId, sourceSha256 }) {
  const household = canonicalUuid(householdId)
  if (!/^[0-9a-f]{64}$/u.test(sourceSha256)) throw new Error("Invalid source SHA-256")
  const sourceWines = new Set(wines.map((wine) => canonicalUuid(wine.id)))
  const seen = new Set()
  const rows = []
  const blockers = []

  if (acquisitions !== 0 || allocations !== 0) {
    blockers.push({ reason: "Acquisition tables are not empty; review their independent source semantics" })
  }

  for (const holding of holdings) {
    let sourceHoldingId = null
    try {
      sourceHoldingId = canonicalUuid(holding.id)
      if (seen.has(sourceHoldingId)) throw new Error("Duplicate source holding ID")
      seen.add(sourceHoldingId)
      const wineId = canonicalUuid(holding.wine_id)
      if (!sourceWines.has(wineId)) throw new Error("Source wine does not exist")
      if (!Number.isSafeInteger(holding.quantity) || holding.quantity < 0 || holding.quantity > 2147483647) {
        throw new Error("Invalid source holding quantity")
      }
      if (!STATES.has(holding.state)) throw new Error("Unsupported source holding state")
      if (holding.location !== null && holding.location !== undefined
          && (typeof holding.location !== "string" || holding.location.length > 120 || holding.location.includes("\0"))) {
        throw new Error("Invalid source location")
      }
      const price = sourcePrice(holding.price_bought)
      const acquiredOn = sourceDate(holding.acquired_date)
      if (price === null && acquiredOn === null) continue
      rows.push({
        source_holding_id: sourceHoldingId,
        wine_id: wineId,
        price_bought: price,
        acquired_on: acquiredOn,
        source_quantity: holding.quantity,
        source_state: holding.state,
        source_cellar_id: optionalUuid(holding.cellar_id),
        source_location: holding.location ?? null,
      })
    } catch (error) {
      blockers.push({ source_holding_id: sourceHoldingId, reason: error.message })
    }
  }

  rows.sort((left, right) => left.source_holding_id.localeCompare(right.source_holding_id))
  const report = {
    source_holding_count: holdings.length,
    source_acquisition_count: acquisitions,
    source_allocation_count: allocations,
    price_rows: rows.filter((row) => row.price_bought !== null).length,
    date_rows: rows.filter((row) => row.acquired_on !== null).length,
    source_noncurrent_rows: rows.filter((row) => row.source_state !== "in_cellar").length,
    evidence_rows: rows.length,
    blockers,
  }
  return {
    household_id: household,
    source_sha256: sourceSha256,
    rows,
    report,
    plan_sha256: sha256(JSON.stringify({ household, sourceSha256, rows, report })),
  }
}

export async function buildLegacyPricesPlan({ sourceDb, expectedSourceSha256, householdId }) {
  const actualSha256 = await sha256File(sourceDb)
  if (actualSha256 !== expectedSourceSha256) throw new Error("v0.1 source database SHA-256 mismatch")
  const db = new DatabaseSync(sourceDb, { readOnly: true })
  try {
    return normalizeLegacyHoldingPrices({
      holdings: db.prepare("select id, wine_id, cellar_id, location, quantity, state, price_bought, acquired_date from holdings order by id").all(),
      wines: db.prepare("select id from wines").all(),
      acquisitions: db.prepare("select count(*) as count from acquisitions").get().count,
      allocations: db.prepare("select count(*) as count from acquisition_allocations").get().count,
      householdId,
      sourceSha256: actualSha256,
    })
  } finally {
    db.close()
  }
}

function literal(value) {
  return value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`
}

export function renderLegacyPricesSql({ plan, importedBy, mode, expectedPreviewFingerprint = null }) {
  if (!["preview", "rehearsal", "apply"].includes(mode)) throw new Error("Invalid mode")
  if (plan.report.blockers.length) throw new Error("Blocked source plan")
  if (mode !== "preview" && !/^[0-9a-f]{32}$/u.test(expectedPreviewFingerprint ?? "")) {
    throw new Error("A reviewed SQL preview fingerprint is required")
  }
  const owner = canonicalUuid(importedBy)
  const household = plan.household_id
  const sourceHash = plan.source_sha256
  const tuples = plan.rows.map((row) => `(${[
    row.source_holding_id, row.wine_id, row.price_bought, row.acquired_on,
    row.source_quantity, row.source_state, row.source_cellar_id, row.source_location,
  ].map(literal).join(", ")})`).join(",\n")
  const load = tuples ? `insert into _legacy_prices_source values\n${tuples};` : ""
  const same = `target.wine_id = source.wine_id
    and target.price_bought is not distinct from source.price_bought
    and target.acquired_on is not distinct from source.acquired_on
    and target.source_quantity = source.source_quantity
    and target.source_state = source.source_state
    and target.source_cellar_id is not distinct from source.source_cellar_id
    and target.source_location is not distinct from source.source_location`
  const apply = mode === "preview" ? "" : `
do $guard$
declare
  review record;
  old_wines bigint;
  old_holdings bigint;
  old_bottles bigint;
  old_operations bigint;
  inserted_count bigint;
begin
  select * into review from _legacy_prices_review;
  if review.missing_wines <> 0 or review.conflicts <> 0 or review.extra_rows <> 0
      or review.preview_fingerprint <> '${expectedPreviewFingerprint}' then
    raise exception 'Legacy price preview has changed or contains missing/conflicting wines';
  end if;
  if not exists (select 1 from public.household_members
      where household_id = '${household}' and user_id = '${owner}' and role = 'owner') then
    raise exception 'Importer must be the household Owner';
  end if;
  select count(*) into old_wines from public.wines
    where household_id = '${household}';
  select count(*), coalesce(sum(quantity), 0) into old_holdings, old_bottles
    from public.holdings where household_id = '${household}';
  select count(*) into old_operations from public.inventory_operations
    where household_id = '${household}';

  insert into public.legacy_holding_prices (
    household_id, source_sha256, source_holding_id, wine_id, price_bought,
    acquired_on, source_quantity, source_state, source_cellar_id,
    source_location, imported_by
  ) select '${household}', '${sourceHash}', source.source_holding_id,
      source.wine_id, source.price_bought, source.acquired_on,
      source.source_quantity, source.source_state, source.source_cellar_id,
      source.source_location, '${owner}'
    from _legacy_prices_source source
    where not exists (select 1 from public.legacy_holding_prices target
      where target.household_id = '${household}'
        and target.source_sha256 = '${sourceHash}'
        and target.source_holding_id = source.source_holding_id);
  get diagnostics inserted_count = row_count;
  if inserted_count <> review.new_rows then
    raise exception 'Legacy price insertion count changed';
  end if;
  if exists (select 1 from _legacy_prices_source source
      left join public.legacy_holding_prices target
        on target.household_id = '${household}'
       and target.source_sha256 = '${sourceHash}'
       and target.source_holding_id = source.source_holding_id
      where target.source_holding_id is null or not (${same})) then
    raise exception 'Legacy price target does not match reviewed source';
  end if;
  if (select count(*) from public.wines where household_id = '${household}') <> old_wines
      or (select count(*) from public.holdings where household_id = '${household}') <> old_holdings
      or (select coalesce(sum(quantity), 0) from public.holdings where household_id = '${household}') <> old_bottles
      or (select count(*) from public.inventory_operations where household_id = '${household}') <> old_operations then
    raise exception 'Legacy price import changed inventory';
  end if;
end;
$guard$;`
  return `-- Private v0.1 source evidence. No purchase event, currency, or acquired quantity is inferred.
begin;
set local standard_conforming_strings = on;
select pg_advisory_xact_lock(hashtextextended('${household}:legacy-prices', 0));
create temporary table _legacy_prices_source (
  source_holding_id uuid primary key, wine_id uuid not null,
  price_bought numeric(12, 2), acquired_on date,
  source_quantity integer not null, source_state text not null,
  source_cellar_id uuid, source_location text
) on commit drop;
${load}
create temporary table _legacy_prices_review on commit drop as
select count(*)::bigint as source_rows,
  count(*) filter (where wine.id is null)::bigint as missing_wines,
  count(*) filter (where target.source_holding_id is null)::bigint as new_rows,
  count(*) filter (where target.source_holding_id is not null and (${same}))::bigint as identical_rows,
  count(*) filter (where target.source_holding_id is not null and not (${same}))::bigint as conflicts,
  (select count(*) from public.legacy_holding_prices extra
    where extra.household_id = '${household}' and extra.source_sha256 = '${sourceHash}'
      and not exists (select 1 from _legacy_prices_source expected
        where expected.source_holding_id = extra.source_holding_id))::bigint as extra_rows,
  md5('${plan.plan_sha256}' || coalesce(jsonb_agg(
    jsonb_build_array(source.source_holding_id::text,
      to_jsonb(target) - 'imported_at' - 'imported_by')
    order by source.source_holding_id)::text, '[]')) as preview_fingerprint
from _legacy_prices_source source
left join public.wines wine on wine.id = source.wine_id
  and wine.household_id = '${household}' and wine.merged_into_wine_id is null
left join public.legacy_holding_prices target
  on target.household_id = '${household}'
  and target.source_sha256 = '${sourceHash}'
  and target.source_holding_id = source.source_holding_id;
select jsonb_build_object(
  'source_rows', source_rows, 'missing_wines', missing_wines,
  'new_rows', new_rows, 'existing_identical', identical_rows,
  'conflicts', conflicts, 'extra_rows', extra_rows,
  'preview_fingerprint', preview_fingerprint
) as legacy_price_preview from _legacy_prices_review;${apply}
${mode === "apply" ? "commit;" : "rollback;"}
`
}
