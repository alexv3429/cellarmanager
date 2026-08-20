# LWIN reference snapshots

Roadmap step 0.4.3 provides a repeatable, service-only import of the official
LWIN7 dictionary. It deliberately keeps the source cache separate from the
CellarManager UUID-backed identity library introduced in 0.4.2.

## Why the snapshot is a source cache

The official workbook is a dictionary of wine products identified by LWIN7.
It also contains live, combined, and deleted records, normalized display
metadata, vintage configuration, source timestamps, and a successor LWIN when
Liv-ex has combined records. It is not a list of LWIN11 releases or LWIN16
or LWIN18 packages.

Importing every row as a permanent CellarManager product would create hundreds
of thousands of unused identities and would incorrectly make a provider row
look like CellarManager's canonical object. Instead:

1. the complete attributed dictionary is imported into a versioned source cache;
2. matching services search only the fully validated active snapshot;
3. a later confirmed match promotes the relevant producer/product into the
   CellarManager identity hierarchy and attaches LWIN7 as an external ID;
4. a missing LWIN never prevents an internal identity from being created.

Household wine fields are not read or changed by the snapshot importer.

## Attribution and retention

The seeded `liv-ex-lwin` source records the official download URL, the Liv-ex
LWIN homepage, the attribution text, and the Creative Commons Attribution 4.0
International licence. The normalized cache indicates that CellarManager made
changes and does not imply Liv-ex endorsement.

- LWIN: <https://www.liv-ex.com/lwin/>
- Liv-ex licence summary: <https://www.liv-ex.com/lwin-creative-commons-licence/>
- CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>

The workbook itself is never committed. Snapshot metadata retains the SHA-256,
source filename, retrieval time, verified row/status counts, latest provider
update, completion time, and lifecycle state. The importer keeps the active
row set and one superseded row set by default; older row copies can be pruned
while their audit metadata remains.

## Atomic refresh contract

A refresh follows four phases:

1. Download or open the workbook locally, require the exact 22-column schema,
   normalize `NA` sentinels, and validate every row, duplicate, and successor.
2. Create an `importing` snapshot and upload normalized rows in bounded batches.
3. Recount and validate the staged snapshot in PostgreSQL, including missing
   successors and successor cycles.
4. In one transaction, supersede the previous active snapshot and activate the
   replacement. Only then may matching services see it.

An interrupted upload remains invisible. The CLI atomically marks it failed and
removes its incomplete staged rows, so the same file hash may be retried without
leaking storage. Re-importing an already successful hash is a no-op.

## Missing-reference handling

`wine_reference_identifier_demands` is a durable service queue for a
CellarManager product, release, or package that has no requested external ID.
It can remain pending or retrying while connectivity is unavailable. Adding a
matching external identifier resolves the demand automatically. Submission to
a provider and retry scheduling belong to the provider-neutral job
infrastructure in roadmap step 0.4.7; 0.4.3 does not call a provider request API.

The queue and the LWIN cache are service-managed, excluded from PowerSync, and
unavailable to browser roles. The importer can only select and stage snapshots;
status changes and cleanup are restricted to the validated database functions.

## Liv-ex implementation options

The official [Liv-ex implementation guide](https://files.liv-ex.com/Implementation_howtogetstarted.pdf)
defines LWIN7, LWIN11, LWIN16, and LWIN18 as the four complete identifier forms.
CellarManager accepts all four while the public workbook used here remains a
product-level LWIN7 source.

The guide describes manual full-workbook refresh, real-time PUSH updates, and a
Change Since API. Step 0.4.3 deliberately implements the independently usable
full-workbook path. PUSH or Change Since may later replace repeated downloads
when CellarManager has documented Liv-ex API access and operational credentials;
the atomic snapshot boundary remains valid for either transport.

Liv-ex also documents vintage-specific product metadata through an API. That
potential source will be evaluated with the matching and source-rights work; it
is not silently inferred from the LWIN7 workbook.

## Import commands

Validate a downloaded official workbook without contacting a database:

    npm run lwin:import -- --file /absolute/path/LWINdatabase.xlsx --dry-run

Or download and validate the current official snapshot:

    npm run lwin:import -- --dry-run

After the migration is deployed, a trusted operator can perform the import:

    SUPABASE_URL=https://project.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=... \
    npm run lwin:import -- --file /absolute/path/LWINdatabase.xlsx

Use only a server-side service-role key. Never put it in a `VITE_` variable,
browser code, committed file, log, or screenshot. Useful options are
`--batch-size` and `--keep-superseded`; run with `--help` for bounds and
defaults.

## Validation

    npm run lwin:test
    npm run supabase -- test db

The importer tests cover workbook shape, normalization, duplicates, successor
integrity, CLI safety, and credential placement. The PostgreSQL suite covers
atomic activation and refresh, incomplete/dangling/cyclic rejection, bounded
retention, service-only access, attribution, and durable missing-ID demands.
