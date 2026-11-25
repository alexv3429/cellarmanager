import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { validateProducerResearchPackage } from './producer_research_package.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

// Match the database's lower/unaccent/alphanumeric lookup for triage only.
// A match here never approves a date, a source, or a proposed alias.
export const normalizeReferenceName = value => String(value ?? '')
  .replaceAll('œ', 'oe').replaceAll('Œ', 'Oe')
  .replaceAll('æ', 'ae').replaceAll('Æ', 'Ae')
  .normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function unique(rows) { return rows.length === 1 ? rows[0] : null; }

function matchingIdentity(rows, aliases, name, entityType, parentId = null) {
  const target = normalizeReferenceName(name);
  if (!target) return [];
  const ids = new Set(rows.filter(row =>
    (parentId === null || row.producer_id === parentId)
    && (entityType === null || row.type === entityType)
    && row.normalized === target).map(row => row.id));
  for (const alias of aliases) {
    if (alias.normalized !== target) continue;
    const id = alias.entity_id ?? alias.place_id;
    const entity = rows.find(row => row.id === id);
    if (entity && (parentId === null || entity.producer_id === parentId)
        && (entityType === null || entity.type === entityType)) ids.add(id);
  }
  return rows.filter(row => ids.has(row.id));
}

function namedOverride(rows, name, label) {
  const matches = rows.filter(row => row.name === name);
  if (matches.length !== 1) throw new Error(`${label}: override must name one canonical record: ${name}`);
  return matches[0];
}

const genericIdentityWords = new Set(['domaine', 'chateau', 'clos', 'cave',
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'a', 'au', 'aux', 'en', 'et',
  'cuvee', 'premier', '1er', 'cru', 'rouge', 'blanc', 'rose', 'vieilles', 'vignes']);
function identityTokens(value, context) {
  const contextWords = new Set(normalizeReferenceName(context).split(' '));
  return [...new Set(normalizeReferenceName(value).split(' ').filter(token =>
    token.length > 1 && !genericIdentityWords.has(token)
    && !contextWords.has(token)))].sort();
}
function assertProductOverrideFits(cuvee, producer, product, label) {
  const context = `${producer.name} ${cuvee.appellation} ${cuvee.region}`;
  const sourceTokens = identityTokens(cuvee.name, context);
  const productTokens = identityTokens(product.name, context);
  if (!sourceTokens.length || sourceTokens.join('|') !== productTokens.join('|'))
    throw new Error(`${label}: cuvée/product identity terms disagree; manual review required`);
}

function placeContains(places, ancestorId, descendantId) {
  if (!ancestorId || !descendantId) return false;
  const byId = new Map(places.map(place => [place.id, place]));
  let current = byId.get(descendantId);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}

function candidateNames(rows, name, parentId = null) {
  const target = normalizeReferenceName(name);
  if (!target) return [];
  return rows.filter(row => (parentId === null || row.producer_id === parentId)
    && (row.normalized.includes(target) || target.includes(row.normalized)))
    .slice(0, 3).map(row => row.name);
}

export function classifyCalibration(profile, calibration, snapshot, overrides = {}, filename = '') {
  const cuvee = profile.cuvees.find(item => item.id === calibration.cuvee_id);
  if (!cuvee) throw new Error(`${filename}: unknown cuvée ${calibration.cuvee_id}`);
  const reasons = [];
  const selectedProducerName = overrides.producers?.[filename];
  const producer = selectedProducerName
    ? namedOverride(snapshot.producers, selectedProducerName, `${filename} producer`)
    : unique(matchingIdentity(snapshot.producers, snapshot.producer_aliases,
      profile.producer.name, null));
  if (!producer) reasons.push('producer_identity_unresolved');

  const productOverride = overrides.products?.[filename]?.[cuvee.id];
  const product = !producer ? null : productOverride
    ? namedOverride(snapshot.products.filter(row => row.producer_id === producer.id),
      productOverride, `${filename}/${cuvee.id} product`)
    : unique(matchingIdentity(snapshot.products, snapshot.product_aliases,
      cuvee.name, null, producer.id));
  if (productOverride && !producer)
    throw new Error(`${filename}/${cuvee.id}: product override requires a resolved producer`);
  if (productOverride) assertProductOverrideFits(cuvee, producer, product,
    `${filename}/${cuvee.id}`);
  if (!product) reasons.push('cuvee_identity_unresolved');

  const regionOverride = overrides.regions?.[cuvee.region];
  const region = regionOverride
    ? namedOverride(snapshot.places.filter(row => row.type === 'region'),
      regionOverride, `${filename}/${cuvee.id} region`)
    : unique(matchingIdentity(snapshot.places, snapshot.place_aliases,
      cuvee.region, 'region'))
      ?? unique(matchingIdentity(snapshot.places, snapshot.place_aliases,
        cuvee.region, 'subregion'));
  if (!region) reasons.push('region_identity_unresolved');
  const appellationOverride = overrides.appellations?.[cuvee.appellation];
  const appellation = appellationOverride
    ? namedOverride(snapshot.places.filter(row => row.type === 'appellation'),
      appellationOverride, `${filename}/${cuvee.id} appellation`)
    : unique(matchingIdentity(snapshot.places, snapshot.place_aliases,
      cuvee.appellation, 'appellation'));
  if (!appellation || !region || !placeContains(snapshot.places, region.id, appellation.id))
    reasons.push('appellation_identity_unresolved_or_outside_region');

  const releases = product ? snapshot.releases.filter(row =>
    row.product_id === product.id && row.vintage === calibration.vintage) : [];
  const release = unique(releases);
  if (!release) reasons.push(releases.length > 1
    ? 'release_identity_ambiguous' : 'release_identity_missing');

  const identityReady = Boolean(producer && product && release && region && appellation
    && placeContains(snapshot.places, region.id, appellation.id));
  const existing = identityReady ? snapshot.reference_rows.filter(row =>
    row.scope === 'release' && row.release_id === release.id
    && row.format_ml === calibration.format_ml && row.color === cuvee.color
    && row.region_id === region.id && row.appellation_id === appellation.id
    && row.version_status !== 'withdrawn') : [];
  const existingRow = unique(existing);
  const sameDates = existingRow &&
    existingRow.first_trial_year === calibration.proposal.first_trial_year &&
    existingRow.best_start_year === calibration.proposal.best_start_year &&
    existingRow.best_end_year === calibration.proposal.best_end_year;

  let status = 'quarantined';
  if (existing.length > 1) reasons.push('multiple_existing_reference_rows');
  if (existingRow && existingRow.current_approval && sameDates) {
    status = 'already_reviewed_in_existing_draft';
  } else {
    if (existingRow && !sameDates) reasons.push('conflicts_with_existing_draft');
    // The bundle explicitly marks every row unapproved and every source's
    // rights unreviewed. Canonical identity alone cannot release a window.
    reasons.push('three_dates_and_source_rights_not_reviewed');
  }
  return {
    status, reasons,
    identity_ready: identityReady,
    canonical_release_id: identityReady ? release.id : null,
    existing_reviewed_draft_version: status === 'already_reviewed_in_existing_draft'
      ? existingRow.version : null,
    suggestions: {
      producer: producer ? [] : candidateNames(snapshot.producers, profile.producer.name),
      cuvee: product || !producer ? [] : candidateNames(snapshot.products, cuvee.name, producer.id),
    },
  };
}

export function buildGate4CoverageManifest(files, snapshot, overrides = {}) {
  const names = Object.keys(files).sort();
  const rows = [];
  const profiles = [];
  for (const filename of names) {
    const raw = files[filename];
    const profile = JSON.parse(raw);
    const validation = validateProducerResearchPackage(profile);
    const start = rows.length;
    profile.exact_release_calibrations.forEach((calibration, index) => {
      const result = classifyCalibration(profile, calibration, snapshot, overrides, filename);
      rows.push({ file: filename, row: index + 1,
        cuvee_id: calibration.cuvee_id, vintage: calibration.vintage,
        format_ml: calibration.format_ml, ...result });
    });
    profiles.push({ file: filename, sha256: sha256(raw), producer: profile.producer.name,
      proposed_rows: validation.exact_calibration_count,
      identity_ready: rows.slice(start).filter(row => row.identity_ready).length,
      already_reviewed_in_existing_draft: rows.slice(start).filter(row =>
        row.status === 'already_reviewed_in_existing_draft').length,
      quarantined: rows.slice(start).filter(row => row.status === 'quarantined').length });
  }
  const reasonCounts = {};
  for (const row of rows) for (const reason of row.reasons)
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  return {
    format: 'cellarmanager.drinking_window_gate4_coverage', version: 1,
    source_directory_digest: sha256(profiles.map(p => `${p.file}:${p.sha256}`).join('\n')),
    canonical_snapshot_sha256: sha256(JSON.stringify(snapshot)),
    policy: 'No bundle proposal becomes publishable merely because it parses or has a canonical match.',
    summary: { files: names.length, proposed_rows: rows.length,
      identity_ready: rows.filter(row => row.identity_ready).length,
      already_reviewed_in_existing_draft: rows.filter(row =>
        row.status === 'already_reviewed_in_existing_draft').length,
      quarantined: rows.filter(row => row.status === 'quarantined').length,
      newly_approved_for_publication: 0, reasons: reasonCounts },
    profiles, rows,
  };
}

// Keep each auditable proposal on one diff line while leaving the summary
// and per-file totals human-readable. This is still ordinary JSON.
export function serializeCoverageManifest(manifest) {
  const head = JSON.stringify({ ...manifest, rows: [] }, null, 2);
  const suffix = '  "rows": []\n}';
  if (!head.endsWith(suffix)) throw new Error('Coverage JSON layout changed');
  return head.slice(0, -suffix.length) + '  "rows": [\n'
    + manifest.rows.map(row => `    ${JSON.stringify(row)}`).join(',\n')
    + '\n  ]\n}\n';
}

async function main(args) {
  if (args.length !== 4) throw new Error(
    'Usage: node gate4_coverage_manifest.mjs PROFILE_DIR CANONICAL_SNAPSHOT.json IDENTITY_OVERRIDES.json OUTPUT.json');
  const [directory, snapshotPath, overridePath, outputPath] = args;
  const names = (await readdir(directory)).filter(name =>
    name.startsWith('CellarManager_') && name.endsWith('.json')).sort();
  const files = Object.fromEntries(await Promise.all(names.map(async name =>
    [basename(name), await readFile(resolve(directory, name), 'utf8')])));
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const overrides = JSON.parse(await readFile(overridePath, 'utf8'));
  const result = buildGate4CoverageManifest(files, snapshot, overrides);
  if (result.summary.files !== 23 || result.summary.proposed_rows !== 670)
    throw new Error('Gate 4 requires the complete audited 23-file, 670-row bundle');
  await writeFile(outputPath, serializeCoverageManifest(result));
  process.stdout.write(JSON.stringify(result.summary, null, 2) + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
