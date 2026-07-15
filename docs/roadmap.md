# Roadmap & honest status

An explicit map from the original requirements to what's here, so it's
clear what to trust as-is versus what to build out further. "Tested" below
means there's an automated test exercising it, not just that it was
written.

## Fully implemented and tested

| # | Requirement | Where |
|---|---|---|
| 1, 2 | CSV import, mandatory + optional fields, blanks allowed where sensible, including sweet white/red colour aliases | `services/csv_io.py` |
| 3 | Cellar definitions (purpose 0-10, overflow, capacity, threshold, location rule, name) | `core/domain.py: Cellar`, `services/cellar_rules.py` |
| 4 | Import into DB + journal | `services/csv_io.py`, `storage/repositories.py: movements` |
| 5.a-c | Add / edit / move / remove, with journal, optimistic concurrency and integrity-checked transactions | `services/holdings_service.py`, `services/bottle_edit_service.py` |
| - | Unified Add inventory: manual/existing-wine/ChatGPT/optional vision, normalized Acquisition/allocation, local media and editable AI candidates | `api/routers/inventory.py`, `services/inventory_service.py`, `services/media_service.py` |
| 5.d | Statistics (counts, %, price, drink-window buckets; total and per cellar) | `services/stats_service.py` |
| 5.e | Move-plan advisor (profile-aware, capacity-aware, color-diverse) | `services/moveplan_service.py` |
| 8 | Offline data-integrity mechanism (versioning + client-op-id dedup) | `storage/repositories.py`, `frontend/js/offlineQueue.js` |
| 9 | Authentication, no open sign-up, hashed passwords, login throttle | `services/auth_service.py`, `api/routers/auth.py` |
| 10.a | Ranked "what should I open" recommendations | `services/recommendation_service.py` |
| 10.b | All locations for a given wine | `services/holdings_service.py: locations_for_wine` |
| 10.c | CSV export, column selection/order, language | `services/csv_io.py: export_csv` |
| - | English/French UI, easily extended | `docs/i18n.md` |
| - | Unit + integration tests plus a protected pre-merge CI gate | `docs/testing.md`, `docs/github-protection.md` |

## Historical mock enrichment implementation (superseded)

> The section below documents the former deterministic mock providers. It is retained for audit history but is no longer the active HTTP/UI path. See `docs/internet-enrichment.md` and the current status section at the end of this document.

| # | Requirement | Status |
|---|---|---|
| 5.f, 5.g | Fetch drink-window/price from several sources and compute the best window, compared to existing data | Fully implemented and tested, and genuinely multi-source: every registered provider is queried, and the results are combined into one estimate via a confidence-weighted mean, with the combined confidence adjusted up when independent sources agree closely and down when they disagree (`services/enrichment.py: aggregate_drinking_windows`, `aggregate_market_info`). That combined estimate then goes through the same "never auto-overwrite a manual value" merge logic as before. What's *not* real: the three registered providers are simulated (`MockEnrichmentProvider` with different "conservative/generous/community" profiles, deliberately disagreeing so the aggregation has something real to combine) rather than actual internet-connected sources. |

**Why not wired up to real wine sites?** Two reasons, not just effort:
this sandbox has no internet access to build/test scrapers against, and
more importantly, every real source (Wine-Searcher, iDealwine, Vivino,
CellarTracker...) has its own terms of service - some require a paid API,
some prohibit scraping outright. That's a decision (and possibly a
contract) for you to make per source, not something to bake in as a
silent default. To go live: implement `EnrichmentProvider` (two methods)
against each source you're licensed to use, and list them in
`get_active_providers()` - the fetch-many/combine/merge/journal logic
already works for any number of providers, real or mock.

| # | Requirement | Status |
|---|---|---|
| 7 | Legacy/secondary photo recognition | Two complementary signals remain available for matching bottles already in the catalog; the primary intake path is now the unified manual or AI-assisted Add inventory workflow. The legacy signals are: **OCR label reading** (`services/recognition_service.py: extract_label_text`, via `pytesseract`/`tesseract-ocr`) reads the text off a photographed label and fuzzy-matches it against your catalog's producer/cuvée/appellation/vintage (`difflib`-based, tolerant of common OCR misreads) - this works for *any* wine already in your catalog, not just ones photographed before. **Perceptual photo-hash matching** is kept as a second signal for when a label doesn't OCR well (handwritten, stylized, partly obscured) or to confirm "this is the exact bottle I catalogued before". `recognize_bottle()` runs both and combines them, and each signal degrades independently and gracefully if its dependency (Pillow / pytesseract / the tesseract-ocr binary) isn't installed. |

OCR quality depends on which Tesseract language packs are installed on the
host; only English is guaranteed out of the box via `pip install
pytesseract` alone; the `tesseract-ocr` *system* package (and the optional
`tesseract-ocr-fra` pack, recommended since wine labels are commonly
French) still need to be installed separately - see `requirements.txt` and
`docs/setup.md`. It also still won't out-perform a clean, well-lit photo
of a legible label; heavily stylized or handwritten labels may OCR poorly,
which is exactly when the photo-hash signal helps most.

## Implemented at a basic/functional level ("nice to have" per the spec)

| # | Requirement | Status |
|---|---|---|
| 6 | Visual cellar representation + drawing helper | A rack-based layout editor exists (choose rows/columns/shape - grid or diamond bins - per rack, rendered as SVG) in `frontend/js/pages/cellars.js`. It's a structured "compose rectangles/diamonds" tool rather than freeform drawing, which keeps it dependency-free and reliable; a freehand canvas editor (e.g. via a small library) would be a natural upgrade if the rack model ever feels too rigid for an unusually-shaped space. |

## Explicitly out of scope for this version

* **Two-factor authentication / passkeys** - see `docs/security.md`.
* **Automated backups** - back up the SQLite file yourself (or point
  `WINECELLAR_DB_PATH` at an already-backed-up location).
* **Headless-browser (Playwright/Selenium) tests for the page modules** -
  the pure-logic frontend code is unit tested (see `docs/testing.md`); the
  DOM-touching pages are best verified by hand in a browser for now.
* **Multiple-location allocation in one Add inventory operation** - the current
  transaction assigns the full quantity to one Holding/location; split it with
  later moves until multi-allocation UI support is added.
* **S3-compatible media storage** - local filesystem storage is the current
  default and backups must include the media directory.
* **Automatic currency conversion and currency-aware aggregate statistics** -
  normalized Acquisitions preserve their original three-letter currency, but
  cross-currency conversion requires an exchange-rate source and policy. Legacy
  Holding prices and market values remain plain numeric compatibility fields.

## If you only do three things next

1. Set a real `WINECELLAR_SECRET_KEY` and put this behind HTTPS before
   using it from outside your own network (`docs/security.md`).
2. Decide on a real enrichment data source (or skip it - everything else
   works fine without it) and implement one `EnrichmentProvider`.
3. Try the rack layout editor against your actual cellar's shape and adjust
   `frontend/js/pages/cellars.js` if the grid/diamond model doesn't fit.


## Development workflow status

The repository now has a locked uv environment, Ruff lint/format enforcement, local commit/push hooks, backend tests across Python 3.11–3.13, frontend checks on Node 22, dependency review, Dependabot, a stable aggregate `CI Gate`, and a script/recipe to protect `main`. Remaining testing work is primarily real-browser system coverage and agreeing a coverage percentage that can be raised over time.

## Evidence-backed enrichment status

Implemented: real OpenAI web-search mode, optional Brave discovery, strict
structured extraction, clickable evidence, deterministic confidence, drinking
window/maturity, normalized market observations and retail/secondary/quick-sale
candidates, pairing/serving/composition/review/identifier candidates, explicit
review, budgets, history and recommendation integration.

Still provider-specific: licensed Liv-ex/auction/critic adapters, currency
conversion, bottle-condition/provenance appraisal and a durable multi-process
worker. Those require contracts or deployment choices and are documented rather
than simulated.
