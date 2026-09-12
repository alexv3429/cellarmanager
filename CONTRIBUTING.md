# Contributing to CellarManager

All changes go through a short-lived branch and pull request. Direct pushes to
`main` are blocked by the stable **CI Gate** status.

## First setup

```bash
npm ci
```

Copy `apps/web/.env.example` to `apps/web/.env.local` and provide the Supabase
and PowerSync values documented in the root README.

## Normal change cycle

```bash
git switch -c codex/short-description
# edit files
npm run repository:check
npm run web:ci
npm run supabase -- test db  # when database behavior is in scope
npm run inventory:acceptance  # when stock, upload, or device authorization changes
git diff --check
git add <intended-files>
git commit
git push -u origin HEAD
```

Open a ready pull request and wait for **CI Gate**. Do not merge while it is
pending or failing. Keep the branch current when GitHub requests it.

The inventory acceptance suite requires the local Supabase Docker stack with
current migrations. It copies schema only into an isolated temporary database,
runs simultaneous authenticated transactions against synthetic fixtures, then
removes that database. It does not use linked production credentials or existing
cellar data. See [`docs/multi-device-inventory-acceptance.md`](docs/multi-device-inventory-acceptance.md).

## Dependency changes

`package.json` and `package-lock.json` are authoritative. Use `npm install` or
`npm uninstall`, commit both files when they change, and run `npm run audit`
with the normal validation commands.

## Documentation and tests

Every behavior change needs a regression test and documentation when it affects
users, operators, security, architecture, data formats, or contributor work.
The pull-request template records the required evidence.

Keep current-facing documentation in the present tense and update
`docs/product-roadmap.md` before work crosses a milestone boundary. Release
notes, acceptance records, and migration evidence are historical documents;
preserve their recorded facts and add a clearly dated note when later work
changes their context.

The current product lives in `apps/web/`, `supabase/`, and the root Cloudflare
configuration. The retired v0.1 runtime is available only from historical Git
tags and must not be reintroduced into the active tree.

See:

- [`README.md`](README.md)
- [`docs/product-roadmap.md`](docs/product-roadmap.md)
- [`docs/v03-roadmap.md`](docs/v03-roadmap.md)
- [`docs/github-protection.md`](docs/github-protection.md)
- [`docs/adr/`](docs/adr/)

## Branch protection

Repository administrators can restore the documented protection with:

```bash
./scripts/protect_main.sh
```
