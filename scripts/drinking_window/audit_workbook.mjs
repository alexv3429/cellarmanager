import { createHash } from 'node:crypto';
import { readFile, realpath, access, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from '@excel.js/exceljs';
import { convertWorkbookRows, readReferenceRows } from './workbook_candidates.mjs';

function args(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--file', '--out-dir', '--expected-sha256'].includes(argv[i]) || !argv[i + 1]) {
      throw new Error('Usage: audit_workbook.mjs --file SOURCE.xlsx --out-dir EXISTING_PRIVATE_DIRECTORY --expected-sha256 HASH');
    }
    parsed[argv[i]] = argv[i + 1];
  }
  if (!parsed['--file'] || !parsed['--out-dir'] || !parsed['--expected-sha256']) {
    throw new Error('File, output directory, and expected SHA-256 are required');
  }
  return parsed;
}

async function run() {
  const options = args(process.argv.slice(2));
  const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const outDir = await realpath(options['--out-dir']);
  const inRepo = relative(repoRoot, outDir);
  if (inRepo === '' || (!inRepo.startsWith('..') && !isAbsolute(inRepo))) {
    throw new Error('Private audit output must be outside the repository');
  }
  const source = await realpath(options['--file']);
  const bytes = await readFile(source);
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  if (sourceSha256 !== options['--expected-sha256']) {
    throw new Error(`Workbook hash differs from expected SHA-256 (${sourceSha256})`);
  }
  const outputPaths = ['candidates.json', 'report.json'].map((name) => resolve(outDir, name));
  for (const path of outputPaths) {
    try {
      await access(path);
      throw new Error(`Refusing to overwrite existing audit output: ${path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(source);
  const { candidates, report } = convertWorkbookRows(readReferenceRows(workbook), sourceSha256);
  await writeFile(outputPaths[0], `${JSON.stringify(candidates, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(outputPaths[1], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    source_sha256: sourceSha256,
    counts: report.counts,
    staged_count: report.staged_count,
    quarantine_count: report.quarantine_count,
    publishable_four_milestone_count: report.publishable_four_milestone_count,
    overlap_count: report.overlaps.length,
    output_directory: outDir,
  }, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
