# Maturity and pairing inference proof of concept

Roadmap step 0.4.5 found that the trialable online providers do not supply a
safe exact-release baseline for both drinking windows and food pairings. This
proof of concept tests a complementary approach before CellarManager commits to
production tables, background jobs, or user interface work.

The POC is deliberately isolated:

- it writes nothing to Supabase, PowerSync, or a household cellar;
- the 20-wine owner sample and generated review page remain under the
  gitignored `.provider-trials/` directory;
- the committed knowledge file contains public profiles and source metadata,
  not the owner's holdings or locations;
- every range is labelled as a model hypothesis rather than a source claim.

## Question being tested

Can CellarManager produce useful, explainable maturity priorities, storage
actions, and pairings by combining progressively more specific evidence?

1. place/appellation and colour style
2. place-and-colour vintage profile
3. producer-era style
4. cuvée/site profile
5. private owner observations

Missing layers lower confidence instead of being silently invented. A source
can support a factual input without claiming the resulting drinking range. For
example, INAO supports the legal colour and structural description of
Pic Saint-Loup; CellarManager remains responsible for clearly labelling the
derived maturity hypothesis.

## Private cohort

The workbook cohort contains 20 in-stock wines selected to expose model
behaviour rather than maximize easy coverage:

- seven Bourgogne reds and whites, including same-cuvée vintage comparisons;
- seven Pic Saint-Loup/Languedoc wines, including a white wine whose stored
  appellation conflicts with the official red/rosé-only Pic Saint-Loup scope;
- six Piemonte wines, including 2006, 2008, 2017, and 2018 Nebbiolo releases
  and two different 2018 Conterno Fantino crus.

The workbook's existing formula/manual ranges are shown side by side as a
benchmark. They are not treated as ground truth. In particular, Piemonte uses
its own Barolo/Barbaresco, vintage, producer, and cru profiles rather than the
workbook's Burgundy proxy.

## Model outputs

For each wine the POC returns:

- a first-trial range;
- a likely-best range;
- a deliberately later suggested drink-by year;
- `hold`, `start assessing`, `likely ready`, `prioritize`, or later-assessment
  state;
- aging/service storage purpose and a move-one-bottle hint;
- confidence, contributing profiles, evidence links, and missing-data warnings.

Pairing uses the same current wine profile but scores a separate dish profile:
intensity, fat, acidity, sweetness, salt, umami, spice, protein, and fish. The
score includes maturity and urgency, so a theoretically compatible bottle can
be penalized when it should still be held. The engine may return no suitable
bottle; it is not required to manufacture an answer.

The ten POC dishes cover vinaigrette salad, roast chicken and mushrooms, duck
with cherry sauce, grilled beef, salmon with lemon, spicy lamb tagine, tomato
pasta, mushroom risotto, aged cheese, and fruit tart.

## Current local run

The 2026 private run produced:

| Signal | Result |
|---|---:|
| Wines inferred | 20/20 |
| Confidence | 5 high, 12 medium, 3 low |
| Dish scenarios with at least one suitable suggestion | 8/10 |
| Evidence sources used | 16 |

The three low-confidence cases are intentional and useful: a producer/cuvée
without reviewed profiles, the Pic Saint-Loup white conflict, and a generic
Barbaresco without a reviewed producer profile. Piemonte receives materially
longer and more differentiated horizons than the previous Burgundy proxy.

The two dish scenarios without a suggestion are also intentional safety
signals. The current dry sample should not be presented as suitable for fruit
tart, and the model considers the available bottles a poor match for the spicy
lamb configuration.

## Owner review and decision

The owner reviewed all 20 maturity results and all ten pairing scenarios on
2026-08-21. Only aggregate results and general model lessons are committed; the
row-level validation file remains private.

| Capability | Useful | Questionable | Wrong | Decision |
|---|---:|---:|---:|---|
| Maturity, urgency, and storage | 17/20 (85%) | 3/20 | 0/20 | POC threshold passed |
| Food pairing | 6/10 (60%) | 4/10 | 0/10 | Promising, but below the 70% threshold |

The owner judged this inference-first result more accurate than the complete
online-provider trial. The three questionable maturity results were bounded
timing adjustments rather than reversed advice: one white Languedoc wine
should probably be consumed earlier, and two suggested drink-by years may be slightly
too long. There was no accepted colour/style contradiction and no systematic
regional failure.

The pairing review exposed four concrete shortcomings rather than unsafe
accepted answers:

- ingredient structure needs real wine acidity, not only an appellation-level
  assumption;
- colour/style preferences need to be expressible for dishes such as tomato
  pasta and vinaigrette salad;
- the spice penalty needs calibration so a mature suitable red is not excluded
  automatically from a lamb tagine;
- personal preferences, such as choosing an older white with hard cheese, need
  to refine rather than silently rewrite the shared model.

The architecture is therefore accepted for production design: CellarManager
will own a reviewed, versioned place/vintage/producer/cuvée knowledge library
and derive labelled recommendations from it. Online sources remain attributable
evidence and quality benchmarks, not mandatory runtime authorities. Maturity
can proceed from the validated POC. Pairing must correct the recorded gaps and
repeat the owner review before the production pairing step is accepted.

## Run and review

Use a private sample shaped like
`scripts/enrichment/inference_poc.sample.example.json`:

    npm run enrichment:inference -- \
      --sample .provider-trials/inference-poc-sample.json \
      --output .provider-trials/inference-poc-review.html

Open the generated HTML locally. For every wine, classify the maturity result
as useful, questionable, wrong, or unsure and add a note where necessary. Do
the same for every dish, then select **Export my validation**. The downloaded
JSON remains private and is used only to aggregate the decision.

Review these points in particular:

1. Do successive vintages of the same wine move in a plausible direction?
2. Are Piemonte horizons more credible than the old Burgundy substitution?
3. Would the hold/service/priority advice change a real storage decision?
4. Are the pairing suggestions useful for choosing tonight's bottle, not just
   generically compatible?
5. Do low confidence and warnings appear where your own knowledge is weakest?

Each capability passes the POC only when there is no accepted colour/style
contradiction, at least 75% of maturity conclusions are useful, at least 70% of
dish scenarios are useful, and no region shows a systematic failure. A failed
threshold causes profile/rule revision and another private run before that
capability ships; it does not get hidden by lowering confidence. One capability
may still validate the shared architecture without falsely passing the other.

## Known limitations

- The age parameters are small curated hypotheses, not statistically trained
  estimates or licensed critic windows.
- Local Languedoc vintage coverage is currently based mainly on private owner
  observations and needs stronger public evidence.
- Producer style is not yet versioned by era in the POC data.
- Pairing is structural and explainable, but it does not yet model detailed
  ingredients, preparation, sauce separately, or personal taste.
- The first owner review validated maturity but not pairing. The production
  pairing step must rerun this acceptance test after the recorded gaps are
  addressed.
- A positive POC validates the direction only. Production still requires a
  normalized, versioned, provenance-aware database and reviewed publishing
  workflow.
