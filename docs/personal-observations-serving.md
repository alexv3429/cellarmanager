# Personal observations and serving guidance

Roadmap step 0.4.10 closes the first owner-feedback loop without weakening the
shared knowledge boundary. A household member can record what they tasted or
learned, retain private producer guidance, and adjust serving advice. None of
those actions rewrites a reviewed shared profile.

## Three distinct kinds of information

Wine Detail labels and stores these separately:

1. **Reviewed estimate** — derived from the active immutable wine profile and,
   when available, its current maturity state.
2. **Household observation** — a dated tasting, producer-guidance, maturity,
   pairing, storage, or other note recorded by a member.
3. **Owner adjustment** — an explicit serving range or maturity window that
   takes priority for this household while leaving the estimate inspectable.

An observation can be visible to the household or only to its author. Other
members may read household-visible observations but only the author may edit or
delete one. The future shared curation workflow may use an observation as a
research signal, but promotion requires separate evidence and review.

## Observation contract

`household_wine_observations` already provides the durable boundary introduced
in 0.4.6. Narrow security-definer RPCs now create, update, and delete:

- tasting notes with optional body, acidity, tannin, and freshness ratings;
- producer guidance with an optional maturity impression;
- maturity observations;
- dish-specific pairing results;
- storage notes and other dated context.

The RPC validates membership, author ownership, visibility, type-specific
fields, rating bounds, note length, and the observation date. Browser roles
retain no direct table-write privilege.

## Serving estimate

Serving guidance is a bounded derived estimate, not a source claim. The server
uses the current reviewed `wine-profile` projection and its body, acidity,
tannin, sweetness, and concentration traits. The current maturity state makes
the aeration advice more conservative for priority bottles.

The result contains:

- a temperature range in degrees Celsius;
- a bounded aeration range;
- direct service, opening ahead, normal decanting, or gentle sediment
  decanting;
- reasons, warnings, confidence, specificity, and calculation time.

Sparkling wine is never automatically decanted. A mature priority bottle is
never assigned prolonged aeration. Missing or malformed reviewed structure
produces no estimate rather than a color-only guess.

`wine_serving_overrides` stores a complete household adjustment separately.
Clearing it immediately reveals the current reviewed estimate again.

## Connectivity and synchronization

Personal guidance is online-only in v0.4.10. It remains outside PowerSync with
licensed enrichment data and cannot delay local-first inventory changes. The UI
states this explicitly when offline. A later roadmap decision is required
before adding a general offline mutation channel beyond inventory operations.

## Acceptance

- reset and migrate a new database through the additive migration;
- derive bounded red, white, sparkling, sweet, and fortified serving ranges;
- protect sparkling and mature priority bottles from unsafe aeration advice;
- add, edit, and delete each member's observations;
- hide personal observations from other household members;
- allow household observations to be read but not edited by another author;
- save and clear serving and maturity adjustments without changing the model;
- reject cross-household reads and direct browser writes;
- preserve every wine, holding, cellar, location, and bottle quantity;
- verify Wine Detail on desktop and phone without horizontal overflow.
