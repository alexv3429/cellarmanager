# ADR 008: evidence-backed wine-label field review

- Status: Accepted — 2026-09-28
- Implemented: Roadmap steps 0.6.9–0.6.11

## Context

OCR returns a sequence of label strings, but the strings do not identify their
roles. For example, a name such as “Jean-Marc Burgaud” might be a producer,
while “Morgon Côte du Py” might be the cuvée/designation and “Morgon” the
appellation. Treating those roles as deterministic parsing rules would make
the output look more certain than it is and could silently create duplicates
or incorrect wine records.

## Decision

- Add a separate, explicit Owner action that sends only the saved OCR text—not
  the deleted image, account, household, session, or wine identifiers—to the
  existing server-side Cloudflare Workers AI binding for structured field
  suggestions. This is a separate external inference from photo transcription
  and is disclosed in the UI at the point of action.
- Ask for producer, cuvée/designation, appellation, area, color, format, and
  vintage as distinct fields. Each field is a hypothesis with qualitative
  confidence and exact OCR source-line evidence. Use unknown when unsupported;
  a year is not inferred from an absent value, and non-vintage requires
  explicit label evidence.
- Validate model output server-side. Remove any value whose evidence is not an
  exact saved OCR line or does not contain the proposed text. Downgrade
  unsupported color, format, and vintage guesses to unknown. The UI continues
  to describe role assignments as suggestions and allows the Owner to edit
  them.
- Keep the saved suggestion in a private, owner-only table keyed to the
  existing capture session and subject to its 24-hour expiry. Make generation
  idempotent: duplicate requests return the first persisted suggestion.
- Match only against the active household's local catalogue. Candidate
  ranking is a convenience, not identity resolution: explicit vintage, color,
  and format conflicts exclude a candidate, but no result is selected
  automatically and no external lookup or shared-reference write occurs.
- Copy details into the existing Add bottles form only after an explicit
  Owner action. A selected catalogue wine may prefill that form. The user must
  still review the form and use its existing explicit ADD action, quantity,
  and destination. Suggestions do not create or change wines, holdings,
  locations, or inventory operations.
- Retain manual entry as the fallback. If the model is unavailable, returns
  unsupported output, or produces an ambiguous role assignment, leave the
  saved OCR text available for review and manual correction.

## Consequences

- The system does not claim that role classification is certain. The
  producer/cuvée distinction is proposed from text context, shown with the
  exact source lines, and remains under user control.
- OCR text and the structured suggestion remain private and temporary; the
  deleted photo is not re-uploaded for field extraction. The additional
  inference consumes Workers AI usage and may use the account's free daily
  allowance; no zero-cost guarantee is made.
- The first implementation matches only household wines. Shared reference
  matching, barcode lookup, multi-label fusion, and automatic catalogue
  creation remain future work.

## Validation

Tests cover the Burgaud/Morgon example, exact evidence checks, unsupported
value downgrades, owner authorization, capture expiry, idempotent persistence,
household-only matching, explicit conflict exclusion, and the invariant that
suggestion generation does not create wines or inventory operations.
