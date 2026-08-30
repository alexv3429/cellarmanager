# Reviewed enrichment research

Roadmap step 0.4.14 connects the catalog curation queue to bounded web
research without making web output a source of truth. A household owner can
request missing fact or profile research, inspect the sources and structured
proposal, accept, edit, or reject it, and follow its publication status.

## Lifecycle

The durable flow is:

`household request -> allowlisted research -> inactive attributed draft -> owner review -> trusted versioned publication`

1. The owner requests research from one item in the catalog's prioritized
   queue. Cellar-data errors such as a missing vintage are not researchable;
   they still require a local correction.
2. `request_enrichment_research` resolves a canonical shared subject. A
   producer or cuvee needs a confirmed shared reference or a household's
   explicit producer decision. Raw cellar text alone stops at
   `needs-identity-review`. For a producer profile, the inbox can offer a
   producer-level LWIN identity even when the exact cuvee is absent from LWIN;
   the owner sees example wines before confirming the household alias. Other
   subject types link to the representative wine's exact LWIN review.
   If the representative wine is renamed during review, both the original
   cellar wording and the corrected wording remain explicit household aliases
   of the confirmed canonical producer.
   Confirming either route automatically rebinds only that household's
   subscription to the canonical shared subject and resumes the request;
   another household using the same raw text must make its own identity
   decision.
3. The scheduled Cloudflare Worker claims only the shared subject, its exact
   source rules, and bounded source suggestions. It receives no household,
   member, location, holding, or wine identifier.
4. Existing rules provide deterministic entry pages. For a new subject, a
   search provider can propose several complementary candidates from reviewed
   institutional, technical, and editorial domains plus plausible producer
   sites. The worker keeps at most four distinct hosts, checks HTTPS safety,
   restricted redirects, `robots.txt`, response type, page-size limits, and
   visible producer/wine relevance, and rejects unusable candidates.
   A household owner can also submit an advanced fallback URL. Browser input
   only creates a candidate; it cannot approve a rule or publish knowledge.
5. Accepted candidates become narrowly scoped pointer-only rules for that
   subject. Cloudflare Workers AI compares all usable pages and synthesizes one
   bounded JSON proposal. Corroborated claims are preferred; disagreement must
   lower confidence or remove the claim. Page text is
   treated as untrusted evidence, is not retained, and cannot issue
   instructions to the worker. Search-result payloads are not retained either.
6. The owner sees the direct source URLs, retrieval date, rationale,
   confidence, and every proposed value. Accepting records the unchanged draft;
   editing records a separately validated structured proposal; rejecting keeps
   the shared library unchanged.
7. A service-only publisher revalidates the accepted proposal and active source
   rules. A fact becomes an immutable reviewed claim. A profile is added by
   cloning the complete active knowledge release, adding the reviewed profile,
   and atomically activating the new version. Existing profiles, dish profiles,
   evidence links, and household facts are preserved.

The research inbox distinguishes queued, researching, source/identity review,
draft ready, owner reviewed, failed/retrying, and published states. Publication
creates a new unread notification. Nothing is copied into a household fact
until the owner later chooses **Fill missing reviewed facts** and saves the wine.
The catalog curation queue follows the same state: it links to required identity
or draft review, reports research and publication waits, and offers a new or
retry request only when that action is valid.

## Source and rights boundary

An active `enrichment_research_source_rules` row is an executable allowlist,
not a general recommendation to search the web. It binds:

- one reviewed `enrichment_source_policy` with current display, retention, and
  cross-household pointer-reuse rights;
- one exact lowercase HTTPS hostname and a path boundary;
- explicit subject and claim kinds;
- optional normalized subject aliases so one producer's site cannot support a
  different producer;
- a bounded query template and page limit.

The initial production rules are deliberately narrow. The official Jean-Marc
Burgaud, Château de Cazeneuve, and Dureuil-Janthial sites support only their
respective producer-style research. The attributed Frantz Chagnoleau page from
Artisans Vignerons de Bourgogne du Sud supports Chagnoleau while the producer's
own site is unavailable. Every policy is pointer-only: CellarManager may retain
and show the URL, retrieval time, attribution, and reviewed derived profile,
but not the source page or search response.

Official producer material is one useful source class, not a requirement or a
universal authority. Depending on the claim, reviewed sources may include
regulatory or appellation bodies, producer associations, institutional wine
boards, attributed technical sheets from established importers or distributors,
and established editorial references whose access and reuse terms permit the
intended use. Reliability is assessed per claim and subject; a source trusted
for identity or grape composition is not automatically trusted for maturity or
pairing.

A new producer or appellation without a reviewed rule appears visibly as
**Source review pending** while generic discovery looks for usable evidence.
This is a durable workflow state, not a terminal result and not a request for a
new code migration. When automatic discovery misses a page, the advanced owner
form can submit a direct HTTPS URL; it passes the same checks and automatically
resumes the request. Adding or reactivating any compatible reviewed rule also
resumes every affected request. Retiring a rule immediately prevents new
research and publication from it while preserving historical provenance. Step
0.4.20 audits unresolved high-impact requests and current cellar coverage
before the v0.4 release; source rules and reviewed immutable knowledge versions
remain continuously extensible after release.

## Governance scheduled before v0.4 release

Step 0.4.17 adds an explicit **Report an error / request review** path for a
published fact or profile. A report is private to its submitter until processed,
can include comments or proposed evidence, and joins an existing open case for
the same canonical subject instead of starting duplicate research. Its state
and outcome remain visible to the reporter. A report alone never edits,
unpublishes, or lowers the canonical profile silently.

The implemented profile path starts from the exact reviewed contribution in a
current maturity projection. A stable typed subject key deduplicates reports
across immutable knowledge-version profile UUIDs and across accounts. The case
is shared, but subscriptions and message threads remain private to each
reporter. The Catalog inbox exposes only the current reporter's comments,
evidence, notifications, and trusted outcome; see
[`profile-review-requests.md`](profile-review-requests.md).

Step 0.4.18 adds the human governance that follows a report. Trusted-curator
eligibility and claim scope are explicit; reviews, disagreements, evidence, and
publication decisions are attributable and auditable. An accepted correction
creates a new immutable profile and knowledge version that supersedes the old
one. The interface exposes the relevant before/after comparison and historical
versions; published rows are never edited in place. The service publisher
remains the only component allowed to activate a validated version.

Step 0.4.19 keeps taste separate from facts. A member may privately shift
canonical maturity guidance toward younger or older drinking, see the canonical
and adjusted results, and reset the preference. The shift affects only that
member's recommendations; it is not evidence, does not change the shared
profile, and is not exposed to another account or household.

The HTML extractor excludes scripts, styles, and off-screen hidden elements
before the bounded text reaches the synthesis model. This protects research
from age-gate decoration, injected SEO text, and other content that a person
does not see on the source page; the remaining page is still treated as
untrusted evidence rather than instructions.

## Facts and profiles

Research currently supports:

- country, grape composition, sweetness, and label alcohol facts;
- place baselines or adjustments;
- place-and-vintage adjustments;
- time-bounded producer-era adjustments;
- cuvee/product adjustments.

The model cannot invent exact grape percentages, vintages, tasting history, or
drinking years. Research confidence is capped at 0.85 generally and 0.70 for a
broader producer profile. A named cuvée's characteristics cannot silently
become producer-wide characteristics; unsupported producer axes stay neutral.
Drinking-window adjustments are integer years from -5 to +10, structure
adjustments are -2 to +2, absolute place traits are 0 to 5, and place drinking
ages must be ordered. The database independently enforces the same bounds for
worker output and browser edits.

The owner-facing summary translates internal offsets into their practical
effect—such as delaying the first tasting or extending the final drink-by
estimate. These offsets modify the place-and-vintage estimate for each bottle;
they are not four separate recommendations and are not fixed drinking dates.

This step improves the existing hierarchical inference model; it does not
replace it with provider drinking windows. A safe place/vintage assessment can
remain active while producer or cuvee research is pending.

## Worker configuration

`wrangler.jsonc` binds Cloudflare Workers AI as `AI`, serves the built PWA as
`ASSETS`, and runs the research cycle every 15 minutes. Each cycle publishes up
to two reviewed drafts and researches up to two queued subjects. Publication
can continue with Supabase configured even if web research credentials are
temporarily unavailable.

The deployed Worker requires these secrets or environment values:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Set them without placing values in the repository:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
```

`TAVILY_API_KEY` is the preferred optional discovery provider. A basic query
returns candidate URLs for a new subject; CellarManager does its own source
class, relevance, fetch, and provenance checks and stores neither Tavily
snippets nor page bodies. `BRAVE_SEARCH_API_KEY` is a compatible fallback and
can also locate additional pages inside an existing reviewed boundary. Without
either key, deterministic rules and advanced owner-supplied URLs still work,
but automatic discovery of a brand-new producer pauses visibly.

`SUPABASE_SECRET_KEY` must be a current `sb_secret_…` server key (or a legacy
service-role JWT) able to call the service-role RPCs. It is never included in
the browser bundle. `/api/research/status` exposes
only readiness booleans and never returns secret values. The current worker
uses `@cf/meta/llama-3.1-8b-instruct-fp8-fast`; any model change must retain the
same validation and review boundaries.

## Security and privacy properties

- Browser roles cannot read research tables, claim global cases, write drafts,
  or publish knowledge; narrow security-definer RPCs enforce household
  membership and owner actions.
- The worker claim omits household and wine IDs. Shared cases deduplicate by
  canonical subject, while household subscriptions and notifications remain
  private.
- Search results and source HTML are transient. Published evidence is
  pointer-only and immutable.
- Exact HTTPS host/path checks run both in the worker and in database triggers.
  Redirects cannot leave the approved boundary.
- One rejected, malformed, or failed case does not change existing facts,
  profiles, projections, inventory, or storage data.
- Profile publication clones the entire active release before activation;
  partial releases cannot silently discard existing maturity or pairing
  knowledge.

## Validation

The focused automated boundary consists of:

```bash
node --test scripts/enrichment/research_worker.test.mjs
npm run supabase -- test db supabase/tests/database/research_source_suggestions.test.sql
npm run supabase -- test db supabase/tests/database/reviewed_enrichment_research.test.sql
npm run web:test -- --run src/data/enrichmentResearch.test.ts src/data/wineFacts.test.ts
npx wrangler deploy --dry-run
```

The pgTAP flow uses synthetic Burgaud data and verifies request isolation,
lease ownership, exact source attribution, owner review, hostile edit rejection,
service-only publication, complete knowledge-version cloning, immutable
pointer-only evidence, notifications, and browser denial. Production household
data is not used as test input.
