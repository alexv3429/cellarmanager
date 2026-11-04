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

All 23 producer IDs from the previously archived bundle occur in this
46-profile lot. A reproducible, read-only comparison by producer ID, cuvée
ID, vintage and bottle format accounts for all 670 archived proposals:
**323 unchanged**, **two changed**, and **345 absent** from the new lot.
The supplied audit CSV accounts for every absence: 340 are marked as lacking
a named-vintage source URL, four cite a named-vintage page for **another
cuvée**, and one cites a page that does not name the cuvée. These are the
new bundle's stated reasons, not independent adjudication of every source.
The 340 remain research candidates in the older archive; the five cuvée
identity problems must not be promoted without corrected evidence. The new
bundle adds one release to those same 23 profiles and 135 releases under its
23 additional producers. The two changed dates are Bret Brothers Mâcon-Igé
Les Vernayes:

| Vintage | Earlier proposal | New proposal |
| --- | --- | --- |
| 2022 | 2023 / 2025–2027 | 2023 / 2024–2027 |
| 2024 | 2025 / 2026–2028 | 2025 / 2026–2029 |

The [cited 2022 retailer page](https://www.lecarredesvins.com/16368-bret-brothers-macon-ige-les-vernayes-2022-6604700.html)
was checked independently: it identifies the 2022/75 cl release and states
`boire à partir` 2023 and `apogée` 2024–2027. That supports the *new 2022
candidate* more directly than the old modelled 2025 optimum start, but it is
retailer advice, not a producer guarantee, and reuse approval remains open.
The [cited 2024 retailer page](https://www.lecarredesvins.com/19557-bret-brothers-macon-ige-les-vernayes-2024-7317100.html)
could not be retrieved in this check; the 2024 change therefore remains
unresolved. Neither change has been applied to a shared window.

An absent prior row is **not automatically invalid**, and a new date is not
automatically better. The archives remain separate versions until a curator
resolves omissions and differences. Do not overwrite, withdraw or publish
either set wholesale. The Burgaud 2022 values in the new file are Côte du Py
2025 / 2028–2040 (the owner's selected provisional value) and James 2026 /
2030–2038 (still a research proposal); these are consistency checks, not
fresh publication decisions.

## Real-cellar opportunity, not delivered coverage

A read-only comparison against the protected restored pilot snapshot counted
802 active wine cards and 1,272 bottles. With the owner's previously reviewed
local producer labels for the first 23 profiles, plus exact name/alias matches
for the 23 new profiles, the new lot has **97 textual exact
cuvée/vintage/format candidates (180 bottles)**. The older 23-profile lot has
183 (353 bottles), of which **104 cards / 195 bottles** correspond only to
the 345 now-absent rows. The union of old and new exact candidates is 201
cards / 375 bottles. The previous 67-card figure in this audit used an
incomplete producer-name map; it was **incorrect and is superseded** by this
reconciled calculation. These are opportunities for review, not confirmed
canonical identities, approved dates, or a coverage percentage.

The absent-row opportunities most relevant to the pilot are Chagnoleau
(21 cards / 46 bottles), Burgaud (13 / 41), Langoureau (15 / 27), Clos Marie
(11 / 17), and Cazeneuve (5 / 13). Do not restore those dates en masse;
check the release identities and source basis first. The new lot has no
appellation or region exchange profiles, so exact-release candidates alone
cannot deliver the required fallbacks or the 95% target.

The **actual effective advice** on that restored snapshot is much more
limited: 751 cards / 1,201 bottles use the existing model, two cards / two
bottles use manual dates, 49 cards / 69 bottles have no usable dates, and
**zero** use a published shared profile. The 23 archived JSONs and the new
ZIP are not active recommendations. This is a local restored-copy
measurement, not an assertion about a later live-cellar snapshot.

## Decision boundary and next action in the same six-PR plan

No new profile from this ZIP was imported into the linked project, staged,
approved, published or enabled for a household by this intake. The existing
23 archived profiles and approved-but-unpublished rows remain as they were.
The 345 omissions are now classified; the five wrong/insufficient cuvée
pointers stay quarantined and the 340 source gaps remain in the older research
archive. The 2022 Bret change has a directly checked retailer page, while
the 2024 change still needs an accessible, checked page. Next, resolve
producer/cuvée/release identities and check date evidence for bounded
high-impact batches, starting with the absent rows affecting actual bottles.
Appellation and region fallbacks must be
prepared and reviewed separately. After each batch, report real profile-backed
card counts by source, not JSON or textual-overlap counts. Keep this work in
Gate 4 PR #231; Gate 5 remains the official rollout slot, and no seventh PR
or lower release bar is implied by receiving a file named “final.”
