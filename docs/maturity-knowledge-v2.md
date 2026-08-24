# Expanded maturity knowledge v2

Knowledge v2 expands the production maturity model from the small accepted
proof-of-concept baseline to explicit appellation-and-colour coverage. It is a
reviewed CellarManager model, not a collection of copied critic drinking
windows. Public sources support identity, hierarchy, permitted colour,
structure, and relative ageing potential; CellarManager owns and labels the
derived age ranges.

## Safety boundary

The calculator requires an exact normalized appellation alias and a compatible
colour. It never substitutes the wine's broad area when the appellation is
unknown. A regional name can be assessed only when it is itself the wine's
stored appellation and has an explicit profile.

A result remains `needs-review` and receives no range when:

- vintage is absent, including non-vintage Champagne until a safe date anchor
  is designed;
- appellation is empty or unsupported;
- the reviewed appellation has no profile for the stored colour;
- a generic label such as `Vin de France` is too broad;
- the value appears to be a producer, typo, special product, or ambiguous style.

The demand records one of `missing-vintage`, `unsupported-place-profile`, or
`appellation-color-conflict`, and the household UI explains that reason.

## Reviewed model content

The committed JSON source contains:

- 70 reusable structural archetypes;
- 149 explicit geographic identities and 204 normalized aliases;
- 151 place-and-colour maturity profiles;
- 67 local vintage modifiers for Bourgogne red/white, Beaujolais red,
  Languedoc red/white, Alsace white, and the already accepted Piemonte years.

Place profiles cover the current cellar's named appellations across Bourgogne,
Beaujolais, Languedoc, Rhône, Alsace, Loire, Piemonte, Toscana, Bordeaux,
South-West France, Provence, Champagne, Savoie, southern Italy, and Hungary.
This is coverage-driven, not exhaustive: new places must pass the same review
before a later immutable knowledge version is published.

The private `Caves_2.0` workbook was used only as calibration evidence. Its
holdings, producers, cuvées, comments, and locations are not committed. In
particular, its unsafe cross-region formula proxies were rejected: Piemonte is
not treated as Bourgogne, Rhône is not treated as Languedoc, and Loire/Savoie
are not treated as Alsace.

## Evidence inputs

The reviewed inputs are:

- [Bourgogne Wine Board appellation material](https://www.bourgogne-wines.com/press/gallery_files/site/289/1910/45721.pdf)
  and [vintage archive](https://www.bourgogne-wines.com/press/vintages%2C2333%2C9343.html);
- [Inter Beaujolais appellation profiles](https://www.beaujolais.com/3-univers/pur-terroir-by-beaujolais/),
  including the explicit keeping potential published for Morgon and
  Moulin-à-Vent;
- [CIVL appellation profiles](https://languedoc-wines.com/appellations/terrasses-du-larzac/);
- [Inter Rhône appellation encyclopedia](https://www.vins-rhone.com/sites/vignoble/files/documentation/2025-07/INTER-RHONE-ENCYCLOPEDIE-2025-FR-WEB.pdf);
- [Vins d'Alsace Grand Cru profiles](https://www.vinsalsace.com/fr/grands-crus/);
- [INAO appellation records](https://www.inao.gouv.fr/produit/vouvray-16401);
- [Langhe denomination consortium](https://www.langhevini.it/denominazioni/);
- [Chianti Classico hierarchy](https://www.chianticlassico.com/vino/tipologie/)
  and [Brunello consortium](https://www.consorziobrunellodimontalcino.it/it/586/il-brunello).

The database stores one pointer-only CellarManager methodology evidence record.
It does not store public-source payloads or imply that those organizations
published CellarManager's exact ranges.

## Coverage check

The pre-publication check used a private aggregate of the 602 wines that
knowledge v1 could not assess. It contains area, appellation, colour, vintage
range, and aggregate wine/bottle counts only; it contains no household, user,
producer, cuvée, or row-level wine identity.

Knowledge v2 safely covers 583 of those 602 wines and 927 of 950 bottles. Added
to the 163 wines already covered by v1, the expected total is approximately
746 of 765 wines (97.5%). The remainder is deliberately visible instead of
guessed. Aggregate groups cannot distinguish every partly missing vintage, so
the final production count may vary slightly after row-level recalculation.

## Reproducibility

Validate the committed knowledge and regenerate its deterministic migration:

```bash
node scripts/enrichment/maturity_knowledge_v2.mjs
node scripts/enrichment/maturity_knowledge_v2.mjs --write-sql
```

A private grouped coverage export can be checked with:

```bash
node scripts/enrichment/maturity_knowledge_v2.mjs \
  --coverage /private/path/unsupported-groups.json
```

The migration only installs the service-only idempotent installer. Publishing
remains an explicit production action after user validation:

```sql
select public.install_expanded_maturity_knowledge();
```
