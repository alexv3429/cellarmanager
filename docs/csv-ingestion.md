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
4. 0.3.14 adds full import regression fixtures.

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
| Bottle format | Required |
| Cellar | Optional; unresolved storage is handled before import |
| Location | Optional; unresolved storage is handled before import |
| Quantity | Required |

Each target field may be assigned to at most one source column. Header-based
suggestions recognize a conservative set of common English and French labels;
unknown or duplicate-looking headers remain unmapped for explicit review.

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

Roadmap step 0.3.8 applies deterministic, read-only cleaning to every mapped
source row:

- surrounding whitespace is removed and repeated whitespace becomes one space
- wine color is lowercased, matching the normal catalog entry rules
- a blank vintage, `NV`, `N.V.`, `non-vintage`, `non millésime`, or
  `sans millésime` becomes the canonical null/NV value
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
on every row. Vintage and supporting metadata may be empty. Cellar and
location remain optional at this stage and must be reconciled before commit.

Cleaning issues retain the source record number, physical line range, field,
and raw source value. The original mapped source row and unmapped values remain
available unchanged. Invalid rows are displayed first and block later import
stages; the user must correct the source file and upload it again. This step
does not match wines, reconcile locations, resolve issues, or write data.

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
match storage owned by another household.

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
