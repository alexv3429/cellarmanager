// Read-only curation of workbook candidates against a snapshot of the shared
// reference catalogue. A name or alias match is a review suggestion, never a
// verified identity or a publishable drinking window.
import { sourceInterpretations } from './source_interpretations.mjs';

const normalize = (value) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

const unique = (items) => [...new Set(items)].sort();
const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

function possibleNameHints(rows, label) {
  const key = normalize(label);
  if (key.length < 4) return [];
  return unique(rows.filter((row) => (` ${normalize(row.canonical_name)} `).includes(` ${key} `))
    .map((row) => row.id));
}

function lookup(rows, aliases, label, type, predicate = () => true) {
  if (!normalize(label)) return { status: 'missing', ids: [] };
  const ids = new Set(rows.filter((row) => predicate(row) &&
    normalize(row.canonical_name) === normalize(label)).map((row) => row.id));
  for (const alias of aliases) {
    if (alias.entity_type === type && normalize(alias.alias_value) === normalize(label)) {
      const row = rows.find((item) => item.id === alias.entity_id);
      if (row && predicate(row)) ids.add(row.id);
    }
  }
  const found = unique([...ids]);
  return { status: found.length === 0 ? 'missing' : found.length === 1 ? 'suggested' : 'ambiguous', ids: found };
}

function placeLookup(places, aliases, label, types) {
  const eligible = places.filter((place) => types.includes(place.place_type));
  const matches = new Set(eligible.filter((place) => normalize(place.canonical_name) === normalize(label))
    .map((place) => place.id));
  for (const alias of aliases) {
    if (normalize(alias.alias_value) === normalize(label) && eligible.some((place) => place.id === alias.place_id)) {
      matches.add(alias.place_id);
    }
  }
  const ids = unique([...matches]);
  return { status: ids.length === 0 ? 'missing' : ids.length === 1 ? 'suggested' : 'ambiguous', ids };
}

function regionAncestor(placeId, placeIndex) {
  const visited = new Set();
  let current = placeIndex.get(placeId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.place_type === 'region') return current.id;
    current = current.parent_id ? placeIndex.get(current.parent_id) : null;
  }
  return null;
}

function producerMappingIndex(candidates, snapshot, manifest, kind) {
  if (manifest === undefined) return new Map();
  const label = kind === 'owner_confirmed' ? 'Producer confirmation' : 'Producer research';
  const noteKey = kind === 'owner_confirmed' ? 'owner_note' : 'research_note';
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.source_sha256) || !Array.isArray(manifest.mappings)) {
    throw new Error(`${label} needs a source SHA-256 and mappings array`);
  }
  if (candidates.some((candidate) => candidate.source_sha256 !== manifest.source_sha256)) {
    throw new Error(`${label} does not match the candidate workbook SHA-256`);
  }
  const index = new Map();
  for (const mapping of manifest.mappings) {
    const { source_sheet: sheet, workbook_producer: source, canonical_producer: target,
      evidence_urls: urls } = mapping;
    const note = mapping[noteKey];
    if (!sheet || !source || !target || !Array.isArray(urls) || urls.length === 0 ||
        urls.some((url) => typeof url !== 'string' || !url.startsWith('https://')) ||
        typeof note !== 'string' || !note.trim() || index.has(sheet)) {
      throw new Error(`${label} has an invalid or duplicate mapping`);
    }
    const sourceRows = candidates.filter((candidate) => candidate.review_status === 'staged' &&
      candidate.source_locator.startsWith(`${sheet}!`) && candidate.source_identity?.producer === source);
    if (sourceRows.length === 0) throw new Error(`${label} has no matching source rows: ${sheet}`);
    const targets = snapshot.producers.filter((producer) => normalize(producer.canonical_name) === normalize(target));
    if (targets.length !== 1) throw new Error(`${label} target is missing or ambiguous: ${target}`);
    index.set(sheet, { source, id: targets[0].id, evidence_urls: urls, [noteKey]: note });
  }
  return index;
}

export function reviewIdentities(candidates, snapshot, options = {}) {
  if (!Array.isArray(candidates)) throw new Error('Candidates must be an array');
  for (const table of ['producers', 'products', 'releases', 'places', 'place_aliases', 'wine_aliases']) {
    if (!Array.isArray(snapshot?.[table])) throw new Error(`Identity snapshot is missing ${table}`);
  }
  for (const table of ['producers', 'products', 'releases', 'places']) {
    const ids = snapshot[table].map((row) => row.id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      throw new Error(`Identity snapshot has missing or duplicate ${table} IDs`);
    }
  }
  const producerIndex = byId(snapshot.producers);
  const productIndex = byId(snapshot.products);
  const placeIndex = byId(snapshot.places);
  const researchIndex = producerMappingIndex(candidates, snapshot, options.producerResearch,
    'research_supported');
  const confirmationIndex = producerMappingIndex(candidates, snapshot, options.producerConfirmations,
    'owner_confirmed');
  if ([...confirmationIndex.keys()].some((sheet) => researchIndex.has(sheet))) {
    throw new Error('Producer research and owner confirmation overlap on one source sheet');
  }
  const interpretationIndex = sourceInterpretations(candidates, options.sourceInterpretations);
  for (const place of snapshot.places) {
    if (place.parent_id && !placeIndex.has(place.parent_id)) throw new Error('Place has no parent in snapshot');
  }
  for (const alias of snapshot.place_aliases) {
    if (!placeIndex.has(alias.place_id)) throw new Error('Place alias has no place in snapshot');
  }
  for (const alias of snapshot.wine_aliases) {
    if ((alias.entity_type === 'producer' && !producerIndex.has(alias.entity_id)) ||
        (alias.entity_type === 'product' && !productIndex.has(alias.entity_id))) {
      throw new Error('Wine alias has no entity in snapshot');
    }
  }
  const seen = new Set();
  const rows = candidates.map((candidate) => {
    if (!candidate.source_sha256 || !candidate.source_locator || !candidate.source_identity ||
        seen.has(`${candidate.source_sha256}:${candidate.source_locator}`)) {
      throw new Error('Candidate has an invalid or duplicate source locator');
    }
    seen.add(`${candidate.source_sha256}:${candidate.source_locator}`);
    const source = candidate.source_identity;
    const interpretation = interpretationIndex.rows.get(candidate.source_locator);
    const reviewIdentity = interpretation
      ? { ...source, ...interpretation.corrected } : source;
    const scopeInterpretation = interpretationIndex.scopes.get(
      `${candidate.source_locator.split('!')[0]}:${candidate.candidate_scope}`);
    const matches = {};
    const nameHints = {};
    const reasons = [];
    if (candidate.review_status !== 'staged') {
      reasons.push(candidate.review_reason ?? 'source_quarantine');
    } else if (candidate.candidate_scope === 'region') {
      matches.region = placeLookup(snapshot.places, snapshot.place_aliases, source.region, ['region']);
    } else if (['release', 'producer_appellation', 'producer_region'].includes(candidate.candidate_scope)) {
      matches.producer = lookup(snapshot.producers, snapshot.wine_aliases,
        reviewIdentity.producer, 'producer');
      const sheet = candidate.source_locator.split('!')[0];
      const mapping = confirmationIndex.get(sheet) ?? researchIndex.get(sheet);
      if (mapping) {
        if (source.producer !== mapping.source) throw new Error(`Producer mapping source mismatch: ${sheet}`);
        if (matches.producer.status !== 'missing' &&
            (matches.producer.status !== 'suggested' || matches.producer.ids[0] !== mapping.id)) {
          throw new Error(`Producer mapping conflicts with catalogue identity: ${sheet}`);
        }
        if (matches.producer.status === 'missing') {
          if (confirmationIndex.has(sheet)) {
            matches.producer = { status: 'owner_confirmed', ids: [mapping.id],
              evidence_urls: mapping.evidence_urls, owner_note: mapping.owner_note };
          } else {
            matches.producer = { status: 'research_supported', ids: [mapping.id],
              evidence_urls: mapping.evidence_urls, research_note: mapping.research_note };
            reasons.push('producer_confirmation_required');
          }
        }
      }
      if (matches.producer.status === 'missing') {
        nameHints.producer = possibleNameHints(snapshot.producers, source.producer);
      }
      if (candidate.candidate_scope !== 'producer_region') {
        matches.appellation = reviewIdentity.designation
          ? { status: 'not_applicable', ids: [] }
          : placeLookup(snapshot.places, snapshot.place_aliases,
            reviewIdentity.appellation, ['appellation']);
        if (reviewIdentity.designation) {
          // Vin de France is a national designation, not evidence that this
          // wine belongs to the workbook's former geographic appellation.
          matches.region = { status: 'missing', ids: [] };
          reasons.push('designation_model_review_required');
        } else if (matches.appellation.status === 'suggested') {
          const regionId = regionAncestor(matches.appellation.ids[0], placeIndex);
          matches.region = regionId
            ? { status: 'suggested_from_appellation', ids: [regionId] }
            : { status: 'missing', ids: [] };
        } else {
          matches.region = { status: 'blocked_by_appellation', ids: [] };
        }
        if (reviewIdentity.classification) {
          matches.classification = placeLookup(snapshot.places, snapshot.place_aliases,
            reviewIdentity.classification, ['classification']);
          if (matches.appellation.status === 'suggested' && matches.classification.status === 'suggested' &&
              placeIndex.get(matches.classification.ids[0]).parent_id !== matches.appellation.ids[0]) {
            matches.classification = { status: 'incompatible', ids: matches.classification.ids };
            reasons.push('classification_appellation_conflict');
          }
          reasons.push('classification_eligibility_required');
        }
      } else {
        // Producer-wide rows have no place on the source sheet. A producer's
        // products do not establish a single eligible region or colour.
        matches.region = { status: 'missing', ids: [] };
      }
      if (candidate.candidate_scope === 'release') {
        matches.product = ['suggested', 'research_supported', 'owner_confirmed'].includes(matches.producer.status)
          ? lookup(snapshot.products, snapshot.wine_aliases, reviewIdentity.cuvee, 'product',
            (product) => product.producer_id === matches.producer.ids[0])
          : { status: 'blocked_by_producer', ids: [] };
        const releaseIds = matches.product.status === 'suggested'
          ? snapshot.releases.filter((release) => release.product_id === matches.product.ids[0]
            && release.vintage_year === candidate.vintage_year).map((release) => release.id)
          : [];
        matches.release = matches.product.status !== 'suggested'
          ? { status: 'blocked_by_product', ids: [] }
          : { status: releaseIds.length === 0 ? 'missing'
            : releaseIds.length === 1 ? 'suggested' : 'ambiguous', ids: unique(releaseIds) };
      }
    } else {
      throw new Error(`Unsupported candidate scope: ${candidate.candidate_scope}`);
    }
    for (const [field, match] of Object.entries(matches)) {
      if (match.status === 'missing' || match.status === 'ambiguous') reasons.push(`${field}_${match.status}`);
    }
    if (candidate.review_status === 'staged') {
      reasons.push('identity_confirmation_required', 'source_rights_required', 'first_trial_year_required');
      if (candidate.candidate_scope !== 'release') reasons.push('ageing_group_eligibility_required');
      if (scopeInterpretation?.intent === 'grouped_cuvees') reasons.push('grouped_cuvee_membership_required');
      if (scopeInterpretation?.intent === 'producer_vintage_guidance') reasons.push('producer_wine_eligibility_required');
    }
    return {
      source_sha256: candidate.source_sha256,
      source_locator: candidate.source_locator,
      candidate_scope: candidate.candidate_scope,
      source_identity: source,
      ...(interpretation ? {
        review_identity: reviewIdentity,
        source_interpretation: { provenance: 'owner_confirmed', owner_note: interpretation.owner_note },
      } : {}),
      ...(scopeInterpretation ? { scope_interpretation: scopeInterpretation } : {}),
      wine_color: candidate.wine_color,
      vintage_year: candidate.vintage_year,
      first_trial_year: candidate.first_trial_year,
      best_start_year: candidate.best_start_year,
      best_end_year: candidate.best_end_year,
      matches,
      name_hints: nameHints,
      review_reasons: unique(reasons),
      publishable: false,
    };
  });
  const fullySuggested = (row) => Object.values(row.matches).length > 0 &&
    Object.values(row.matches).every((match) =>
      ['suggested', 'suggested_from_appellation', 'owner_confirmed'].includes(match.status));
  const summary = {
    candidate_count: rows.length,
    staged_count: candidates.filter((item) => item.review_status === 'staged').length,
    quarantine_count: candidates.filter((item) => item.review_status !== 'staged').length,
    scope_identity_suggestions: rows.filter((row) => row.review_reasons.includes('identity_confirmation_required')
      && fullySuggested(row)).length,
    scope_identity_suggestions_by_scope: Object.fromEntries(
      ['release', 'producer_appellation', 'producer_region', 'region'].map((scope) =>
        [scope, rows.filter((row) => row.candidate_scope === scope && fullySuggested(row)).length])),
    possible_producer_name_hints: rows.filter((row) => row.name_hints.producer?.length === 1).length,
    ambiguous_producer_name_hints: rows.filter((row) => row.name_hints.producer?.length > 1).length,
    research_supported_producer_candidates: rows.filter((row) =>
      row.matches.producer?.status === 'research_supported').length,
    owner_confirmed_producer_candidates: rows.filter((row) =>
      row.matches.producer?.status === 'owner_confirmed').length,
    owner_interpreted_rows: rows.filter((row) => row.source_interpretation).length,
    owner_interpreted_scope_rows: rows.filter((row) => row.scope_interpretation).length,
    publishable_count: 0,
    reason_counts: Object.fromEntries(unique(rows.flatMap((row) => row.review_reasons))
      .map((reason) => [reason, rows.filter((row) => row.review_reasons.includes(reason)).length])),
  };
  // Validate the relationships returned by a snapshot before it informs a
  // curator. Missing parent entities are not interpreted as permissive.
  for (const product of snapshot.products) {
    if (!producerIndex.has(product.producer_id)) throw new Error('Product has no producer in snapshot');
  }
  for (const release of snapshot.releases) {
    if (!productIndex.has(release.product_id)) throw new Error('Release has no product in snapshot');
  }
  return { rows, summary };
}
