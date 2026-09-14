import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createLocalDatabase } from "../inventory/local_database.mjs"

// The existing harness refuses remote Docker engines, copies schema only,
// validates its generated disposable database name, and drops only that DB.
assert.equal(process.argv.length, 2, "Membership acceptance takes no database targets")
const db = await createLocalDatabase()
let passed = 0
const asUser = (user, sql) => `BEGIN; SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = '${user}'; ${sql} COMMIT;`

async function fixture() {
  const f = Object.fromEntries(["household", "owner", "otherOwner", "recipient"].map((key) => [key, randomUUID()]))
  await db.query(`INSERT INTO auth.users(id, email) VALUES
    ('${f.owner}', '${f.owner}@example.test'), ('${f.otherOwner}', '${f.otherOwner}@example.test'),
    ('${f.recipient}', '${f.recipient}@example.test');
    INSERT INTO public.households(id, name) VALUES ('${f.household}', 'Synthetic membership security');
    INSERT INTO public.household_members(household_id, user_id, role) VALUES
    ('${f.household}', '${f.owner}', 'owner'), ('${f.household}', '${f.otherOwner}', 'owner');`)
  f.invitation = JSON.parse(await db.query(asUser(f.owner,
    `SELECT row_to_json(r) FROM public.create_household_invitation('${f.household}', '${f.recipient}@example.test') r;`)))
  f.ownerMembership = await db.query(`SELECT id FROM public.household_members WHERE household_id='${f.household}' AND user_id='${f.owner}';`)
  return f
}
const accept = (f) => asUser(f.recipient,
  `SELECT row_to_json(r) FROM public.accept_household_invitation('${f.invitation.invitation_token}') r;`)
const action = (f, name) => asUser(f.owner,
  `SELECT row_to_json(r) FROM public.${name}_household_invitation('${f.household}', '${f.invitation.invitation_id}') r;`)
async function check(name, run) {
  await run()
  console.log(`PASS ${++passed}: ${name}`)
}
function denied(result, pattern) {
  assert.equal(result.status, "rejected", "The losing request must not change membership/invitation state")
  assert.match(result.reason.message, pattern)
  assert.doesNotMatch(result.reason.message, /deadlock|lock timeout|statement timeout/i)
}
async function outcome(f) {
  return JSON.parse(await db.query(`SELECT json_build_object(
    'status', (SELECT status FROM private.household_invitations WHERE id='${f.invitation.invitation_id}'),
    'members', (SELECT count(*) FROM public.household_members WHERE household_id='${f.household}' AND user_id='${f.recipient}'),
    'accepted_events', (SELECT count(*) FROM private.household_membership_events WHERE invitation_id='${f.invitation.invitation_id}' AND event_type='accepted'));`))
}
const interrupt = () => { void db.close().finally(() => process.exit(130)) }
process.once("SIGINT", interrupt)
process.once("SIGTERM", interrupt)
try {
  for (const name of ["revoke", "reissue"]) {
    for (const acceptFirst of [true, false]) {
      await check(`accept vs ${name}: ${acceptFirst ? "accept" : name} first`, async () => {
        const f = await fixture()
        const results = await db.concurrently(f.household,
          acceptFirst ? [accept(f), action(f, name)] : [action(f, name), accept(f)])
        assert.equal(results[0].status, "fulfilled", results[0].reason?.message)
        denied(results[1], /pending invitation|invalid or no longer available/)
        assert.deepEqual(await outcome(f), { status: acceptFirst ? "accepted" : name === "revoke" ? "revoked" : "superseded",
          members: acceptFirst ? 1 : 0, accepted_events: acceptFirst ? 1 : 0 })
      })
    }
  }
  await check("duplicate acceptance is atomic and idempotent", async () => {
    const f = await fixture()
    const results = await db.concurrently(f.household, [accept(f), accept(f)])
    for (const result of results) assert.equal(result.status, "fulfilled", result.reason?.message)
    assert.equal(JSON.parse(results[0].value).membership_id, JSON.parse(results[1].value).membership_id)
    assert.deepEqual(await outcome(f), { status: "accepted", members: 1, accepted_events: 1 })
  })
  for (const name of ["create", "reissue", "revoke"]) {
    for (const demoteFirst of [true, false]) {
      await check(`demotion vs invitation ${name}: ${demoteFirst ? "demotion" : name} first`, async () => {
        const f = await fixture()
        const demote = asUser(f.otherOwner, `SELECT * FROM public.update_household_member_role('${f.household}', '${f.ownerMembership}', 'member');`)
        const invitationAction = name === "create" ? asUser(f.owner,
          `SELECT * FROM public.create_household_invitation('${f.household}', '${randomUUID()}@example.test');`) : action(f, name)
        const results = await db.concurrently(f.household, demoteFirst ? [demote, invitationAction] : [invitationAction, demote])
        assert.equal(results[0].status, "fulfilled", results[0].reason?.message)
        if (demoteFirst) denied(results[1], /owner/i)
        else assert.equal(results[1].status, "fulfilled", results[1].reason?.message)
        assert.equal(await db.query(`SELECT role FROM public.household_members WHERE id='${f.ownerMembership}';`), "member")
      })
    }
  }
  console.log(`${passed} concurrent membership acceptance scenarios passed.`)
} finally {
  process.removeListener("SIGINT", interrupt)
  process.removeListener("SIGTERM", interrupt)
  await db.close()
}
