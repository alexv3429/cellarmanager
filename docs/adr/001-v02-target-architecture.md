# ADR 001: v0.2 target architecture

- Status: Accepted
- Date: 2026-08-03
- Implemented: v0.2.0; current through v0.4.0

## Context

The v0.1 FastAPI/SQLite application could not provide the intended hosted,
multi-device, local-first product boundary. The replacement needed durable
PostgreSQL authority, self-service authentication, household isolation, offline
daily inventory work, and a deployable browser/PWA client.

## Decision

- React, TypeScript, and Vite provide the browser application.
- Supabase supplies PostgreSQL, authentication, row-level security, and guarded
  RPCs.
- PowerSync supplies the persisted local database, synchronization, and queued
  local-first inventory operations.
- Cloudflare Workers Static Assets hosts the production single-page application.
- The application uses client-side URL routing and has no server-side rendering.

## Alternatives considered

- Continuing the v0.1 runtime would preserve its deployment and data model but
  would not establish the new offline, household, and security contracts.
- Direct browser CRUD against PostgreSQL would be simpler but would make offline
  work and conflict handling unsafe.
- Server-side rendering would add an execution tier without improving the
  authenticated local-first inventory workflows.

## Consequences

- PostgreSQL migrations and row-level security are production contracts.
- The browser must handle local readiness, synchronization state, and rejected
  operations explicitly.
- Static hosting requires SPA fallback for URL-backed routes.
- Production/PWA behavior must be tested from a build served through the
  Cloudflare path, not inferred from Vite development mode alone.

## Validation

The architecture was accepted in `v0.2.0` and exercised again by the
[`v0.3.0` acceptance record](../v03-personal-production-acceptance.md). CI runs
the web gate, Supabase pgTAP suite, repository policy, and production dependency
audit for every pull request.
