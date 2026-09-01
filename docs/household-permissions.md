# Household owner and member permissions

Roadmap step 0.5.1 fixes the collaboration contract before invitations or
membership-management operations are introduced. PostgreSQL membership remains
the authority. Browser checks improve the interface, but they never replace
RLS and security-definer RPC checks.

## Roles

Every membership has exactly one of two roles:

- an **owner** administers shared household state and is responsible for
  decisions that affect every member;
- a **member** participates in normal cellar use without administering the
  household.

An owner is also a member for all read and daily-use purposes. Trusted shared
knowledge curators are a separate, service-granted role: household ownership
does not grant curator or publication authority.

## Capability matrix

| Capability | Owner | Member |
|---|:---:|:---:|
| Read the household cellar, catalog, activity, advice, and fellow memberships | Yes | Yes |
| ADD, MOVE, and REMOVE bottles, including creating a wine during normal ADD | Yes | Yes |
| Register and later manage the member's own devices | Yes | Yes |
| Record and edit the member's own notes, feedback, pairing preferences, and private timing preference | Yes | Yes |
| Report a possible problem in published shared knowledge | Yes | Yes |
| Export readable household data | Yes | Yes |
| Run a bulk spreadsheet import | Yes | No |
| Edit or merge shared catalog entries and reviewed wine facts | Yes | No |
| Create, rename, order, archive, or restore cellars and locations | Yes | No |
| Set or clear household-wide maturity and serving overrides | Yes | No |
| Request/review household research and decide reference matches | Yes | No |
| Invite, change, revoke, or transfer members | Yes | No |
| Manage every household device | Yes | No |

Creating a wine through ADD is intentionally available to a member: adding a
newly purchased bottle is normal cellar work. Editing existing shared metadata,
merging rows, and importing many catalog rows are administrative actions and
therefore remain owner-only.

## Enforcement

`household_members.role` is synchronized for offline presentation. The public
`get_household_permissions` RPC exposes the same typed online contract while
private role helpers give subsequent membership RPCs one canonical check.

Direct browser writes to households, memberships, devices, wines, cellars,
locations, holdings, and inventory journals remain denied. Daily inventory
continues through registered-device operation RPCs. Owner-only RPCs check the
role again on the server; knowing an object ID or manually calling an endpoint
cannot promote a member.

Account-private preferences remain private. Household-visible observations may
be read by fellow members, but only their author may edit or delete them.
Household-wide manual maturity and serving guidance is visibly distinct from
both private preferences and the immutable canonical shared library.

## Membership management RPCs

Step 0.5.2 exposes three authenticated, server-authorized operations:

- `get_household_members` lets any current member list current collaborators.
  It returns membership identity, role, join time, email, and an optional
  conventional display name; raw authentication metadata is never exposed.
- `update_household_member_role` lets an owner promote or demote another
  membership. Repeating the current role is idempotent.
- `revoke_household_member` lets an owner revoke another membership. It does
  not double as a leave or ownership-transfer operation.

Role changes and revocations serialize per household and produce a private
audit event with the actor, target, and before/after roles. Browser roles still
have no direct `UPDATE` or `DELETE` privilege on `household_members`, and an
unrelated account cannot enumerate a household by guessing its UUID.

Revocation removes the membership row immediately. Registered devices are
marked revoked rather than deleted because accepted inventory operations keep
an immutable reference to them. A revoked device cannot authorize new journal
rows or be silently reactivated if the account later rejoins. Personal pairing
preferences and personal household observations are deleted; household-visible
observations, shared serving guidance, and inventory history remain attributed
and intact.

There is deliberately no member-management screen yet. These RPCs are the
trusted foundation used by the invitation and member-management workflows in
later steps.

## Durable invitations

Step 0.5.3 gives invitations their own private lifecycle instead of treating an
authentication email as the invitation itself. Each attempt records the
household, normalized recipient email, least-privileged `member` role,
inviting owner, deadline, and terminal outcome. A recipient may have only one
pending invitation per household, while accepted, expired, revoked, and
superseded attempts remain as durable history.

Invitation links are bearer credentials. CellarManager never stores their raw
secret: the private record contains only a SHA-256 digest used for token lookup
by the later acceptance workflow. The record is not public,
is not synchronized through PowerSync, and grants no direct browser table
access. Its maximum validity is 30 days; the workflow will use a shorter
default and may replace an attempt with a new token without rewriting the old
record.

The database enforces an append-mostly lifecycle. Only a current owner can
create, revoke, or supersede an invitation. Acceptance must occur before the
deadline, by an authenticated account whose normalized email matches the
recipient, and alongside the exact new household membership. A pending record
can make one terminal transition and can never be revived or edited into a
different recipient, household, deadline, role, or token.

This step intentionally exposes no invitation RPC or interface. Step 0.5.4
adds the narrow invite, list, accept, reissue, and revoke operations on top of
this model and is responsible for delivering or sharing the one-time raw link.

## Later v0.5 steps

Step 0.5.2 creates safe management mutations, and step 0.5.3 defines durable
invitation state without yet creating memberships. Steps 0.5.4 through 0.5.7
add the invitation workflow, switching, member UI, and direct device
management on top of this contract. Ownership transfer and leaving are handled
explicitly in 0.5.10 so no intermediate implementation can orphan a household.
The full adversarial matrix remains the 0.5.11 release-hardening step.
