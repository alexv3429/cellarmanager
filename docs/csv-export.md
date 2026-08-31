# Portable cellar files

Roadmap step 0.4.16 gives a household a readable, deterministic copy of its
current cellar without creating a second import path. Excel (`.xlsx`) is the
default human-friendly download and CSV remains an explicit alternative. Both
exports are generated
in the browser from the synchronized local database and the same pending
inventory projection shown by Inventory. It therefore remains available
offline after the initial synchronization and includes queued local ADD, MOVE,
and REMOVE operations.

## Excel workbook

The default workbook contains two portable-data worksheets:

- **Cellar** is the readable worksheet. It has styled headings, sensible column
  widths, a frozen header row, and human-readable grape and certification
  values.
- **CellarManager data** retains the complete structured values, confirmed
  reference IDs, stable wine IDs, and internal format version required for a
  deterministic portable record.

When the export is created online, it also contains a **Drinking windows**
worksheet with one row per wine. This is a dated snapshot of the effective
guidance currently shown in CellarManager: a personal window takes precedence
over a member calibration, which in turn takes precedence over the canonical
model estimate. It includes first-trial, best-period, and drink-by years, the
current status, explicit provenance, confidence, and calculation date. The
snapshot is for reference and is not silently restored by spreadsheet import.
An offline export remains available but explicitly omits this online-derived
worksheet.

Import accepts unencrypted `.xlsx` workbooks up to 20 MB. It selects a worksheet
named `Cellar` when present; otherwise it chooses the worksheet whose first row
contains the most recognized CellarManager import headings. The selected rows
then enter the same mapping, cleaning, matching, storage-resolution, preview,
and confirmation pipeline as CSV. No workbook formula is evaluated by
CellarManager.

## CSV file and row contract

`CellarManager CSV v1` is a UTF-8, comma-delimited file with a byte-order mark,
CRLF record endings, a header row, and quoted cells. Quotes inside cells are
doubled. Each positive-quantity row represents one wine at one physical
cellar/location position. A wine in two positions therefore produces two rows
with the same stable wine ID and its quantity at each position.

The format name and version are internal file metadata, not a choice presented
in the regular export screen. Excel stores this metadata on the
**CellarManager data** worksheet; CSV stores it in its final column. If a future
schema needs version 2, the importer will add version 2 support alongside
version 1 support. Older clients reject an unknown version with a clear update
message instead of guessing how to map it. Third-party Excel or CSV files
without CellarManager version metadata continue through the normal mapping
workflow.

The default export contains only positive inventory and is compatible with the
existing guarded spreadsheet importer. **Include wines with no bottles** adds one
catalog-only row for each wine without bottles. Those rows have blank Cellar
and Location values and Quantity `0`; they are useful as an archive but cannot
be committed by the importer, which intentionally accepts only positive bottle
quantities.

Merged source wines are not exported. The surviving wine and transferred
holdings are exported normally.

## Version 1 portable columns

The first ten columns use exact headers already recognized by the importer:

| Column | Meaning | Round-trip behavior |
|---|---|---|
| `Producer` | Household producer wording | Mapped |
| `Cuvée` | Household cuvée or wine name | Mapped |
| `Vintage` | Four-digit vintage or `NV` | Mapped |
| `Color` | Household color/type wording | Mapped |
| `Appellation` | Optional appellation | Mapped |
| `Area` | Optional broader region | Mapped |
| `Bottle format` | Positive integer millilitres followed by `ml` | Mapped |
| `Cellar` | Physical cellar name | Mapped |
| `Location` | Physical location code | Mapped |
| `Quantity` | Bottles at this position | Mapped when positive |

The remaining columns preserve portable context without silently changing the
current importer. Excel keeps their complete structured form on the technical
worksheet and presents human-readable grapes and certifications on **Cellar**:

| Column | Meaning |
|---|---|
| `Country` | Household country fact |
| `Classification` | Household classification fact |
| `Vineyard` | Household vineyard, climat, site, or parcel fact |
| `Grape composition (JSON)` | Ordered JSON array of `{name, percentage}` objects; unknown percentages are `null` |
| `Sweetness` | Household sweetness category |
| `Alcohol (%)` | Label alcohol percentage |
| `Certifications (JSON)` | Ordered JSON array of household certification labels |
| `Reference type` | Confirmed reference scheme, when present |
| `Reference ID` | Confirmed external reference identifier, when present |
| `CellarManager wine ID` | Stable household wine UUID |
| `CellarManager CSV version` | The literal version `1` |

The importer deliberately leaves these additional columns unmapped. Reimporting
the default export restores reviewed core wine identity, storage, and bottle
quantities through the normal preview and commit rules; it does not overwrite
rich facts or confirm external references silently. The additional fields stay
available to people and future compatible tools.

## Spreadsheet safety

User-maintained text beginning with `=`, `+`, `-`, or `@` could otherwise be
interpreted as a formula by spreadsheet software. CSV prefixes such a cell with
a tab; the Excel writer emits it as a text value. CellarManager's importer trims
the CSV leading whitespace during normalization, so the original core value
survives a round trip without executing it as a spreadsheet formula.

## Scope boundaries

These files are a portable inventory/catalog snapshot, not a complete database
backup or an export of the shared knowledge library. It includes household wine
facts and confirmed reference identifiers. It does not duplicate:

- immutable shared place, vintage, producer, or cuvée profiles;
- the shared profiles and model inputs behind the exported maturity snapshot;
- derived storage, serving, or pairing recommendations;
- shared research cases, evidence pages, or publication history;
- personal observations or member-specific overrides;
- the private calibration setting itself (only its explicitly labelled derived
  maturity snapshot may appear);
- activity history, devices, memberships, import receipts, or merge audit rows;
- inactive empty cellar/location setup, capacity, order, or storage purpose.

Those records either remain available from their attributable shared source,
are private member data that cannot be flattened safely into one inventory row,
or require the tested backup procedure scheduled for v1.0.

## Safe round trip

1. Export with **Include wines with no bottles** left off.
2. Import the Excel workbook or CSV into the intended household.
3. Review all automatic column mappings, wine matches, storage destinations,
   and quantities.
4. Confirm only into an empty or intentionally additive target cellar.

Import is additive. Uploading an export back into the same populated cellar
would add the exported quantities again; no file is committed without the
existing explicit preview and confirmation.

## Acceptance

- export positive holdings once per physical position with deterministic order;
- include the latest local projection, including queued offline operations;
- retain NV, Unicode, delimiters, quotes, line breaks, rich facts, reference IDs,
  and stable wine IDs in both portable formats;
- add one dated effective drinking-window snapshot per exported wine when the
  Excel workbook is created online, without making it an import instruction;
- make Excel the primary user-facing download while preserving CSV as an
  explicit alternative;
- accept third-party `.xlsx` files and route them through the production import
  safeguards rather than a separate commit path;
- automatically map and clean the first ten columns through the production
  importer without a second import implementation;
- omit zero-stock wines by default and clearly warn when they are included;
- remain usable offline after synchronization;
- avoid spreadsheet-formula execution without changing normalized round-trip
  values;
- download a dated file and render the export controls without horizontal
  overflow on desktop or phone.
