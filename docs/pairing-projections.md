# Food-pairing projections

Roadmap step 0.4.9 turns the reviewed pairing proof of concept into an
explainable, household-safe recommendation workflow. A user describes the dish
being served; CellarManager compares it only with bottles currently in that
household and returns conservative candidates with reasons, cautions, maturity,
quantity, and physical location.

The recommendation is a structural estimate, not a claim that a source tasted
the exact bottle. It never changes the wine, holding, maturity model, or shared
knowledge in response to one person's preference.

## Reviewed dish knowledge

`enrichment_dish_profiles` is the eighth typed profile layer in an immutable
knowledge version. A reviewed dish profile has a stable key, display name,
description, and nine bounded attributes from 0 to 5:

- intensity, fat, acidity, sweetness, salt, umami, and spice describe the dish;
- protein and fish distinguish preparations where tannin or freshness matter.

`install_pairing_knowledge()` copies the complete published v3 maturity
hierarchy and its provenance into v4 and adds the ten acceptance dishes.
`install_expanded_pairing_knowledge()` then copies that immutable version into
v5, adds 22 common archetypes, and publishes 32 dishes atomically. Both
installers are idempotent and the canonical payload includes every typed
profile, so the content hash covers both wine and dish knowledge.

`install_refined_pairing_knowledge()` publishes v6 without rewriting v5. It
separates traditional Maury vin doux naturel from the explicitly labelled dry
Maury Sec identity. The official appellation requires the Sec term for the dry
form; a plain Maury identity therefore no longer inherits an ambiguous
medium-sweet profile.

The categories span vegetables, fish and seafood, poultry and pork, meat and
game, pasta/rice/pizza, spiced dishes, cheese, and desserts. A custom neutral
profile covers recipes that do not fit a named archetype and opens its
structural controls immediately. Every named profile is still only a starting
point: the user can adjust all nine attributes for the actual recipe without
mutating reviewed shared knowledge.

## Wine-side profile preparation

The `pairing-profile` demand produces one current `wine-profile` projection per
supported household wine. It normally reuses the active maturity projection's
reviewed structural traits and exact provenance. Pairing does not maintain a
second independent opinion of the wine.

Non-vintage Champagne needs a narrow exception. When an exact reviewed place
and colour profile exists but maturity cannot be anchored without a vintage,
pairing may use that place's structural traits at lower confidence. It does not
invent a vintage, a drinking window, or maturity readiness. Unsupported or
ambiguous wines remain explicitly unevaluated.

The service-only worker processes bounded batches every minute. New knowledge,
relevant wine edits, or new wines requeue the existing durable demand; cellar
inventory writes and offline synchronization never wait for pairing.

Layered wine adjustments are normalized to the structural 0–5 scale before
pairing. Crossing a boundary is recorded as a projection warning; it does not
discard an otherwise reviewed profile or feed an out-of-domain value into the
score.

## Scoring and safety boundaries

`get_pairing_suggestions()` scores only positive, in-stock holdings. It combines
the selected dish structure with the reviewed wine structure and, when
available, the current maturity state. The model accounts for:

- intensity balance;
- sufficient acidity for acidic or fatty dishes;
- sufficient sweetness for sweet dishes;
- tannin with protein and tannin risk with fish or high umami;
- savoury affinity, salt, spice/heat, alcohol, and freshness;
- readiness penalties for bottles that should still be held;
- an explicit fresh, light, rich, savoury, or mature style preference.

A strong sweetness deficit is a hard rejection, so a dry wine is never proposed
for a clearly sweet dessert merely because other dimensions score well. Spice
is a calibrated risk rather than an automatic rejection of every red wine.
Colour selections are explicit filters; leaving all colours unchecked considers
every colour.

The inverse direction is also guarded: a wine materially sweeter than a savoury
dish is penalised and then rejected beyond a conservative boundary. The narrow
reviewed exception is a strongly salty, umami-rich dish such as blue cheese,
where sweet-savoury contrast is intentional. This prevents dessert wines and
vins doux naturels from surfacing for mildly sweet meat dishes merely because
their intensity or aromatic structure scores well.

The browser receives labels such as `Excellent match`, `Strong match`, or
`Possible match`, plus concise reasons and cautions. It does not present the
internal score as scientific precision. If nothing clears the safety threshold,
the closest rejected candidate can explain why without becoming a suggestion.

The scorer is versioned independently from immutable shared profile knowledge.
Persisted recommendations created after the bidirectional sweetness guard record
`pairing-score-1.2.0`; previous dish-specific projections are superseded and
retain `pairing-score-1.1.0`. Personal feedback stays attached to the historical
projection and remains available to later ranking, so an algorithm correction
does not erase an owner review.

## Personal refinement and repeated acceptance

`wine_pairing_preferences` stores colour and style defaults by household, user,
and dish. It is service-only and exposed through a membership-checked RPC.
Ingredient adjustments remain request-specific; remembered defaults cannot
silently alter the shared dish definition.

After seeing a suggestion, the user can mark it useful, questionable, or wrong.
The verdict is stored on that attributable projection. A later request by the
same user for the same dish profile finds the latest verdict for that wine and
applies a bounded personal adjustment. Feedback therefore changes personal
ranking, not reviewed wine facts or another member's recommendations. The
explanation says when previous feedback affected the result.

## Online, security, and data boundaries

Pairing advice requires a connection. Wines and inventory remain available
offline through PowerSync, while dish profiles, preferences, jobs, evidence,
and projections stay outside its publication.

Browser roles can call only narrow, security-definer RPCs to:

- list active reviewed dishes and the caller's saved defaults;
- save or clear that caller's defaults;
- request bounded household suggestions;
- review one suggestion belonging to their household.

All calls verify authentication and household membership. Service tables use
RLS, are not directly writable by browser roles, and never expose another
household. Recommendation context retains the exact knowledge version, wine
profiles, evidence, input fingerprint, calculation time, and requesting user
context needed to reproduce it.

## Acceptance checks

- reset and migrate an empty local database;
- preserve immutable v4 and v5, then publish v6 with the complete wine
  hierarchy, exactly 32 reviewed dish archetypes, and distinct Maury and Maury
  Sec profiles;
- reproduce stable content hashes and idempotent installers;
- prepare normal vintage wines and a reviewed NV Champagne structure without
  inventing maturity;
- preserve profile and evidence provenance in wine-side projections;
- recommend only in-stock bottles and return their cellar/location quantities;
- refuse unsafe dessert matches and explain the closest rejection;
- apply colour and style preferences explicitly;
- keep saved defaults and repeated feedback scoped to the current member;
- prove a previous verdict changes that member's later ranking;
- enforce household isolation and reject malformed attributes or preferences;
- remain usable on phone without horizontal navigation or card overflow;
- leave wines, holdings, cellars, locations, and bottle quantities unchanged.

Owner acceptance should exercise several dishes and repeat at least one request
after recording each kind of verdict. A green automated suite proves the data
and security contracts; it does not replace judging whether the suggestions are
actually useful at the table.

## Production preparation

The additive migrations and reviewed v4 through v6 knowledge were applied to the
linked production project on 2026-08-25. Aggregate cellar state was identical
before and after: 765 wines, 1,207 bottles across 826 holdings, eight cellars,
and 156 locations. The immutable v5 snapshot contains 265 profiles; active v6
adds the distinct Maury Sec structural profile while retaining the same 32
dish archetypes. V6 contains 266 profiles with content hash
`5be69cf1f37fb8e151e4efc06d63f0ce0c6d475d16289f34025ba646baa6ac07`.

Bounded workers produced 719 current v4 maturity projections and 724 wine-side
pairing profiles; the five additional profiles are structural-only fallbacks
where a calendar maturity anchor is unavailable. Forty-one unsupported or
ambiguous wines remain explicitly `needs-review`. All 765 pairing demands are
settled, with no queued, leased, retrying, or failed work, and exactly one
minute worker is scheduled. Production preparation did not create any
dish-specific recommendation: those are calculated only when a household
member requests a pairing.
