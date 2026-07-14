# Contributing to CellarManager

Thank you for improving CellarManager. All changes go through a branch and a
pull request; direct pushes to `main` are blocked once repository protection is
activated.

## First setup

```bash
./scripts/bootstrap_dev.sh
```

This installs the locked uv environment, applies the one-time Ruff migration,
installs local Git hooks, and runs the same checks required by GitHub.

## Normal change cycle

```bash
git switch -c type/short-description
# edit files
make format
make ci
git add -A
git commit
git push -u origin HEAD
```

Open a pull request and wait for **CI Gate**. Do not merge while it is pending or
failing. Keep the branch up to date when GitHub requests it.

## Dependency changes

`pyproject.toml` and `uv.lock` are authoritative. The files in
`backend/requirements*.txt` are generated compatibility exports.

```bash
uv add PACKAGE
# or: uv add --dev PACKAGE
make requirements
make ci
```

Commit all changed dependency files together.

## Documentation and tests

Every behavior change needs a regression test and documentation when it affects
users, operators, security, architecture, data formats, or contributor work.
The pull-request template records the required evidence.

See:

- [`docs/development.md`](docs/development.md)
- [`docs/testing.md`](docs/testing.md)
- [`docs/github-protection.md`](docs/github-protection.md)
- [`docs/security.md`](docs/security.md)

<!-- modern-dev-portability-fix -->
## Portable uv lock files and virtual environments

The committed `uv.lock` must use public, portable package sources. It must not
contain developer-specific, corporate-only, or build-environment registry URLs.
Generate or verify it with `make lock` and `make ci`; the repository policy check
rejects known private build-registry references.

CellarManager's uv environment is the repository-level `.venv`. If an older
`backend/.venv` is active, deactivate it or run `unset VIRTUAL_ENV` before setup.
The bootstrap script also ignores that obsolete activation automatically.

If dependency installation fails against `pypi.org` or
`files.pythonhosted.org`, inspect corporate proxy/TLS settings. A failure against
`internal.api.openai.org` means an old, non-portable lockfile is still present.

## Enrichment changes

Provider and extraction changes require deterministic tests with fake transports.
Do not add live API calls to CI, embed credentials, scrape protected sites or
weaken source/identity checks. Run `make format` and `make ci` before opening a
pull request, and update `docs/internet-enrichment.md` when provider behavior or
configuration changes.
