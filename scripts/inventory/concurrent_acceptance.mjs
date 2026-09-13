import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createLocalDatabase } from "./local_database.mjs"

assert.equal(process.argv.length, 2, "Inventory acceptance takes no arguments or database targets")
const db = await createLocalDatabase()
const quote = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`
const timestamp = "2026-09-01T12:00:00Z"
let passed = 0

async function fixture(a = 1, b = 0) {
  const f = Object.fromEntries(["household", "wine", "cellar", "a", "b"].map((key) => [key, randomUUID()]))
  const owner = randomUUID()
  const otherOwner = randomUUID()
  const member = randomUUID()
  f.actors = [owner, owner, otherOwner, member].map((user) => ({ user, device: randomUUID() }))
  await db.query(`BEGIN;
    INSERT INTO auth.users(id, email) VALUES
      ('${owner}', '${owner}@example.test'), ('${otherOwner}', '${otherOwner}@example.test'),
      ('${member}', '${member}@example.test');
    INSERT INTO public.households(id, name) VALUES ('${f.household}', 'Synthetic concurrency acceptance');
    INSERT INTO public.household_members(household_id, user_id, role) VALUES
      ('${f.household}', '${owner}', 'owner'), ('${f.household}', '${otherOwner}', 'owner'),
      ('${f.household}', '${member}', 'member');
    INSERT INTO public.devices(id, household_id, user_id, name) VALUES
      ${f.actors.map((actor, i) => `('${actor.device}', '${f.household}', '${actor.user}', 'Synthetic device ${i}')`).join(",")};
    INSERT INTO public.wines(id, household_id, producer, cuvee, vintage, color)
      VALUES ('${f.wine}', '${f.household}', 'Synthetic Domaine', 'Concurrency', 2020, 'red');
    INSERT INTO public.cellars(id, household_id, name) VALUES ('${f.cellar}', '${f.household}', 'Synthetic cellar');
    INSERT INTO public.locations(id, household_id, cellar_id, code) VALUES
      ('${f.a}', '${f.household}', '${f.cellar}', 'A'), ('${f.b}', '${f.household}', '${f.cellar}', 'B');
    ${[[f.a, a], [f.b, b]].filter(([, quantity]) => quantity > 0).map(([location, quantity]) => `
      INSERT INTO public.holdings(household_id, wine_id, location_id, quantity)
      VALUES ('${f.household}', '${f.wine}', '${location}', ${quantity});`).join("\n")}
    COMMIT;`)
  return f
}

function asUser(actor, sql) {
  return `BEGIN; SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '${actor.user}'; ${sql} COMMIT;`
}

function operation(f, actorIndex, type, options = {}) {
  const actor = f.actors[actorIndex]
  const id = options.id ?? randomUUID()
  const args = [id, f.household, actor.device, type, f.wine,
    type === "ADD" ? null : options.source ?? f.a,
    type === "REMOVE" ? null : options.destination ?? f.b,
    options.quantity ?? 1, timestamp, type === "REMOVE" ? "DRANK" : null]
  const request = { id, household_id: f.household, user_id: actor.user, device_id: actor.device, operation_type: type,
    wine_id: f.wine, source_location_id: args[5], destination_location_id: args[6], quantity: args[7], created_at_client: timestamp, remove_reason: args[9] }
  return { id, request, sql: asUser(actor, `SELECT json_build_object('pid', pg_backend_pid(), 'receipt', row_to_json(r))
    FROM public.apply_inventory_operation(${args.map(quote).join(",")}) r;`) }
}

function newWine(f, actorIndex, quantity) {
  const actor = f.actors[actorIndex]
  const id = randomUUID()
  const args = [id, f.household, actor.device, randomUUID(), "Synthetic New Domaine", "Shared identity", 2021,
    "red", "Morgon", "Beaujolais", 750, f.a, quantity, timestamp]
  const request = { id, household_id: f.household, user_id: actor.user, device_id: actor.device, operation_type: "ADD",
    wine_id: args[3], source_location_id: null, destination_location_id: f.a, quantity, created_at_client: timestamp, remove_reason: null,
    wine_producer: args[4], wine_cuvee: args[5], wine_vintage: args[6], wine_color: args[7], wine_appellation: args[8], wine_area: args[9], wine_format_ml: args[10] }
  return { id, request, sql: asUser(actor, `SELECT json_build_object('pid', pg_backend_pid(), 'receipt', row_to_json(r))
    FROM public.apply_add_inventory_operation(${args.map(quote).join(",")}) r;`) }
}

async function race(f, operations) {
  return db.concurrently(f.household, operations.map((op) => op.sql))
}

function receipts(results) {
  const values = results.map((result) => {
    assert.equal(result.status, "fulfilled", result.reason?.message)
    return JSON.parse(result.value)
  })
  assert.equal(new Set(values.map((value) => value.pid)).size, values.length,
    "Every contender must run in a different PostgreSQL backend")
  return values.map((value) => value.receipt)
}

async function stock(f, a, b, count) {
  const result = JSON.parse(await db.query(`SELECT json_build_object(
    'a', coalesce((SELECT quantity FROM public.holdings WHERE wine_id = '${f.wine}' AND location_id = '${f.a}'), 0),
    'b', coalesce((SELECT quantity FROM public.holdings WHERE wine_id = '${f.wine}' AND location_id = '${f.b}'), 0),
    'operations', (SELECT count(*) FROM public.inventory_operations WHERE household_id = '${f.household}'),
    'negative', (SELECT count(*) FROM public.holdings WHERE quantity < 0));`))
  assert.deepEqual(result, { a, b, operations: count, negative: 0 })
}

async function assertConvergedReads(f) {
  const sql = `SELECT json_build_object(
    'holdings', (SELECT json_agg(h ORDER BY h.id) FROM public.holdings h WHERE household_id = '${f.household}'),
    'operations', (SELECT json_agg(o ORDER BY o.id) FROM public.inventory_operations o WHERE household_id = '${f.household}'));`
  const views = await Promise.all([0, 2, 3].map((index) => db.query(asUser(f.actors[index], sql))))
  assert.equal(views[0], views[1], "Both Owners read the same committed stock and terminal journal")
  assert.equal(views[0], views[2], "The read-only Member sees the same committed result")
  return views[0]
}

async function check(name, run) {
  await run()
  console.log(`PASS ${++passed}: ${name}`)
}

const interrupt = () => { void db.close().finally(() => process.exit(130)) }
process.once("SIGINT", interrupt)
process.once("SIGTERM", interrupt)
try {
  for (const type of ["MOVE", "new-wine ADD"]) {
    for (const stopFirst of [true, false]) {
      await check(`stop serializes with ${type} (${stopFirst ? "stop" : "upload"} first)`, async () => {
        const f = await fixture(2)
        const op = type === "MOVE" ? operation(f, 0, "MOVE") : newWine(f, 0, 1)
        const stop = { sql: asUser(f.actors[0], `SELECT json_build_object('pid', pg_backend_pid(), 'receipt',
          public.stop_inventory_upload('${op.id}', ${quote(JSON.stringify(op.request))}::jsonb));`) }
        const results = receipts(await race(f, stopFirst ? [stop, op] : [op, stop]))
        const upload = results[stopFirst ? 1 : 0], stopped = results[stopFirst ? 0 : 1]
        assert.equal(stopped.status, stopFirst ? "STOPPED" : "ACCEPTED")
        assert.equal(upload.operation_status, stopFirst ? "REJECTED" : "ACCEPTED")
        assert.equal(upload.operation_error_code, stopFirst ? "USER_CANCELLED" : null)
        const snapshot = JSON.parse(await db.query(`SELECT json_build_object(
          'journal', (SELECT count(*) FROM public.inventory_operations WHERE household_id = '${f.household}'),
          'stopped', (SELECT count(*) FROM private.stopped_inventory_uploads WHERE household_id = '${f.household}'),
          'wines', (SELECT count(*) FROM public.wines WHERE household_id = '${f.household}'),
          'bottles', (SELECT sum(quantity) FROM public.holdings WHERE household_id = '${f.household}'));`))
        assert.deepEqual(snapshot, { journal: stopFirst ? 0 : 1, stopped: stopFirst ? 1 : 0,
          wines: !stopFirst && type === "new-wine ADD" ? 2 : 1, bottles: !stopFirst && type === "new-wine ADD" ? 3 : 2 })
        if (type === "MOVE") await stock(f, stopFirst ? 2 : 1, stopFirst ? 0 : 1, stopFirst ? 0 : 1)
        const beforeRetry = await assertConvergedReads(f)
        assert.deepEqual(JSON.parse(await db.query(op.sql)).receipt, upload)
        assert.deepEqual(JSON.parse(await db.query(stop.sql)).receipt, stopped)
        assert.equal(await assertConvergedReads(f), beforeRetry, "Repeated stop/upload never rewrites accepted history or stock")
      })
    }
  }
  for (const reversed of [false, true]) {
    await check(`two offline devices remove the last bottle (${reversed ? "phone" : "desktop"} reconnects first)`, async () => {
      const f = await fixture()
      const ops = [operation(f, 0, "REMOVE"), operation(f, 1, "REMOVE")]
      if (reversed) ops.reverse()
      const result = receipts(await race(f, ops))
      assert.deepEqual(result.map((r) => r.operation_status), ["ACCEPTED", "REJECTED"])
      assert.equal(result[1].operation_error_code, "INSUFFICIENT_STOCK")
      await stock(f, 0, 0, 2)
      const beforeRetry = await assertConvergedReads(f)
      assert.deepEqual(receipts(await race(f, ops)), result, "Both accepted and rejected receipts replay unchanged")
      assert.equal(await assertConvergedReads(f), beforeRetry, "Retries do not change holdings, revisions or journal")
    })
  }

  for (const removeFirst of [false, true]) {
    await check(`two Owners compete to MOVE / REMOVE the last bottle (${removeFirst ? "REMOVE" : "MOVE"} first)`, async () => {
      const f = await fixture()
      const ops = [operation(f, 0, "MOVE"), operation(f, 2, "REMOVE")]
      if (removeFirst) ops.reverse()
      const result = receipts(await race(f, ops))
      assert.deepEqual(result.map((r) => r.operation_status), ["ACCEPTED", "REJECTED"])
      assert.equal(result[1].operation_error_code, "INSUFFICIENT_STOCK")
      await stock(f, 0, removeFirst ? 0 : 1, 2)
      await assertConvergedReads(f)
    })
  }

  await check("simultaneous ADD to a missing position preserves both increments", async () => {
    const f = await fixture(0)
    const result = receipts(await race(f, [operation(f, 0, "ADD", { quantity: 2 }), operation(f, 2, "ADD", { quantity: 3 })]))
    assert.ok(result.every((r) => r.operation_status === "ACCEPTED"))
    await stock(f, 0, 5, 2)
    await assertConvergedReads(f)
  })

  await check("opposing moves finish without deadlock or lost bottles", async () => {
    const f = await fixture(1, 1)
    const result = receipts(await race(f, [operation(f, 0, "MOVE"), operation(f, 2, "MOVE", { source: f.b, destination: f.a })]))
    assert.ok(result.every((r) => r.operation_status === "ACCEPTED"))
    await stock(f, 1, 1, 2)
  })

  await check("concurrent duplicate delivery / lost-response retry applies exactly once", async () => {
    const f = await fixture(2)
    const op = operation(f, 0, "MOVE")
    const result = receipts(await race(f, [op, op]))
    assert.deepEqual(result[0], result[1])
    await stock(f, 1, 1, 1)
    const beforeRetry = await assertConvergedReads(f)
    assert.deepEqual(JSON.parse(await db.query(op.sql)).receipt, result[0])
    assert.equal(await assertConvergedReads(f), beforeRetry)
  })

  await check("concurrent UUID reuse cannot change the payload or originating device", async () => {
    for (const mismatch of ["quantity", "device"]) {
      const f = await fixture(3)
      const original = operation(f, 0, "REMOVE")
      const changed = operation(f, mismatch === "device" ? 1 : 0, "REMOVE", {
        id: original.id, quantity: mismatch === "quantity" ? 2 : 1,
      })
      const result = await race(f, [original, changed])
      assert.equal(JSON.parse(result[0].value).receipt.operation_status, "ACCEPTED")
      assert.equal(result[1].status, "rejected")
      assert.match(result[1].reason.message, /22023.*operation_id was reused with a different payload/s)
      await stock(f, 2, 0, 1)
    }
  })

  await check("two devices adding the same new wine reuse one canonical identity", async () => {
    const f = await fixture(0)
    const ops = [newWine(f, 0, 2), newWine(f, 2, 3)]
    assert.ok(receipts(await race(f, ops)).every((r) => r.operation_status === "ACCEPTED"))
    const sql = `SELECT json_build_object(
      'wines', (SELECT count(*) FROM public.wines WHERE household_id = '${f.household}' AND producer = 'Synthetic New Domaine'),
      'bottles', (SELECT sum(quantity) FROM public.holdings WHERE household_id = '${f.household}'),
      'journal', (SELECT count(*) FROM public.inventory_operations WHERE household_id = '${f.household}'),
      'identities', (SELECT count(DISTINCT wine_id) FROM public.inventory_operations WHERE household_id = '${f.household}'));`
    assert.deepEqual(JSON.parse(await db.query(sql)), { wines: 1, bottles: 5, journal: 2, identities: 1 })
    const beforeRetry = await assertConvergedReads(f)
    receipts(await race(f, ops))
    assert.equal(await assertConvergedReads(f), beforeRetry)
    for (const [index, op] of ops.entries()) {
      const result = JSON.parse(await db.query(asUser(f.actors[index === 0 ? 0 : 2],
        `SELECT public.stop_inventory_upload('${op.id}', ${quote(JSON.stringify(op.request))}::jsonb);`)))
      assert.equal(result.status, "ACCEPTED", "Recovery recognizes an ADD resolved to an existing canonical wine")
    }
    assert.equal(await assertConvergedReads(f), beforeRetry)
  })

  for (const revokeFirst of [true, false]) {
    await check(`device revocation serializes with in-flight upload (${revokeFirst ? "revoke" : "upload"} first)`, async () => {
      const f = await fixture(2)
      const op = operation(f, 2, "REMOVE")
      const revoke = { sql: asUser(f.actors[0], `SELECT public.manage_household_device('${f.household}', '${f.actors[2].device}', 'revoke');`) }
      const result = await race(f, revokeFirst ? [revoke, op] : [op, revoke])
      if (revokeFirst) {
        assert.equal(result[0].status, "fulfilled")
        assert.equal(result[1].status, "rejected")
        assert.match(result[1].reason.message, /42501.*Device registration is no longer active/s)
      } else {
        assert.ok(result.every((r) => r.status === "fulfilled"))
        assert.equal(JSON.parse(result[0].value).receipt.operation_status, "ACCEPTED")
      }
      await stock(f, revokeFirst ? 2 : 1, 0, revokeFirst ? 0 : 1)
      if (revokeFirst) await assert.rejects(db.query(op.sql), /Device registration is no longer active/)
      else {
        const beforeRetry = await assertConvergedReads(f)
        assert.equal(JSON.parse(await db.query(op.sql)).receipt.operation_status, "ACCEPTED")
        assert.equal(await assertConvergedReads(f), beforeRetry, "A revoked device can replay a receipt, not a stock effect")
      }
      await assert.rejects(db.query(operation(f, 2, "REMOVE").sql), /Device registration is no longer active/)
      await assertConvergedReads(f)
    })
  }

  await check("a read-only Member cannot race an Owner to mutate inventory", async () => {
    const f = await fixture()
    const result = await race(f, [operation(f, 3, "REMOVE"), operation(f, 0, "REMOVE")])
    assert.equal(result[0].status, "rejected")
    assert.match(result[0].reason.message, /42501.*Household owner permission is required/s)
    assert.equal(JSON.parse(result[1].value).receipt.operation_status, "ACCEPTED")
    await stock(f, 0, 0, 1)
    await assertConvergedReads(f)
  })
  console.log(`${passed} concurrent inventory acceptance scenarios passed.`)
} finally {
  process.removeListener("SIGINT", interrupt)
  process.removeListener("SIGTERM", interrupt)
  await db.close()
}
