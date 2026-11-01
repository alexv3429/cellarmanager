import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { normalizeReferenceName } from './gate4_coverage_manifest.mjs';

const colorNames = new Map([
  ['red', 'red'], ['rouge', 'red'],
  ['white', 'white'], ['blanc', 'white'],
  ['rose', 'rose'], ['rose wine', 'rose'],
]);
const normalizedColor = value => colorNames.get(normalizeReferenceName(value))
  ?? normalizeReferenceName(value);

function count(items) {
  return { wines: items.length, bottles: items.reduce((sum, item) =>
    sum + Number(item.bottles ?? 0), 0) };
}

// This is a cellar-impact TRIAGE, not an identity linker or an approval.
// The producer map is supplied privately and is never a shared alias table.
export function measureProfileImpact(profiles, producerMap, wines) {
  const byLabel = new Map();
  for (const [filename, labels] of Object.entries(producerMap)) {
    if (!profiles[filename] || !Array.isArray(labels) || !labels.length)
      throw new Error(`Unknown profile or empty producer labels: ${filename}`);
    for (const label of labels) {
      const key = normalizeReferenceName(label);
      if (!key || (byLabel.has(key) && byLabel.get(key) !== filename))
        throw new Error(`Ambiguous or empty cellar producer label: ${label}`);
      byLabel.set(key, filename);
    }
  }

  const profileWines = Object.fromEntries(Object.keys(profiles).map(name => [name, []]));
  const others = [];
  for (const wine of wines) {
    const filename = byLabel.get(normalizeReferenceName(wine.producer));
    if (filename) profileWines[filename].push(wine);
    else others.push(wine);
  }

  const rows = [];
  const exactReleaseWines = [];
  const exactCuveeWines = [];
  for (const [filename, profile] of Object.entries(profiles)) {
    const sourceWines = profileWines[filename];
    const cuveeWines = [];
    const releaseWines = [];
    const hitRows = new Set();
    let ambiguousCuvee = 0;
    let colorMismatch = 0;
    let noVintage = 0;
    for (const wine of sourceWines) {
      const cuveeKey = normalizeReferenceName(wine.cuvee);
      const cuvees = profile.cuvees.filter(cuvee =>
        [cuvee.name, ...(cuvee.aliases ?? [])].some(name =>
          normalizeReferenceName(name) === cuveeKey));
      if (cuvees.length > 1) { ambiguousCuvee++; continue; }
      if (cuvees.length !== 1) continue;
      const cuvee = cuvees[0];
      if (normalizedColor(cuvee.color) !== normalizedColor(wine.color)) {
        colorMismatch++;
        continue;
      }
      cuveeWines.push(wine);
      exactCuveeWines.push(wine);
      if (wine.vintage == null) { noVintage++; continue; }
      const matchingRows = profile.exact_release_calibrations
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.cuvee_id === cuvee.id
          && row.vintage === wine.vintage
          && row.format_ml === wine.format_ml);
      if (matchingRows.length !== 1) continue;
      releaseWines.push(wine);
      exactReleaseWines.push(wine);
      hitRows.add(matchingRows[0].index + 1);
    }
    rows.push({ file: filename, producer: profile.producer.name,
      candidate_producer: count(sourceWines), exact_cuvee_label: count(cuveeWines),
      exact_cuvee_vintage_format: count(releaseWines),
      unique_profile_rows_hit: hitRows.size,
      ambiguous_cuvee_labels: ambiguousCuvee,
      color_mismatches: colorMismatch, missing_vintage_after_cuvee_match: noVintage });
  }
  rows.sort((a, b) => b.candidate_producer.bottles - a.candidate_producer.bottles);
  return {
    policy: 'Candidate overlap only; no canonical identity, source rights, dates or publication approved.',
    total: count(wines), profiles: Object.keys(profiles).length,
    candidate_producer: count(wines.filter(wine =>
      byLabel.has(normalizeReferenceName(wine.producer)))),
    exact_cuvee_label: count(exactCuveeWines),
    exact_cuvee_vintage_format: count(exactReleaseWines),
    other_producer: count(others), rows,
  };
}

async function main(args) {
  if (args.length !== 2) throw new Error(
    'Usage: docker ... psql -Atc "select json_build_object(...)" | node gate4_profile_impact.mjs PROFILE_DIR PRIVATE_PRODUCER_MAP.json');
  const [directory, mapPath] = args;
  const names = (await readdir(directory)).filter(name =>
    name.startsWith('CellarManager_') && name.endsWith('.json')).sort();
  const profiles = Object.fromEntries(await Promise.all(names.map(async name =>
    [basename(name), JSON.parse(await readFile(resolve(directory, name), 'utf8'))])));
  const producerMap = JSON.parse(await readFile(mapPath, 'utf8'));
  const wines = [];
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim()) wines.push(JSON.parse(line));
  }
  process.stdout.write(`${JSON.stringify(measureProfileImpact(profiles, producerMap, wines), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
