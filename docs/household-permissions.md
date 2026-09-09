# Household owner and member permissions

Roadmap step 0.5.1 introduced the collaboration contract; user validation in
0.5.4 refined Members to read-only shared-cellar access. PostgreSQL membership remains
the authority. Browser checks improve the interface, but they never replace
RLS and security-definer RPC checks.

## Roles

Every membership has exactly one of two roles:

- an **owner** administers shared household state and is responsible for
  decisions that affect every member;
- a **member** browses the shared cellar and uses advice, while retaining their
  own notes and preferences. Members cannot change stock or other shared data.

An owner is also a member for all read and daily-use purposes. Trusted shared
knowledge curators are a separate, service-granted role: household ownership
does not grant curator or publication authority.

## Capability matrix

| Capability | Owner | Member |
|---|:---:|:---:|
| Read the household cellar, catalog, activity, advice, and fellow memberships | Yes | Yes |
| ADD, MOVE, and REMOVE bottles, including creating a wine during normal ADD | Yes | No |
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

All stock changes are Owner-only, including creating a wine through ADD.
Multiple Owners can manage a shared cellar; the Member role is a reader, not
a co-manager.

## Enforcement

`household_members.role` is synchronized for offline presentation. The public
`get_household_permissions` RPC exposes the same typed online contract while
private role helpers give subsequent membership RPCs one canonical check.

Direct browser writes to households, memberships, devices, wines, cellars,
locations, holdings, and inventory journals remain denied. Daily inventory
continues through Owner-only registered-device operation RPCs. These RPCs check the
role again on the server; knowing an object ID or manually calling an endpoint
cannot promote a member.

Members see one **Cellar** browser instead of separate Inventory and Catalog
menus. It shows in-stock wines, quantities, locations, and drinking advice;
an option includes wines with no bottles. `/` and `/catalog` resolve to
`/cellar` for Members, including refresh and Back/Forward. Wine detail links
remain readable, with no shared editing, reference matching, or stock controls.
Private timing preferences, authored observations, and issue reports remain.

The Member interface keeps Data available for export, but never mounts the
import workspace or restores a pending owner import. Cellar setup is hidden
from Member navigation, and direct links render an owner-only explanation
without mounting edit forms. These boundaries are recomputed for the active
household's role, including account/household switches and synchronized role
changes. Server permission checks remain the authority for in-flight requests.

The offline operation queue checks the synchronized role before inserting a
write. Stock RPCs recheck current Owner membership under the same household
lock as role changes, including the legacy ADD overload. A demoted Owner's
previously queued operation cannot change stock: upload remains blocked with
an explicit permission error and is not silently discarded or transferred to
another user. The fuller rejected-operation recovery interface is step 0.5.9.
The Member browser uses synchronized stock, not those unaccepted pending writes.

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

## Invitation workflow

Step 0.5.4 exposes narrow create, list, preview, accept, reissue, and revoke
RPCs on top of the durable model. An owner creates a seven-day invitation for
one normalized email and receives the raw bearer token once. CellarManager
offers two equal sharing actions: send the invitation by email from the trusted
Cloudflare Worker, or copy its private link for any messaging app. The Worker
uses Gmail SMTP with its own App Password; Supabase still sends account
confirmation/password-reset emails through its separate custom SMTP settings.
If the private link is lost, the owner creates a
replacement; the previous attempt becomes `superseded` and cannot be accepted.
An owner may also cancel an unexpired pending invitation. The system rejects an
invitation when its email already belongs to a member of the same household.

The private link uses `/invite#token=...`. Browser fragments are not included
in normal HTTP requests, server access logs, referrers, or Cloudflare routing.
The browser stores the token locally while signup confirmation is pending and
removes it from the visible address immediately. A recipient returning from
the authentication email can therefore resume on the same browser. If the
email is opened on another device, the recipient reopens the original private
invitation link.

The browser bootstrap upgrades public HTTP navigation to HTTPS before loading
the app, Supabase, or PowerSync; only local loopback development may use HTTP.
It keeps the full path, query, and browser-held invitation fragment. Copied and
emailed invitation links and authentication redirects use HTTPS for non-loopback
origins. This also handles Wrangler's tunnel proxy, which can expose HTTP inside
the Worker even for HTTPS visitors and rewrite redirect response headers back
to HTTP. Do not disable secure-context authentication safeguards or trust
client-supplied forwarding headers to construct invitation links.

Preview validation must use the same HTTPS origin when returning from signup.
The hosted Auth redirect allowlist must explicitly allow that test origin;
otherwise confirmation may land on production, where the preview's browser
storage is unavailable. In that case, confirm the account and reopen the
original private invitation on the preview to sign in and join. Never put the
invitation token in an authentication redirect query, or allow all third-party
preview hosts as authentication redirect targets.

Before authentication, a valid private link returns the household name,
requested Member role, expiry, effective status, normalized recipient address,
and whether that recipient already has an account. The browser uses those facts
only to prefill authentication and start existing recipients at sign-in or new
recipients at account creation: neither is placed in the URL or stored
separately from the bearer invitation. Acceptance requires
the exact normalized authentication email, creates only a Member membership,
is atomic and idempotent, and writes an attributed private audit event. A wrong
account, expired link, cancelled link, replaced link, or malformed token cannot
create access.

The owner invitation screen shows durable status and deadlines but never a
stored secret. It deliberately does not list or modify current memberships;
the complete member-management interface remains step 0.5.6.

### Invitation email delivery

`POST /api/household-invitations/email` requires a same-origin request and a
Supabase-verified session. Its service-only claim RPC checks current ownership,
the invitation token digest, and a live pending invitation. The recipient and
household name are read from the database; the browser cannot supply an email
body, recipient override, or redirect URL. Links use the request's own origin,
so a test tunnel sends test links and production sends production links.

Delivery attempts are private and distinct from invitation acceptance. Limits
are one attempt per recipient per minute, 20 per household per hour, and 50
overall per hour, including failures. An atomic database lock enforces these
across Worker instances and replacement links. No background resend occurs.
“Email sent” means SMTP accepted the message, not that it reached the inbox.
Timeouts and interrupted attempts are shown as unconfirmed, including stale
`sending` attempts after two minutes. Owners can still copy the same valid
link. Replacing an invitation disables the earlier link.

Deployment needs `SMTP_USER` (configured in `wrangler.jsonc`) and the Worker
secret `SMTP_PASSWORD`, plus existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
Never put the App Password in client environment variables or version control.
Apply `20260907120000_household_invitation_email.sql` before enabling the new UI.
For local development `.dev.vars` is ignored; protect it and remove it after use.
Gmail is a low-volume starting transport, not a bulk-mail provider. Review the
delivery budget/provider as adoption grows. Synthetic tests must not send to
real recipients; SMTP authentication can be checked with `verify()` without
sending mail.

Before production rollout, apply the invitation migrations and
`20260908100000_read_only_household_members.sql`, then verify the configured
Worker has all three required secrets. Supabase Auth's custom SMTP settings do
not automatically configure the Worker's separate invitation-email transport.

For preview validation, always share the HTTPS tunnel URL. A temporary tunnel
can expire before an invitation does; issue a replacement link from the new
preview instead of reusing an expired hostname. The Auth confirmation allowlist
can still send a new user to the production application. After confirming the
email, reopen the original live preview invitation to explicitly join there.
Do not allow every `trycloudflare.com` hostname as an Auth redirect.

## Later v0.5 steps

Steps 0.5.2 through 0.5.4 create safe membership mutations, durable invitation
state, and the invitation workflow. Steps 0.5.5 through 0.5.7 add switching,
the complete member UI, and direct device management on top of this contract.
Ownership transfer and leaving are handled
explicitly in 0.5.10 so no intermediate implementation can orphan a household.
The full adversarial matrix remains the 0.5.11 release-hardening step.
