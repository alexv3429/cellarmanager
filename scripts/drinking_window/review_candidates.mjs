import { readFile, realpath, access, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewIdentities } from './review_identities.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--candidates', '--identity-snapshot', '--out-dir', '--producer-research',
      '--producer-confirmations', '--source-interpretations'].includes(argv[index]) || !argv[index + 1]) {
      throw new Error('Usage: review_candidates.mjs --candidates PRIVATE_JSON --identity-snapshot PRIVATE_JSON --out-dir EXISTING_PRIVATE_DIRECTORY [--producer-research JSON] [--producer-confirmations JSON] [--source-interpretations JSON]');
    }
    options[argv[index]] = argv[index + 1];
  }
  if (!options['--candidates'] || !options['--identity-snapshot'] || !options['--out-dir']) {
    throw new Error('Candidates, identity snapshot, and output directory are required');
  }
  return options;
}

function requirePrivatePath(repoRoot, path, label) {
  const inRepo = relative(repoRoot, path);
  if (inRepo === '' || (!inRepo.startsWith('..') && !isAbsolute(inRepo))) {
    throw new Error(`${label} must be kept outside the repository`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const outDir = await realpath(options['--out-dir']);
  requirePrivatePath(repoRoot, outDir, 'Private review output');
  const candidatesPath = await realpath(options['--candidates']);
  const snapshotPath = await realpath(options['--identity-snapshot']);
  requirePrivatePath(repoRoot, candidatesPath, 'Candidate input');
  requirePrivatePath(repoRoot, snapshotPath, 'Catalogue snapshot');
  const candidates = JSON.parse(await readFile(candidatesPath, 'utf8'));
  const snapshotInput = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const snapshot = snapshotInput.rows?.[0]?.snapshot ?? snapshotInput.snapshot ?? snapshotInput;
  async function privateJson(option, label) {
    if (!options[option]) return undefined;
    const path = await realpath(options[option]);
    requirePrivatePath(repoRoot, path, label);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const producerResearch = await privateJson('--producer-research', 'Producer research');
  const producerConfirmations = await privateJson('--producer-confirmations', 'Owner confirmations');
  const sourceInterpretations = await privateJson('--source-interpretations', 'Source interpretations');
  const { rows, summary } = reviewIdentities(candidates, snapshot,
    { producerResearch, producerConfirmations, sourceInterpretations });
  const outputPaths = ['identity_review.json', 'identity_summary.json'].map((name) => resolve(outDir, name));
  for (const path of outputPaths) {
    try {
      await access(path);
      throw new Error(`Refusing to overwrite existing review output: ${path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await writeFile(outputPaths[0], `${JSON.stringify(rows, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(outputPaths[1], `${JSON.stringify({
    ...summary,
    catalogue_snapshot_at: snapshot.generated_at ?? null,
    source_sha256: [...new Set(candidates.map((row) => row.source_sha256))],
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
