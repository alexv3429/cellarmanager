# Private maturity calibration

Roadmap step 0.4.19 lets one signed-in member express a general timing taste
without turning that taste into shared wine knowledge. A member may shift every
canonical maturity window by one, two, or three years younger or later. Reset
returns immediately to canonical timing.

## Precedence and calculation

CellarManager keeps three distinct layers:

1. the immutable canonical projection remains the shared, evidence-backed
   calculation;
2. an optional private member calibration shifts all four canonical years by
   the same bounded integer, preserving the width and chronological shape of
   the window;
3. an explicit per-wine manual window remains the highest-priority instruction
   and temporarily suppresses the general calibration for that wine.

The personal state and catalog urgency are recomputed from the shifted years at
read time. The canonical projection is not recalculated, copied, superseded, or
mutated. Because the shift is derived at read time, changing or resetting it is
immediate and does not enqueue enrichment work.

Storage advice continues to use the canonical projection. A general taste
preference does not move bottles or silently rewrite a location purpose. The
existing explicit per-wine storage override remains available when a member
wants a different physical instruction.

## Interface

Wine Detail shows the effective recommendation first. When calibration is
active, it also shows the canonical and private windows side by side, names the
signed shift, and explains that the setting applies to every assessed wine for
the current account. A manual per-wine window displays a clear precedence
notice.

Catalog status, urgency ordering, drink-by years, and the online Excel maturity
snapshot use the effective member guidance. Personalized catalog badges and
export provenance identify that a private timing shift was applied; they do not
mislabel it as canonical confidence or as a manual wine window.

## Privacy boundary

The preference is stored by authenticated user ID in the non-exposed `private`
schema. It carries no household, wine, producer, profile, evidence, or canonical
knowledge identifier. Browser roles have no direct table privileges and manage
the setting only through authenticated security-definer RPCs.

Two members of the same household may therefore receive different effective
dates from the same canonical projection. Neither can read the other's shift.
The preference follows the signed-in account wherever that account may access
its wines, but it is never returned to another account and never enters the
PowerSync household dataset.

## Acceptance

- allow only whole-year shifts from three years younger through three years
  later;
- preserve all four canonical years while applying a uniform shift;
- recompute maturity state, urgency, catalog ordering, and export dates for the
  signed-in member;
- show canonical and personal dates together with an immediate reset;
- keep an explicit per-wine manual window above the general preference;
- leave canonical projections, shared profiles, evidence, feedback, research,
  and publication history unchanged;
- prevent direct browser access and cross-account disclosure;
- keep storage guidance canonical unless the existing manual storage override
  is used;
- render the comparison and controls without horizontal overflow on desktop or
  phone.
