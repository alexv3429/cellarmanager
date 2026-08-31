# Shared profile revision governance

Roadmap step 0.4.18 turns a documented shared-profile report into a controlled
revision without editing published history. It adds explicit curator
eligibility, structured before/after proposals, attributable decisions,
disagreement handling, immutable supersession, and service-owned publication.

The durable flow is:

`private reports -> shared review case -> curator proposal -> explicit decision -> trusted publisher -> new immutable library version`

The currently active profile stays active until the final publication succeeds.
A proposal, an approval, or a report never mutates it in place.

## Curator eligibility

Shared-library authority is an explicit, scoped grant. Each eligibility row
records the account, visible curator name, allowed profile types, status,
rationale, granting operator, and grant date. Only the service role can grant,
suspend, or revoke eligibility. Account age, cellar size, report count, and a
popularity vote never confer authority.

The 0.4.18 migration performs one bounded bootstrap: an account that had already
accepted or edited at least three profile drafts later published through the
trusted boundary becomes a founding curator for the supported maturity profile
types. This is migration evidence, not an ongoing automatic promotion rule.
Future grants remain deliberate service operations.

An active curator sees only cases within the granted profile scopes. A normal
account receives no curator interface or case data.

## Privacy boundary

The curator inbox aggregates the documented concern and optional HTTPS links
needed to evaluate shared knowledge. It deliberately omits reporter account,
household, wine, location, holding, and bottle identifiers. Curators see the
number of distinct reporters but not who they are. Reporter-facing private
threads remain governed by the 0.4.17 boundary.

## Proposal and decision rules

A curator proposal contains a complete normalized copy of the reviewed profile,
but only reviewed maturity and structure fields may change. Canonical producer,
place, product, release, color, vintage, and era identity fields are immutable
inside this workflow. The database independently enforces:

- evidence strength between 0 and 1 and a non-empty rationale;
- ordered absolute place ages from 0 to 100 years;
- absolute place structure values from 0 to 5;
- integer maturity adjustments from -5 to +10 years;
- structure adjustments from -2 to +2;
- a complete field set and at least one actual change;
- one to twelve HTTPS proposal links.

Submitting a replacement supersedes the earlier open or disputed proposal; it
does not delete it. An approved proposal cannot be silently replaced.

Decisions are append-only and attributable. A decision must explicitly approve
or disagree and include a rationale. The latest decision from each curator is
used for the live state. Any active disagreement blocks publication. At least
one conflict-free approval by an eligible curator is required. This is a
validation workflow, not a majority vote.

A curator may instead close a case with no profile change and a documented
resolution. An already approved correction must first be disputed or published;
it cannot be dismissed around the publication boundary.

## Source and evidence semantics

Proposal and decision URLs are immutable audit pointers. They let a reviewer and
operator reproduce why a value was proposed or challenged. They do not
automatically become reviewed `enrichment_evidence`, because an arbitrary URL
has not necessarily passed CellarManager's source-access, retention, attribution,
and cross-household rights policy.

The cloned profile retains the predecessor's reviewed evidence links. A new URL
can become canonical profile evidence only through the reviewed research/source
policy workflow. This prevents a trusted curator action from bypassing source
governance while still preserving every cited URL in the revision audit.

## Immutable publication

The scheduled Cloudflare Worker calls the service-only revision publisher even
when AI research is unavailable. For each approved revision, the publisher:

1. rechecks current curator eligibility and all latest decisions;
2. resolves the stable canonical subject in the active library;
3. rejects the proposal if that active profile changed since it was proposed;
4. validates every proposed value again;
5. clones the complete active knowledge version;
6. applies the approved values only to the copied target profile;
7. atomically publishes the clone and supersedes the former version;
8. resolves the shared case, notifies every private reporter subscription, and
   appends the publication audit event.

Published and superseded revisions, decisions, and governance events cannot be
updated or deleted. The curator interface retains the red/green comparison,
decisions, cited URLs, prior profile snapshot, published replacement, library
version, and chronological audit trail.

## Failure behavior

If eligibility has changed, a disagreement exists, the subject disappeared, the
active profile no longer matches the proposal's predecessor, validation fails,
or immutable publication cannot complete, no knowledge version is activated.
The revision becomes disputed with a visible error result for a later curator
replacement. The previously active library remains authoritative.

## Validation

Database acceptance uses two curators and two anonymous reporters. It proves
scoped access, identity-field rejection, unchanged active content before
publication, approval followed by a blocking disagreement, supersession by a
replacement, service-owned immutable publication, reporter notification,
before/after history, and append-only decisions and events. Web tests cover the
strict RPC parser and mutation boundaries; Worker tests prove approved revisions
are published even when web research AI is not configured.
