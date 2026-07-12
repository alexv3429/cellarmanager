# Structured cellar locations

CellarManager offers five location structures. They are stored in the existing
cellar `layout` JSON, so this patch does not require a database migration.
When the cellar is saved, the backend validates the structure and stores an
explicit generated catalog of valid locations under `location_catalog`.

## Loose storage

Use this for an unordered cellar or storage area such as `STC`.

- Cellar code: `STC`
- Optional named containers: `Box 1`, `Box 2`, `Shelf`
- Free-text suffixes may be allowed

Examples:

- `STC` assigns the bottle to the cellar without a precise position.
- `STC Box 2` is stored internally as `Box 2`.

A cellar code is strongly recommended. Without one, an unassigned CSV location
cannot uniquely identify this cellar.

## Simple grid

For rows and columns such as:

```text
A1  B1  C1  D1
A2  B2  C2  D2
A3  B3  C3  D3
```

An optional cellar code can recognize full import values such as `MA1` while
showing only `A1` inside the cellar.

## Grid with sub-positions

For several positions inside each grid cell:

```text
A1.1  A1.2
B1.1  B1.2
```

Configure the first and last sub-position and the separator before it.

## Sequentially labelled grid

For a physical grid labelled A, B, C ... from one corner. The number of named
positions may be lower than `rows × columns`, so a 7 × 4 grid can contain
exactly A through Z and leave its final two cells unused.

The wizard supports row-major or column-major filling and lets the user choose
left/right and top/bottom orientation.

## Rows with depth

For locations such as `G1F` and `G1B`:

- cellar/rack code: `G`
- rows: `1` through `9`
- depth definitions: `F=Front`, `B=Back`

Depth labels are user-defined, so `1=Front`, `2=Middle`, `3=Back` is also
supported.

## Advanced patterns

Legacy plain-prefix and regular-expression rules remain available under
**Advanced pattern**. Structured presets are preferred because they provide
validation, an exact catalog, and a visual layout.
