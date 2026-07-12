# Testing

## Philosophy

Business logic (`app/core`, `app/storage`, `app/services`) depends only on
the Python standard library, so it can be unit tested with zero
installation. The HTTP layer (`app/api`) is a thin translation on top and is
covered separately with FastAPI's `TestClient`, which does need the real
dependencies installed. This split means you get fast, install-free
feedback on the logic that matters most, and full end-to-end HTTP coverage
whenever you do have the dependencies (locally, or in CI).

## What to run, and when

**Zero installation required** (unit tests + a pure-Python system test that
exercises import -> add/move/remove -> stats -> move-plan -> recommend ->
export end to end, all through the service layer directly):

```bash
cd backend
python3 -m unittest discover -s tests/unit -v
python3 -m unittest tests.integration.test_end_to_end_flows -v
```

**Full suite, including real HTTP requests against the actual FastAPI app**
(needs `pip install -r requirements-dev.txt`):

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

`pytest.ini` points `pytest` at the whole `tests/` tree, and pytest runs
`unittest.TestCase`-based tests natively, so this one command also re-runs
everything from the zero-install step above, plus `tests/integration/test_api.py`.

Note: running `python -m unittest discover -s tests` (i.e. the *whole*
tests folder, not just `tests/unit`) will report one import error for
`tests/integration/test_api.py`, because that file needs `pytest`/`fastapi`/
`httpx` to even import. That's expected, not a bug - either point
`unittest discover` at `tests/unit` specifically (as above), or install the
dev requirements and use `pytest` for everything.

**Frontend logic** (pure functions only - i18n interpolation, the offline
queue, chart rendering - no DOM/IndexedDB, so no browser or npm install
needed):

```bash
node --test frontend/tests/logic.test.js
```

Page modules that touch `document`/`fetch`/`indexedDB` are best exercised
manually in a real browser (open `frontend/index.html` served by the
backend, try the flows) - a full headless-browser test setup (Playwright)
would be a reasonable addition if this project grows a CI budget for it,
but was left out here to keep the frontend's zero-dependency promise.

## Continuous integration

`.github/workflows/ci.yml` installs both requirements files and runs
`pytest` (backend, full suite) and `node --test` (frontend logic) on every
push/PR - since GitHub Actions has normal internet access, this is where
the FastAPI-dependent tests get exercised automatically even if your local
machine hasn't installed them yet.

## Coverage at the time of writing

- Backend unit tests: CSV import/export (header aliasing, delimiter/encoding
  detection, number/date locale parsing), cellar location-rule matching,
  statistics aggregation, the move-plan advisor's readiness scoring and
  capacity constraints, the recommendation engine's filters and keyword
  scoring, password hashing and session tokens, the enrichment
  confidence-merge logic, photo-hash recognition, and the repository layer
  against a real (in-memory) SQLite database.
- One pure-Python integration test drives a full realistic session:
  define cellars -> import a CSV -> add/move/remove bottles -> check the
  journal -> compute stats -> generate a move plan -> get recommendations
  -> export to CSV in French.
- One HTTP-level integration test suite repeats the important parts of the
  above through real requests (auth required, registration closes after
  the first user, CSV upload, stats/moveplan/recommendations endpoints).
- Frontend: i18n interpolation, the offline queue's ordering/dedup/retry
  logic, and the chart renderers (including that they never emit
  unescaped HTML from a wine's/cellar's own text).
