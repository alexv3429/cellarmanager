# ADR 005: Capture-assisted wine entry

- Status: Accepted
- Date: 2026-09-26
- Implemented: Architecture in v0.6.4; behavior follows in later v0.6 steps

## Context

CellarManager plans to reduce manual typing when adding or identifying wines
using label photos, OCR, and package identifiers. These sources can be
incomplete or wrong, especially for producer names, cuvées, vintages, and
formats. They must extend the existing wine-reference and enrichment model,
not become an alternate authority for shared identities or inventory.

The existing contracts require household wines to remain household-owned,
shared identities to remain service-managed, and every inventory mutation to
use the guarded ADD/MOVE/REMOVE operation model. Existing Owner/Member
permissions make shared cellar writes Owner-only. See
[`004-wine-reference-and-enrichment-evidence.md`](004-wine-reference-and-enrichment-evidence.md),
[`../household-permissions.md`](../household-permissions.md), and
[`002-inventory-operation-model.md`](002-inventory-operation-model.md).

## Decision

- Treat manual entry, image/OCR observations, and barcode values as input
  modalities for one normalized, reviewable wine candidate.
- Preserve field-level provenance and distinguish observations, generated
  suggestions, and user corrections. Confidence is explanatory, not a
  substitute for confirmation.
- Match a candidate against the active household's wines before proposing a
  new wine; use existing shared-reference matching for additional candidates.
  Ambiguity is surfaced for an explicit Owner decision.
- Require an explicit Owner decision to select an existing wine or create a
  household wine. Adding physical bottles remains a separate explicit action
  through the existing Owner-only ADD workflow, including explicit quantity
  and destination storage.
- Barcode scans create identifier candidates. They do not create CellarManager
  IDs, prove vintage identity, or directly write shared reference links.
- Keep images and recognition data private and purpose-limited. Do not place
  images or raw provider responses in shared references, synchronized wine
  facts, or model-training data. Exact asset security and lifecycle rules are
  a prerequisite of 0.6.5.
- Keep recognition adapters, provider credentials, and external lookup
  server-side. No OCR/image provider is approved by this architecture; external
  use requires the same source and rights review as other enrichment inputs.
- Preserve manual entry and normal offline cellar use if capture, network, or
  providers are unavailable.

The architecture and implementation boundaries are specified in
[`../capture-assisted-entry.md`](../capture-assisted-entry.md).

## Alternatives considered

- Writing OCR output directly into the household catalogue is convenient but
  makes recognition errors authoritative and creates duplicates without
  review.
- Treating decoded barcodes as canonical IDs confuses external package keys
  with CellarManager wine identity and cannot handle ambiguous or missing
  catalog lookup results.
- Putting photos, provider payloads, or credentials in the synchronized wine
  row would expose household material across devices and conflate transient
  evidence with stable cellar facts.
- Sending every image to a generic browser-side recognition API would bypass
  credential, provider-rights, privacy, and retention controls.

## Consequences

- Capture adds a candidate/review stage before the existing household wine and
  inventory flows; it does not redefine those flows.
- Recognition failures remain recoverable through manual entry and cannot
  strand inventory operations.
- The image threat model and lifecycle must be approved before implementing
  upload. A specific external recognizer needs its own suitability and rights
  decision.
- Candidate creation, field review, matching, and bottle addition can be
  implemented and tested as separate roadmap steps.

## Validation

This ADR is validated as a design boundary: no schema, provider integration,
upload, or UI behavior is part of 0.6.4. Later steps must test their behavior
against the acceptance contract in
[`../capture-assisted-entry.md`](../capture-assisted-entry.md), without
changing these boundaries implicitly.
