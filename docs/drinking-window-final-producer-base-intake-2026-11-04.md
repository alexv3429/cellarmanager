# Consolidated producer-base intake — 4 November 2026

This is a **Gate 4 research intake in draft PR #231**, not an approval or a
publication. The owner supplied
`CellarManager_BASE_OENOLOGIQUE_FINALE_2026-11-04.zip` (SHA-256
`ea953c584508386912adc91afe11a7ccb21d7afac0127569249f64641e473a81`).
The archive opened cleanly; all 147 entries in its SHA-256 manifest matched
their declared hashes and sizes. Its readme and methodology are research
context, not instructions to change the app or the shared database.

## Native validation and narrow intake correction

The bundle has 46 **producer** exchange JSON documents (schema 1.1.0,
dataset 11.0.0), 46 documentary JSONs, 46 readable Markdown sheets, and
research CSVs. Only the 46 exchange JSONs are import candidates. They contain
598 cuvées, 461 exact-release three-date proposals and 1,055 source notices.
The proposal metadata distinguishes 451 editorial/model estimates from ten
three-milestone source claims; every proposal remains an unapproved candidate.
The documentary files and pairing suggestions are not published profile facts.

Before the narrow client/Node intake correction in this PR, the native
validators accepted 21/46 exchange files. The other 25 had 299 empty strings
in **optional** cuvée fields (`site_description`, `style_summary`, `grape`).
Treating exactly these empty optional descriptions as absent in a validation
copy makes all **46/46 pass** the native schema, cross-reference, and date-order
checks. The uploaded source object is not mutated; required identity,
release-existence, evidence and date fields are not repaired or relaxed.
This is a format check, **not** verification of the cited pages, reuse rights,
historical attribution, or the proposed optimum years. The package's own
methodology calls for that further review. Focused client import tests passed
with the 46-file directory, the Node validator accepted 46/46, all 916 web
tests passed (one pre-existing skip), and TypeScript and production builds
passed. These tests do not constitute curator review.

## Supersession is not automatic

All 23 producer names from the previously archived bundle occur in this
46-profile lot. Comparing those 23 saved profiles' 670 release proposals by
normalized cuvée/alias, vintage and bottle format gives **323 unchanged**
three-date rows, **two changed** rows and **345 prior rows absent** from the
new lot. The two changes are Bret Brothers Mâcon-Igé Les Vernayes:

| Vintage | Earlier proposal | New proposal |
| --- | --- | --- |
| 2022 | 2023 / 2025–2027 | 2023 / 2024–2027 |
| 2024 | 2025 / 2026–2028 | 2025 / 2026–2029 |

An absent prior row is **not automatically invalid**, and a new date is not
automatically better. The archives remain separate versions until a curator
resolves omissions and differences. Do not overwrite, withdraw or publish
either set wholesale. The Burgaud 2022 values in the new file are Côte du Py
2025 / 2028–2040 (the owner's selected provisional value) and James 2026 /
2030–2038 (still a research proposal); these are consistency checks, not
fresh publication decisions.

## Real-cellar opportunity, not delivered coverage

A read-only comparison against the protected restored pilot snapshot counted
802 active wine cards and 1,272 bottles. Producer labels/aliases in this new
lot overlap 355 cards (602 bottles). Exact local cuvée label plus colour
overlaps 263 cards (455 bottles). Adding vintage and format leaves only
**67 cards / 126 bottles**. These are *textual candidates*, not confirmed
canonical identities or effective published windows. For comparison, the
previous 23-file research lot produced 183 exact local-name candidates / 353
bottles under the same style of check. The new lot's source-led omission of
uncertain vintages improves discipline but reduces this narrow opportunity
count. It does not contain appellation or region exchange profiles, so it
cannot by itself deliver the required fallback coverage or the 95% target.

## Decision boundary and next action in the same six-PR plan

No new profile from this ZIP was imported into the linked project, staged,
approved, published or enabled for a household by this intake. The existing
23 archived profiles and approved-but-unpublished rows remain as they were.
The curator must first compare the 345 missing prior rows and two changed
dates, then resolve producer/cuvée/release identities and check evidence for
bounded high-impact batches. Appellation and region fallbacks must be
prepared and reviewed separately. After each batch, report real profile-backed
card counts by source, not JSON or textual-overlap counts. Keep this work in
Gate 4 PR #231; Gate 5 remains the official rollout slot, and no seventh PR
or lower release bar is implied by receiving a file named “final.”
