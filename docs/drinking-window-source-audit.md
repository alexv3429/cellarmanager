# Drinking-window source audit

This is a **read-only audit** of the owner's `Caves_2.0.xlsx` snapshot. It
records aggregate coverage and import blockers, not private wine rows. The
workbook is not committed or modified. SHA-256:
`42b935d4fd2e161605d245b15b853d4ee7c1a0a9eed1ea14d460a80857373911`.
Counts here describe that snapshot, not the current hosted cellar.
The staged conversion and shared-library publication path are specified in
[`drinking-window-implementation-plan.md`](drinking-window-implementation-plan.md).

## What the workbook actually supplies

| Source | Observed rows | Candidate use | Blocker before publication |
| --- | ---: | --- | --- |
| 12 producer sheets, exact cuvée + appellation | 19 complete year pairs | Release scope | Sheets omit region; confirm producer/cuvée/appellation IDs and region. |
| Producer sheets, cuvée blank + appellation present | 60 complete pairs; 2 start-only | Producer-appellation scope | Confirm region; complete or quarantine the 2 partial pairs. |
| Producer sheets, cuvée and appellation blank | 5 complete pairs | None under approved ladder | Do not pretend these are producer-appellation rows; review whether a distinct scope is warranted. |
| `Millesimes`, region + colour + vintage | 71 complete standard pairs and 71 complete premium pairs; 2 vintages with neither pair | Regional candidates after converting vintage-relative ages to absolute years | The two historical bins need local ageing-group definitions and wine eligibility; they cannot be published as universal classes. |
| Standalone appellation + region + colour + vintage | 0 | Appellation scope | Needs newly reviewed reference rows; cannot be reconstructed from another tier. |
| `Cave`, manual start/end | 80 complete valid pairs; 9 invalid start values; 6 end-only rows | Private manual overrides only | Review incomplete entries. Do not publish household data as shared profiles. |

The producer sheet columns are vintage, cuvée, appellation, colour, absolute
start and end. All 79 complete producer rows that name an appellation have a
unique normalized alias in the current reviewed place hierarchy, giving a
candidate region: 69 Bourgogne, 8 Languedoc, and 2 Beaujolais. This closes the
*mechanical* region-mapping gap for those rows, but a curator still needs to
verify identity, colour, applicability, and sharing rights before publication.
`Millesimes` has no appellation values in its column B; its L/M and N/O pairs
are *age offsets* for standard and premium respectively, so an
approved import would convert each offset by adding the row's vintage. Two
regional 2023 rows have no offsets at all. The nine invalid `Cave` manual-start
values comprise six `C`, two `x`, and one `75cl`; these are not years.

The workbook's `Cave!O` premium flag is `x` for 674 of the 1,130 identifiable
wines and blank for 456. It was a two-bin approximation of ageing potential,
not evidence that every wine shares one global `premium` classification.
Publishing the standard regional pair for every wine would materially change
the workbook's original classification. The Bourgogne red and white rows for
2021 and 2022 also have different age offsets by vintage and colour: this
source was a per-vintage matrix, not one fixed `vintage + N` rule.

The old `Cave!I2:J2` formulas do not implement the proposed policy. They
resolve the two bounds separately, use a producer sheet's generic
producer+colour row, and treat Piemonte as Bourgogne and Rhône as Languedoc
when regional data are missing. They also
map rosé to white. All of those behaviours must be excluded from a new import
or selector.

There are 1,130 identifiable wines in the workbook snapshot. On a *raw,
case-/accent-normalized region + colour + vintage* comparison only, 836 rows
have a complete standard regional pair and 278 do not; 16 lack at least one
of those three key inputs. This is only a preliminary coverage ceiling: it
does not verify identity, appellation-region consistency, source rights, or
whether a standard profile is the right classification. The largest uncovered
raw regions are Piemonte (45 rows), Rhône (25), Loire (25), Toscana (24), and
Provence (21). No proxy from another region should turn those gaps into
apparently covered wines.

## Current application data are different

The released maturity library contains 151 place-and-colour profiles and 67
vintage modifiers, with some producer/cuvée adjustments. Those are components
of an additive four-date estimate, not complete two-year rows at the four
approved keys. Their current coverage cannot be counted as populated
reference rows, but a safely calculated current projection can remain a
**labelled estimate** when no new reference row matches. Historical v0.1
drinking windows were restored as household observations, explicitly *not*
active overrides. The new reference store needs its own reviewed import and
versioned migration; it must not silently reinterpret either dataset.

## Completion queue

1. Preserve the standard/premium values and `x` flags as historical source
   data, then replace the binary shortcut with reviewed, region-appropriate
   ageing groups and explicit wine eligibility. Legal classification can
   define some Bourgogne groups; other regions may need reviewed cuvée/style
   groupings. Stage both regional pairs until those mappings are established.
   Do not publish standard for all wines or infer a shared group from `x`.
2. Verify the 79 unique appellation-to-region mappings against their producer
   rows, then link canonical producer/cuvée identities and validate colour.
   Quarantine the five producer-only and two incomplete producer rows.
3. Review the 80 complete household manual pairs for private migration and the
   15 incomplete/invalid manual entries with the owner. Do not turn private
   overrides into shared advice.
4. Build the missing appellation tier from new, attributable, reviewed
   evidence. Prioritize uncovered wine/bottle counts, but publish no invented
   year pair when evidence is absent.
5. Preview exact-key coverage and every changed window against current hosted
   data, because workbook counts are historical and the existing model's
   results have different semantics.

Source coordinates for reproducibility: producer sheets `A:F`, rows 2 onward;
`Millesimes!A:O`, rows 3–81; `Cave!B:G`, `M:N`, rows 2–1131; formula definitions
in `Cave!I2:J2`. The workbook is user-private and remains outside Git.
