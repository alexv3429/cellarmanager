# Cellar location naming and labelled grids

CellarManager stores a user-friendly grid definition inside the cellar's
existing `layout` JSON field. No database migration is required.

## Example

For a cellar code `M`, columns `A` through `D`, rows `1` through `3`, and the
order **cellar code + column + row**, the wizard creates:

```text
MA1  MB1  MC1  MD1
MA2  MB2  MC2  MD2
MA3  MB3  MC3  MD3
```

The full value such as `MA1` is used to identify the cellar during CSV import.
Inside the cellar, the position is stored and displayed as `A1` by default.
This keeps the cellar name and position separate while preserving an
unambiguous import code.

## Configuration stored in `layout`

```json
{
  "location_scheme": {
    "kind": "grid",
    "enabled": true,
    "prefix": "M",
    "column_start": "A",
    "column_end": "D",
    "row_start": 1,
    "row_end": 3,
    "order": "prefix_column_row",
    "separator": "",
    "store_internal": true
  }
}
```

The backend derives `location_rule` from this structure. The generated regular
expression is an implementation detail and is only exposed through the
**Advanced pattern** mode for compatibility with unusual legacy layouts.

## Import and reconciliation

During CSV import, a full code such as `MB2` identifies the configured cellar
and is normalized to internal position `B2`. If bottles were imported before
the cellar existed, creating or updating the cellar runs reconciliation and
moves matching unassigned holdings into the right internal positions.

Both full codes (`MB2`) and internal codes (`B2`) are accepted when a cellar is
explicitly selected by name or as the import default.

## Backwards compatibility

Existing plain prefixes, regular expressions, and custom rack layouts continue
to work. A legacy rule appears under **Advanced pattern**. Existing rack JSON is
preserved when a grid naming scheme is added or removed.
