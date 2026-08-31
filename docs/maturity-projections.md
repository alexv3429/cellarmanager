# Maturity and storage projections

Roadmap step 0.4.8 turns the reviewed inference proof of concept into an
asynchronous production feature. It estimates when to assess and drink a wine,
identifies bottles to prioritize, and compares that estimate with the physical
purpose of their current locations. These values are advice, not facts.

## Reviewed knowledge coverage

Knowledge v1 contains only the place and vintage profiles accepted in the
20-wine proof of concept:

- Volnay Premier Cru, Chambolle-Musigny Premier Cru, and Puligny-Montrachet
  Premier Cru;
- Pic Saint-Loup;
- Barolo and Barbaresco;
- a Languedoc white profile for wines whose appellation is explicitly stored as
  Languedoc.

Knowledge v2 expands this to 151 explicit place-and-colour profiles and 67
reviewed vintage modifiers. Its design, sources, private aggregate coverage
check, and rejected broad workbook proxies are documented in
[`maturity-knowledge-v2.md`](maturity-knowledge-v2.md). It is expected to assess
approximately 746 of 765 current wines while leaving unsafe rows visible.

Knowledge v3 preserves that v2 coverage and promotes the validated hierarchical
model. Its reviewed additions apply a stable regional baseline, inherited
appellation/climat adjustments, local vintage conditions, time-bounded producer
style, producer×vintage interactions, cuvee structure, and exact-release
observations in that order. The initial validated verticals are Louis Boillot
Les Evocelles 2017–2022 and five contrasting Mas Cal Demoura 2023 cuvees.

Aliases such as `1C` and `1er Cru` are normalized centrally. A place match must
also have a compatible colour. The calculator may use an ancestor's reviewed
vintage profile, but does not infer one place from an unrelated region name.
Producer-era and cuvee layers are used only after producer identity is confirmed.
A confirmed provider product may bridge to another reviewed product identity
when the producer is the same and exactly one curated cuvee alias matches. An
explicit household producer preference can do the same. Ambiguous producer text
such as Boillot or Pernot never selects a producer silently.

A wine without a vintage or exact reviewed compatible place remains
`needs-review` and receives no projection. The calculator never falls back from
an unknown appellation to the broad area field. Missing vintage, unsupported
place, and appellation/colour conflict are exposed as separate reasons.

## Window and urgency semantics

Every completed calculation produces four monotonic years:

1. first assessment — the earliest useful trial bottle;
2. likely best start;
3. likely best end;
4. preferably drink by — a conservative year by which to prioritize or
   reassess it, not an expiry date.

The current year maps those values to `hold`, `assess`, `ready`, `priority`, or
`assess-now`. The UI preserves the broad five-, ten-, or fifteen-year ranges
that long-lived wines need; it does not manufacture a narrow two-year window.
Catalog filters group `priority` and `assess-now` as **Drink sooner**, keep
`assess` and `ready` separately discoverable, and expose unsupported wines as
**Not assessed**.

Knowledge v1/v2 confidence uses the historical weighted coverage score.
Knowledge v3 instead uses the least-supported material layer actually applied,
so several broad strong layers cannot conceal a weak exact assumption. Missing
optional layers create explicit warnings without lowering an otherwise reliable
place/vintage estimate. Reliability remains separate from specificity. Each
projection retains the exact knowledge version, input fingerprint, ordered
contribution trace, profiles, evidence, specificity, calculation time, and
validity horizon.

## Location purpose and moving hints

Every location has one physical purpose:

- `aging` — long-term storage;
- `service` — easy access for bottles to open or assess soon;
- `overflow` — temporary or unsorted storage;
- `mixed` — no single role.

Existing locations migrate safely to `mixed`. A destination created by the CSV
importer starts as `overflow`. Owners can change purpose in Cellar Setup without
renaming or moving the location.

The storage projection uses current positive holdings. A wine on hold belongs
in aging storage. An assessable or ready wine with several bottles normally
keeps one bottle in service and the rest aging. Priority wines belong in service
storage. A moving hint states the quantity and target purpose; when that purpose
has no active location, it asks the owner to classify or create one rather than
claiming the move is possible.

Holding, location-purpose, location-activity, and cellar-activity changes alter
the maturity fingerprint only when they change a wine's actual positions or the
availability of an aging/service destination. Known unsupported wines are not
requeued by unrelated physical edits. Earlier projections remain immutable,
superseded history.

## Review and owner adjustment

An authenticated household member can mark one current model result useful,
questionable, or wrong. Feedback belongs to the exact projection ID, so a later
model calculation never inherits approval for an older result.

An owner-adjusted first-assessment, best-period, suggested drink-by, optional storage
purpose, and note are stored separately from the model output. The application
clearly prefers the adjustment while retaining the raw model, evidence, and
feedback for inspection. Clearing the adjustment activates the current model
again.

A separate account-private calibration may shift every canonical window by one
to three whole years younger or later. It is applied only when the result is
read, so the canonical projection and provenance remain unchanged. Wine Detail
shows the canonical and personal dates together; Catalog state and urgency use
the personal dates for that member. A per-wine manual window still has higher
priority. Storage guidance stays canonical unless its existing explicit
per-wine storage override is set. See
[`personal-maturity-calibration.md`](personal-maturity-calibration.md).

## Growing the shared knowledge library

The hierarchical engine and the process that feeds it are separate trust
boundaries. This step ships the engine and an initial reviewed knowledge
version; it does not let arbitrary browser or web output publish a producer
profile automatically.

For an existing shared producer, a household alias can resolve local text to
the canonical identity immediately. A new cuvee can then use the reviewed
place, vintage, and producer-era layers while an exact cuvee profile is still
missing. For a genuinely unknown producer, the safe immediate result uses only
the compatible reviewed place and vintage layers. The wine remains valid cellar
data and the missing producer layer is visible; it must not block an ADD or CSV
import.

The production feeding workflow should then:

1. aggregate unresolved producer and cuvee identities as curation demand,
   prioritized by the number of affected wines and households;
2. collect candidate facts from official producer, appellation, regulatory, or
   otherwise reviewed sources, retaining source URL, retrieval date, scope, and
   applicable years;
3. propose canonical identities, aliases, time-bounded producer styles, cuvee
   profiles, and supporting evidence without changing household wine text;
4. require review before publishing an immutable shared knowledge version;
5. automatically requeue matching maturity demands after publication so every
   household benefits without re-entering the wine.

Owner tasting observations and corrections can prioritize or challenge this
work, but they remain household-scoped until deliberately promoted through the
same evidence and review gate. This preserves a useful broad estimate for a new
producer while preventing an unverified web inference or one household's alias
from silently becoming global truth.

Step 0.4.10 makes those observations editable and adds serving guidance without
changing this promotion boundary; see
[`personal-observations-serving.md`](personal-observations-serving.md).

Catalog data-quality diagnostics should distinguish missing knowledge from
contradictory catalog data. A contradiction should display the stored values,
the suggested correction and its source, with explicit accept and ignore
actions; the inference engine must never rewrite the catalog itself.

## Runtime and access boundary

The migration is additive and installs no active knowledge by itself. A trusted
service explicitly calls:

```sql
select public.install_initial_maturity_knowledge(); -- historical v1 baseline
select public.install_expanded_maturity_knowledge(); -- reviewed v2 candidate
select public.install_hierarchical_maturity_knowledge(); -- reviewed v3 candidate
```

The idempotent installer creates and atomically publishes the reviewed version.
A `pg_cron` worker claims at most 100 maturity jobs each minute and writes the
maturity and storage projections in one database transaction. Unsupported wines
finish as `needs-review`; a calculation error retries with bounded attempts.
The maturity-specific worker does not process pairing jobs. Step 0.4.9 adds a
separate processor that reuses the reviewed structure and provenance without
changing maturity advice; see
[`pairing-projections.md`](pairing-projections.md).

Knowledge, jobs, evidence, projections, reviews, and overrides remain outside
PowerSync. Browser code receives only household-scoped JSON through narrow
security-definer RPCs. Advice therefore requires a connection while wine and
inventory remain local-first and usable offline. Browser roles cannot publish
knowledge, run the worker, inspect another household, or mutate the underlying
tables directly.

## Acceptance checks

- reset and migrate an empty local database atomically;
- publish each immutable reviewed knowledge version and reproduce its stable
  content hash;
- cover the private aggregate safely without using broad area fallback;
- retain explicit reasons for missing vintage, unsupported place, and colour
  conflict;
- reproduce the accepted Pic Saint-Loup 2018 window;
- reproduce the accepted Evocelles vertical and Cal Demoura 2023 cuvee windows;
- never apply a producer/cuvee layer from ambiguous raw text alone;
- expose the ordered hierarchy and conservative reliability in Wine Detail;
- publish maturity and storage together and retain profile/evidence provenance;
- leave unsupported wines unprojected and visibly `needs-review`;
- requeue after physical placement changes and retain superseded history;
- enforce household isolation for overview, detail, feedback, and overrides;
- preserve the model when an owner adjustment is saved or cleared;
- keep all enrichment tables outside PowerSync;
- verify Catalog and Wine Detail on desktop and phone, including narrow layouts.
