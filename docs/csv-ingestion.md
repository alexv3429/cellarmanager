# CSV ingestion contract

Roadmap step 0.3.6 establishes the structural boundary for the permanent CSV
importer. It turns CSV text into an inspectable document; it does not map
columns, normalize wine values, match records, reconcile stock, or write to the
database.

## Accepted input

The v0.3 importer accepts plain UTF-8 CSV text with:

- a header as the first non-blank logical record
- comma, semicolon, or tab delimiters
- automatic delimiter detection or an explicit delimiter selected by the user
- an optional Excel-style `sep=,` or `sep=;` first line
- LF, CRLF, or CR line endings
- an optional UTF-8 byte-order mark
- quoted fields, escaped quotes (`""`), quoted delimiters, and multiline quoted
  values

Blank physical lines are ignored. A record containing delimiters and empty
cells is preserved because it may still represent a source row the user must
review.

Automatic detection refuses ambiguous and single-column input. The upload and
mapping workspace asks the user to choose a supported delimiter explicitly and
parses the text again.

## Parser output

`parseCsvText` returns:

- the selected delimiter and whether it was detected, explicit, or supplied by
  a `sep=` directive
- the unmodified header values
- each data record with its sequential record number
- the starting and ending physical source line for every record
- structured issues with stable codes, severity, and source context
- a `truncated` flag when a configured safety limit was reached

CSV syntax is decoded: surrounding quotes are removed, doubled quotes become a
single quote, and line endings inside quoted values become `\n`. All other cell
text is preserved. In particular, this step does not trim whitespace, change
casing, interpret `NV`, parse quantities, or normalize bottle formats.

## Structural errors

The parser retains as much inspectable source information as possible while
reporting problems such as:

- an empty or non-text document
- an undetectable, ambiguous, or conflicting delimiter
- unterminated or misplaced quotes
- characters after a closing quote
- records whose column count differs from the header
- configured input, record, column, or cell limits being exceeded

An import flow must not proceed to an authoritative write while parser errors
remain unresolved.

## Default safety limits

- 20,000,000 input characters
- 100,001 logical records, including the header
- 256 columns per record
- 100,000 characters per cell

These limits protect the browser parser. The upload workspace also rejects
files larger than 20 MB before reading them.

## Deferred steps

The remaining importer stages stay intentionally separate:

1. 0.3.8 cleans and normalizes mapped values.
2. 0.3.9–0.3.12 match, reconcile, preview, and resolve issues.
3. 0.3.13 performs the first transactional authoritative write.
4. 0.3.14 locks the full flow with import regression fixtures.

This separation preserves the required
`upload -> map -> clean -> preview -> resolve -> preview -> commit` safety flow.

## Column mapping contract

Roadmap step 0.3.7 adds the `/import` workspace and maps arbitrary source
headers to the following CellarManager fields:

| Field | Mapping requirement |
|---|---|
| Producer | Required |
| Cuvée | Required |
| Vintage | Optional; an unmapped value means NV for later normalization |
| Color | Required |
| Appellation | Optional supporting metadata |
| Area | Optional supporting metadata |
| Bottle format | Required; may use an explicit value applied to every row |
| Cellar | Optional; unresolved storage is handled before import |
| Location | Optional; unresolved storage is handled before import |
| Quantity | Required; may use an explicit value applied to every row |

Each target field may be assigned to at most one source column. When a source
omits a column because every row has the same value, the user may explicitly
set that target field once for every row. This applies to required and optional
fields—for example `750 ml` for Bottle format—and is shown in the sample,
cleaning, preview, and commit plan exactly like a mapped source value. The
importer never supplies such a value implicitly. A target field cannot use a
source mapping and an all-row value at the same time.

Header-based suggestions recognize a conservative set of common English and
French labels; unknown or duplicate-looking headers remain unmapped for
explicit review.

The mapping UI shows up to three raw sample values per source column and a
mapped preview of the first three source records. Every unmapped value is
retained with its source header and column index. Mapping does not trim,
normalize, interpret, or write values. The disabled “Continue to cleaning”
control documents the next pipeline stage without implementing it early.

Cellar and location are optional source mappings because a valid source may
describe bottles without assigning their final physical storage. The later
location-reconciliation step must assign those rows to a real location—such as
an explicitly selected overflow location—before the transactional commit can
be enabled. The importer must not invent or silently choose that location.

## Cleaning and normalization contract

Roadmap step 0.3.8 applies deterministic cleaning to the importer's working
copy of every mapped source row. The uploaded source and authoritative cellar
data remain unchanged during preparation:

- surrounding whitespace is removed and repeated whitespace becomes one space
- wine color is lowercased, matching the normal catalog entry rules
- a blank vintage, `NV`, `N.V.`, `NM`, `N.M.`, `non-vintage`,
  `non millésime`, or `sans millésime` becomes the canonical null/NV value
- a numeric vintage must contain four digits and fall between 1800 and 2200
- bottle formats accept a positive metric value in millilitres, centilitres,
  or litres and become a supported positive whole number of millilitres
- quantity becomes a supported positive whole number
- blank optional wine metadata, cellar, and location values become null

Bottle formats without a unit are interpreted as millilitres. Named formats
such as “magnum” remain invalid because guessing their physical volume would
make matching unsafe. Decimal comma and decimal point metric values are both
accepted only when their conversion produces a whole millilitre.

Producer, cuvée, color, bottle format, and quantity must contain a valid value
on every row. For blank cells in a mapped Cuvée column, the user may explicitly
choose one import-only fallback: a fixed value, the row's normalized Color, or
the row's normalized Appellation. Non-empty Cuvée cells are never replaced. A
blank or unavailable selected fallback leaves the row invalid, so the database
still receives a non-empty cuvée and its schema does not change. Vintage and
supporting metadata may be empty. Cellar and location remain optional at this
stage and must be reconciled before commit.

Cleaning issues retain the source record number, physical line range, field,
and raw source value. The original mapped source row and unmapped values remain
available unchanged. Safe, documented equivalences such as `NM` to `NV` are
normalized automatically; this is a working-copy transformation, not a write
to the source file or database. Invalid rows are displayed first and block later import
stages; the user must correct the source file and upload it again, or configure
the explicit blank-Cuvée fallback when that is the only issue. This step does
not match wines, reconcile locations, resolve issues, or write data.

## Existing-wine matching contract

Roadmap step 0.3.9 compares every valid cleaned row with the synchronized wine
catalog for the active household. It reuses the same conservative semantic
identity as manual ADD and the server:

`producer + cuvée + vintage/NV + color + format_ml`

Identity text is compared case-insensitively after whitespace cleaning.
Appellation and area remain supporting metadata; they neither merge nor split
catalog references.

Each valid row receives one deterministic classification:

- **Existing** when exactly one catalog reference has the same identity
- **New** when no catalog reference has the same identity
- **Ambiguous** when multiple catalog references have the same identity

Matching never crosses the active-household boundary. Invalid cleaned rows are
not matched. Ambiguous results retain and display every candidate wine ID plus
its appellation and area, and no candidate is selected silently. Explicit
candidate selection remains part of the later issue-resolution step.

The matching view reports counts for existing, new, and ambiguous rows and
shows ambiguous rows first without changing their source record or line
context. It reads the local synchronized catalog only; it does not create,
update, merge, or otherwise write wine or inventory data.

## Location and quantity reconciliation contract

Roadmap step 0.3.10 compares every valid cleaned row with the synchronized
cellars and locations for the active household. Cellar names and location
codes are compared case-insensitively after the same whitespace cleaning used
for wine identity. A row is assigned only when exactly one active cellar and
exactly one active location inside that cellar match.

Cellar and location remain optional CSV columns, but both values must be
resolved before an authoritative import can proceed. A missing, unknown,
archived, or ambiguous value remains an explicit issue. The importer does not
invent storage, select an overflow location, restore an archived record, or
match storage owned by another household. The user may explicitly create a new
cellar and its first location from the resolution stage, then assign every
currently storage-unresolved row to that destination. Cellar setup is written
immediately and remains even if the CSV is later cancelled; bottle inventory is
still written only by final transactional confirmation.

For each matched location, the importer adds the quantities from every CSV row
assigned there and compares that total with the location's current synchronized
bottle count. When a positive capacity has been configured, a projected total
above that value produces an advisory warning for the location. It does not
invalidate the otherwise valid assignment because capacity is a rough planning
value and existing inventory workflows do not enforce it as a hard limit. An
unconfigured capacity does not produce a warning.

The reconciliation view reports assigned bottles and rows, unresolved rows,
and distinct locations with capacity warnings. It displays unresolved rows and
warnings first while retaining the original source record and physical line
context. This step is read-only: it does not create storage, change capacity,
move bottles, update holdings, or write import data. Assignment and ambiguity
controls remain part of the issue-resolution step.

## Complete import preview contract

Roadmap step 0.3.11 combines the cleaned source row, wine classification, and
storage reconciliation into one deterministic, read-only plan. Each preview
row shows its original source record and physical line context together with:

- the normalized wine identity and whether the import would reuse one existing
  catalog reference, create a new catalog reference, or require an explicit
  wine decision
- the resolved cellar and location, the location's current and projected
  occupancy, and its optional configured capacity
- the positive bottle quantity that would be added after later confirmation
- every blocking issue and advisory capacity warning
- all preserved values from source columns that were intentionally left
  unmapped

Summary counts distinguish total and ready bottles, blocked rows, distinct new
and existing wine references, distinct resolved destinations, and distinct
locations with capacity warnings. Repeated CSV rows for the same semantic new
wine or destination are counted once in those reference totals while remaining
individually visible with their own quantities and source context.

A preview row is blocked when either its wine decision or storage assignment is
unresolved. Capacity warnings remain advisory and do not block an otherwise
resolved row. Blocked rows and warning rows are displayed before ready rows so
the first preview is useful even before issue-resolution controls exist.

This step does not select an ambiguous wine, invent storage, edit source data,
create catalog references, add holdings, enqueue inventory operations, or
write any authoritative data. Roadmap step 0.3.12 will resolve supported issues
and produce the second preview required before transactional commit.

## Import issue-resolution contract

Roadmap step 0.3.12 accepts explicit decisions for the blocking issues exposed
by the first preview. It supports two decisions per source row:

- an ambiguous wine may be resolved only by choosing one of the exact catalog
  candidates retained by that row's conservative identity match
- unresolved storage may be assigned to one active location whose active
  cellar and household both match the current import household

The resolver treats saved choices as untrusted input. An unknown wine ID, a
wine that is not one of the row's candidates, an archived or unknown location,
a location inside an archived cellar, or storage from another household does
not resolve the row. If synchronized catalog or storage data changes after a
choice was made, the choice is revalidated; an unsafe or still-ambiguous result
is blocked again rather than using a stale selection. A newly unique exact wine
match may still resolve automatically under the existing matching contract.

Location choices are per source row. After every choice, quantities are
re-aggregated across all automatically matched and manually assigned rows, and
projected occupancy and advisory capacity warnings are recalculated. Capacity
remains advisory and never substitutes for an unresolved destination.

The resolved wine matches and storage assignments are passed through the same
complete preview model as the first preview. The second preview therefore
retains source records, wine actions, destinations, quantities, warnings, and
unmapped values while reporting whether any blocker remains. Cleaning errors
are still corrected in the source CSV; this step does not edit invalid wine or
quantity values in place.

To keep small imports usable, preparation stages collapse into a reopenable
summary after the first preview is available. The first preview exposes its
complete row list on demand, issue-resolution controls show only blocked rows,
and resolved preview rows keep occupancy and source metadata in expandable
details. Blocking messages and capacity warnings remain visible without
expansion.

This step is deterministic and read-only. It does not create wines, add or move
bottles, change cellar setup, enqueue inventory operations, or write import
state. Roadmap step 0.3.13 performs the first transactional authoritative
commit after a complete second preview.

## Transactional import commit contract

Roadmap step 0.3.13 turns a complete resolved preview into authoritative
inventory data. Bulk import is deliberately online-only: the browser submits
one immutable batch to a PostgreSQL RPC instead of queuing rows individually
through the offline operation uploader.

The confirmation plan assigns one random import receipt ID, one
inventory-operation ID per source row, and one requested catalog ID per
distinct new semantic wine.
Repeated source rows for the same new wine therefore share one requested wine
ID while retaining separate quantities and source records. Existing-wine rows
retain their explicitly resolved catalog IDs.

Before the final action is enabled, every row must have a non-blocking second
preview, an active destination, a complete normalized wine identity, and a
positive quantity. The device must be registered, the browser must be online,
and the user must explicitly acknowledge the final wine, destination, quantity,
and capacity-warning plan. If synchronized data changes after the confirmation
opens, the browser discards that confirmation and requires review again.

The server treats the complete JSON payload as untrusted input. It revalidates
authentication, household membership, device ownership, unique source records
and operation IDs, requested create/reuse actions, wine identity, positive
quantities, household destinations, and active cellar/location state. Each row
then passes through the normal ADD inventory operation functions so catalog
normalization, conservative semantic matching, immutable activity records, and
holding updates keep their existing domain behavior.

All rows and the private import receipt are written inside one PostgreSQL
transaction. A rejected row rolls back earlier wine, holding, journal, and
receipt writes from the same batch. Capacity remains advisory and does not make
an otherwise safe row fail.

The import receipt makes an uncertain network response safely retryable. The
same receipt ID and exact payload return the already-committed result without
adding stock twice; reuse with a changed household, user, device, timestamp, or
row payload is rejected. After an error, a separate read-only RPC checks whether
the receipt was committed: an existing receipt is reported as success, a
definitely absent receipt unlocks the current preview for correction, and an
unverifiable response keeps the original IDs frozen for a safe exact retry.
Receipt verification takes the same per-import transaction lock, so absence is
reported only after any still-running commit has completed. On success, the UI
reports imported rows and bottles, created and reused wine
references, and the receipt ID before offering a clean new-import reset.

Immediately before the first request, the browser persists the immutable plan
and its IDs locally. A refresh or navigation back to Import verifies that saved
receipt before allowing a new upload: committed work is reported as success,
definite rollback unlocks a new attempt, and an unverifiable outcome retains an
exact-retry action. The plan is removed locally after success, proven rollback,
or sign-out, so a later intentional import of identical source rows remains
possible. The original server receipt payload remains private and cannot be
selected directly by browser roles.

## Import regression fixture contract

Roadmap step 0.3.14 locks the complete browser-side pipeline with small,
synthetic CSV files under
`apps/web/src/data/fixtures/csv-import/`. The fixtures contain no personal
cellar data and are never submitted to the linked Supabase project.

The permanent matrix covers three boundaries:

- a messy but resolvable import uses an Excel separator directive, common
  French headers, normalized text and metric formats, an unmapped multiline
  note, an exact catalog match, an explicit ambiguous-wine selection, repeated
  rows for one new semantic wine, explicit storage assignments, and an
  advisory capacity warning
- a structurally valid unsafe import retains invalid vintage, format, and
  quantity issues together with unresolved wine and storage decisions, and it
  remains blocked before commit planning
- a structurally malformed import retains quote and column-count errors and is
  rejected before column mapping

`csvImportRegression.test.ts` composes the same parser, header suggestion,
mapping, cleaning, catalog matching, storage reconciliation, issue resolution,
preview, commit-plan, and RPC-adapter functions used by the application. Its
successful fixture asserts the final immutable row payload and shared new-wine
ID before a mocked RPC returns the receipt summary. The PostgreSQL regression
suite remains responsible for the authoritative transaction, rollback,
idempotency, and security behavior behind that RPC.

Expectations are explicit rather than snapshots. Changing a fixture therefore
requires an intentional review of source lines, normalization, decisions,
summary counts, destinations, and final operation payloads.
