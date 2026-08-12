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
