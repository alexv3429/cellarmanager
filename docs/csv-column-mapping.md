# Interactive CSV column mapping

CSV import is a three-step operation:

1. **Analyze** — the server detects encoding, separator, physical columns and
   sample values. Nothing is written to the database.
2. **Map and preview** — the user maps each CellarManager field to a CSV column.
   Automatic suggestions are only a starting point. A second source column may
   be selected as a fallback; the first non-empty value wins.
3. **Import** — the exact previewed mapping is submitted with the original file.

This design means an existing spreadsheet does not need to be renamed or
rewritten merely because it uses headers such as `Année Prod`, `Vignoble`,
`Fmt`, `Nb` or `Place`.

## Endpoints

- `POST /import/analyze` — multipart field `file`
- `POST /import/preview` — multipart fields `file` and `mapping`; optional query
  parameter `default_cellar_id`
- `POST /import` — multipart fields `file` and optional `mapping`; optional query
  parameter `default_cellar_id`

A mapping uses stable physical-column IDs returned by `/import/analyze`:

```json
{
  "producer": { "columns": ["column_7"] },
  "vintage": { "columns": ["column_2"] },
  "drink_after": { "columns": ["column_13", "column_9"] }
}
```

The last example means: use `Manuel Min` when it is populated, otherwise use
`Année Min`.

## Safety rules

- Every required target field must have a source mapping, although individual
  cells may be blank where the wine legitimately has no value.
- One physical CSV column cannot feed two target fields.
- Preview performs no writes.
- Invalid quantities do not create orphan Wine records.
- Duplicate and blank CSV headers receive unique stable IDs.
- Mapping profiles are stored only in the current browser's local storage and
  are reused only when the complete ordered header layout matches.

The old direct-import API remains compatible: omitting `mapping` uses the
server's automatic aliases. The browser interface always previews an explicit
mapping before import.
