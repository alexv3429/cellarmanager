# ADR 002: inventory operation model

- Status: Proposed
- Date: 2026-08-03

## Context

## Decision

Inventory changes are immutable operations.
Clients do not overwrite authoritative quantities.
Each operation has a UUID and is idempotent.
Invalid or conflicting operations are explicitly rejected.
Current holdings are a projection of accepted operations.

## Alternatives considered

## Consequences

## Validation required