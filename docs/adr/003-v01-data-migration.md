# ADR 003: v0.1 data migration

- Status: Accepted (historical)
- Date: 2026-08-03

## Context

The real v0.1 SQLite cellar had to move to the new PostgreSQL model without
changing the private source, losing UUIDs, silently merging wines, or inventing
history. This was a one-time production transition, not a general onboarding
feature.

## Decision

v0.1 SQLite remains the migration source.
Migration is repeatable and supports dry-run.
Counts and quantities are reconciled before acceptance.
The original database is never modified.

## Alternatives considered

- Continuing to run v0.1 would leave two production authorities.
- Direct ad hoc table copies would not provide normalization, dry-run evidence,
  or reconciliation.
- Treating the private archive as a reusable product importer would couple new
  users to one historical schema.

## Consequences

The real production cellar was migrated and reconciled before v0.2.0. The
original private source archive and its recorded hash remain the recovery
evidence for deliberately deferred metadata and history.

After acceptance, the v0.1 runtime and one-off migration implementation were
removed from the active development tree. They remain recoverable from the
`v0.2.0` Git tag and are not a supported onboarding path. New cellars start
manually or use the permanent product CSV importer.

## Validation required

See `../v01-final-rebaseline.md` and `../v01-production-acceptance.md`.
