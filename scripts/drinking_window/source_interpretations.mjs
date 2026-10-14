// Owner-confirmed interpretations of this workbook snapshot. These are
// read-only review annotations, not changes to the source or shared catalogue.
const supportedIntents = new Set(['grouped_cuvees', 'producer_vintage_guidance']);

export function sourceInterpretations(candidates, manifest) {
  if (manifest === undefined) return { rows: new Map(), scopes: new Map() };
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.source_sha256) ||
      !Array.isArray(manifest.row_interpretations) || !Array.isArray(manifest.scope_interpretations)) {
    throw new Error('Source interpretations need a SHA-256 and row/scope arrays');
  }
  if (candidates.some((candidate) => candidate.source_sha256 !== manifest.source_sha256)) {
    throw new Error('Source interpretations do not match the candidate workbook SHA-256');
  }
  const byLocator = new Map(candidates.map((candidate) => [candidate.source_locator, candidate]));
  const rows = new Map();
  for (const entry of manifest.row_interpretations) {
    const { source_locator: locator, expected, corrected, owner_note: note } = entry;
    const candidate = byLocator.get(locator);
    if (!candidate || candidate.review_status !== 'staged' || rows.has(locator) ||
        !expected || !corrected || typeof note !== 'string' || !note.trim() ||
        candidate.vintage_year !== expected.vintage_year ||
        ['producer', 'cuvee', 'appellation', 'color'].some((field) =>
          candidate.source_identity[field] !== expected[field])) {
      throw new Error(`Source interpretation is stale or invalid: ${locator}`);
    }
    const hasClassification = Object.hasOwn(corrected, 'classification');
    const hasDesignation = Object.hasOwn(corrected, 'designation');
    if (!Object.hasOwn(corrected, 'appellation') ||
        Object.keys(corrected).some((field) => !['appellation', 'classification', 'designation'].includes(field)) ||
        (corrected.appellation !== null &&
          (typeof corrected.appellation !== 'string' || !corrected.appellation.trim())) ||
        (hasClassification &&
          (typeof corrected.classification !== 'string' || !corrected.classification.trim())) ||
        (hasDesignation &&
          (typeof corrected.designation !== 'string' || !corrected.designation.trim())) ||
        hasClassification === hasDesignation ||
        (hasDesignation && corrected.appellation !== null) ||
        (hasClassification && corrected.appellation === null)) {
      throw new Error(`Source interpretation has incompatible place fields: ${locator}`);
    }
    rows.set(locator, { corrected, owner_note: note });
  }
  const scopes = new Map();
  for (const entry of manifest.scope_interpretations) {
    const { source_sheet: sheet, candidate_scope: scope, expected_count: count,
      intent, owner_note: note } = entry;
    const key = `${sheet}:${scope}`;
    const matching = candidates.filter((candidate) => candidate.review_status === 'staged' &&
      candidate.source_locator.startsWith(`${sheet}!`) && candidate.candidate_scope === scope);
    if (typeof sheet !== 'string' || !sheet || typeof scope !== 'string' || !scope ||
        !Number.isInteger(count) || count <= 0 || matching.length !== count ||
        !supportedIntents.has(intent) || typeof note !== 'string' || !note.trim() || scopes.has(key) ||
        (intent === 'grouped_cuvees' && scope !== 'producer_appellation') ||
        (intent === 'producer_vintage_guidance' && scope !== 'producer_region')) {
      throw new Error(`Source scope interpretation is stale or invalid: ${key}`);
    }
    scopes.set(key, { intent, owner_note: note });
  }
  return { rows, scopes };
}
