const PRODUCER_SHEETS = [
  'Barraud', 'Barthod', 'Boillot', 'Bouzereau', 'Cal Demoura', 'Carillon',
  'Castagnier', 'Chagnoleau', 'Clavelier', 'Langoureau', 'Montcalmes', 'Pernot',
];

const normalize = (value) => String(value ?? '').trim();
const keyText = (value) => normalize(value).normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
const year = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1800 && number <= 2200 ? number : null;
};
const offset = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
};
const color = (value) => ({ blanc: 'white', rouge: 'red', rose: 'rose' })[keyText(value)] ?? null;

function candidate(sourceSha256, locator, scope, identity, vintage, wineColor, start, end, reason = null) {
  return {
    source_sha256: sourceSha256,
    source_locator: locator,
    candidate_scope: reason ? 'quarantine' : scope,
    source_identity: identity,
    wine_color: wineColor,
    vintage_year: vintage,
    first_trial_year: null,
    best_start_year: start,
    best_end_year: end,
    drink_by_year: null,
    review_status: reason ? 'needs-review' : 'staged',
    ...(reason ? { review_reason: reason } : {}),
  };
}

// Rows are plain { row, cells } records. The adapter reads only the reference
// sheets; Cave and all of its household data are deliberately excluded.
export function convertWorkbookRows({ producerSheets, regionalRows }, sourceSha256) {
  if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error('A SHA-256 source hash is required');
  const candidates = [];
  const counts = {
    release: 0, producer_appellation: 0, regional_standard: 0,
    regional_premium: 0, producer_only: 0, producer_partial: 0,
    regional_no_pair: 0, other_quarantine: 0,
  };

  for (const { name, rows } of producerSheets) {
    if (!PRODUCER_SHEETS.includes(name)) throw new Error(`Unexpected producer sheet: ${name}`);
    for (const { row, cells } of rows) {
      const [vintageRaw, cuveeRaw, appellationRaw, colorRaw, startRaw, endRaw] = cells;
      const hasStart = normalize(startRaw) !== '';
      const hasEnd = normalize(endRaw) !== '';
      if (!hasStart && !hasEnd) continue;
      const cuvee = normalize(cuveeRaw);
      const appellation = normalize(appellationRaw);
      const vintage = year(vintageRaw);
      const wineColor = color(colorRaw);
      const start = year(startRaw);
      const end = year(endRaw);
      const identity = {
        producer: name, cuvee, appellation, color: normalize(colorRaw),
        source_cells: {
          vintage: `${name}!A${row}`, cuvee: `${name}!B${row}`,
          appellation: `${name}!C${row}`, color: `${name}!D${row}`,
          best_start: `${name}!E${row}`, best_end: `${name}!F${row}`,
        },
      };
      let reason = null;
      if (!hasStart || !hasEnd) {
        reason = 'incomplete_pair'; counts.producer_partial++;
      } else if (!appellation) {
        reason = 'producer_only_scope_not_approved'; counts.producer_only++;
      } else if (vintage === null || wineColor === null || start === null || end === null ||
                 start > end || start < vintage) {
        reason = 'invalid_identity_or_years'; counts.other_quarantine++;
      } else if (cuvee) {
        counts.release++;
      } else {
        counts.producer_appellation++;
      }
      candidates.push(candidate(sourceSha256, `${name}!E${row}:F${row}`,
        cuvee ? 'release' : 'producer_appellation', identity, vintage, wineColor,
        start, end, reason));
    }
  }

  let currentRegion = '';
  let currentColor = '';
  let regionSourceCell = '';
  let colorSourceCell = '';
  for (const { row, cells } of regionalRows) {
    const [regionRaw, , colorRaw, vintageRaw, , , , , , , , basicStartRaw, basicEndRaw,
      premiumStartRaw, premiumEndRaw] = cells;
    if (normalize(regionRaw)) {
      currentRegion = normalize(regionRaw);
      regionSourceCell = `Millesimes!A${row}`;
    }
    if (normalize(colorRaw)) {
      currentColor = normalize(colorRaw);
      colorSourceCell = `Millesimes!C${row}`;
    }
    const vintage = year(vintageRaw);
    if (vintage === null) continue;
    const wineColor = color(currentColor);
    const pairs = [
      { bin: 'standard', start: basicStartRaw, end: basicEndRaw, columns: `L${row}:M${row}` },
      { bin: 'premium', start: premiumStartRaw, end: premiumEndRaw, columns: `N${row}:O${row}` },
    ];
    let anyPair = false;
    for (const pair of pairs) {
      const hasStart = normalize(pair.start) !== '';
      const hasEnd = normalize(pair.end) !== '';
      if (!hasStart && !hasEnd) continue;
      anyPair = true;
      const startOffset = offset(pair.start);
      const endOffset = offset(pair.end);
      const start = startOffset === null ? null : vintage + startOffset;
      const end = endOffset === null ? null : vintage + endOffset;
      const firstColumn = pair.bin === 'standard' ? 'L' : 'N';
      const lastColumn = pair.bin === 'standard' ? 'M' : 'O';
      const identity = {
        region: currentRegion, color: currentColor, historical_bin: pair.bin,
        source_cells: {
          region: regionSourceCell, color: colorSourceCell,
          vintage: `Millesimes!D${row}`,
          best_start_offset: `Millesimes!${firstColumn}${row}`,
          best_end_offset: `Millesimes!${lastColumn}${row}`,
        },
      };
      const reason = !currentRegion || wineColor === null || start === null || end === null ||
        start > end || end > 2200 ? 'invalid_region_or_offsets' : null;
      if (reason) counts.other_quarantine++;
      else counts[`regional_${pair.bin}`]++;
      candidates.push(candidate(sourceSha256, `Millesimes!${pair.columns}`, 'region',
        identity, vintage, wineColor, start, end, reason));
    }
    if (!anyPair) {
      counts.regional_no_pair++;
      candidates.push(candidate(sourceSha256, `Millesimes!L${row}:O${row}`, 'region',
        { region: currentRegion, color: currentColor,
          source_cells: { region: regionSourceCell, color: colorSourceCell,
            vintage: `Millesimes!D${row}`, offsets: `Millesimes!L${row}:O${row}` } },
        vintage, wineColor, null, null,
        'no_pair'));
    }
  }

  candidates.sort((a, b) => a.source_locator.localeCompare(b.source_locator, 'en'));
  const locators = new Set();
  for (const item of candidates) {
    if (locators.has(item.source_locator)) throw new Error(`Duplicate source locator: ${item.source_locator}`);
    locators.add(item.source_locator);
  }
  const keyed = new Map();
  for (const item of candidates.filter((entry) => entry.review_status === 'staged')) {
    const id = item.source_identity;
    const key = [item.candidate_scope, keyText(id.producer), keyText(id.cuvee),
      keyText(id.appellation), keyText(id.region), item.wine_color,
      item.vintage_year, id.historical_bin ?? ''].join('|');
    keyed.set(key, [...(keyed.get(key) ?? []), item.source_locator]);
  }
  const overlaps = [...keyed.values()].filter((locators) => locators.length > 1);
  const unresolvedMappings = candidates.filter((item) => item.review_status === 'staged').map((item) => ({
    source_locator: item.source_locator,
    needs: item.candidate_scope === 'region'
      ? ['canonical_region', 'ageing_group_membership', 'source_rights', 'first_trial_year', 'drink_by_year']
      : ['canonical_producer', ...(item.candidate_scope === 'release' ? ['canonical_cuvee'] : []),
        'canonical_appellation', 'canonical_region', 'source_rights', 'first_trial_year', 'drink_by_year'],
  }));
  return {
    candidates,
    report: {
      source_sha256: sourceSha256,
      counts,
      staged_count: candidates.filter((item) => item.review_status === 'staged').length,
      quarantine_count: candidates.filter((item) => item.review_status === 'needs-review').length,
      publishable_four_milestone_count: 0,
      unresolved_mappings: unresolvedMappings,
      overlaps,
      quarantine: candidates.filter((item) => item.review_status === 'needs-review')
        .map(({ source_locator, review_reason }) => ({ source_locator, reason: review_reason })),
    },
  };
}

export function readReferenceRows(workbook) {
  const expected = [...PRODUCER_SHEETS, 'Millesimes'];
  for (const name of expected) if (!workbook.getWorksheet(name)) throw new Error(`Missing worksheet: ${name}`);
  const readRows = (sheet, first, lastColumn) => {
    const rows = [];
    for (let number = first; number <= sheet.rowCount; number++) {
      const cells = Array.from({ length: lastColumn }, (_, index) => sheet.getRow(number).getCell(index + 1).value);
      if (cells.some((value) => normalize(value) !== '')) rows.push({ row: number, cells });
    }
    return rows;
  };
  return {
    producerSheets: PRODUCER_SHEETS.map((name) => ({ name, rows: readRows(workbook.getWorksheet(name), 2, 6) })),
    regionalRows: readRows(workbook.getWorksheet('Millesimes'), 3, 15),
  };
}
