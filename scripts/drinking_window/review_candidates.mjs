import { readFile, realpath, access, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewIdentities } from './review_identities.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--candidates', '--identity-snapshot', '--out-dir', '--producer-research'].includes(argv[index]) || !argv[index + 1]) {
      throw new Error('Usage: review_candidates.mjs --candidates PRIVATE_JSON --identity-snapshot PRIVATE_JSON --out-dir EXISTING_PRIVATE_DIRECTORY [--producer-research JSON]');
    }
    options[argv[index]] = argv[index + 1];
  }
  if (!options['--candidates'] || !options['--identity-snapshot'] || !options['--out-dir']) {
    throw new Error('Candidates, identity snapshot, and output directory are required');
  }
  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const outDir = await realpath(options['--out-dir']);
  const inRepo = relative(repoRoot, outDir);
  if (inRepo === '' || (!inRepo.startsWith('..') && !isAbsolute(inRepo))) {
    throw new Error('Private review output must be outside the repository');
  }
  const candidates = JSON.parse(await readFile(await realpath(options['--candidates']), 'utf8'));
  const snapshotInput = JSON.parse(await readFile(await realpath(options['--identity-snapshot']), 'utf8'));
  const snapshot = snapshotInput.rows?.[0]?.snapshot ?? snapshotInput.snapshot ?? snapshotInput;
  const producerResearch = options['--producer-research']
    ? JSON.parse(await readFile(await realpath(options['--producer-research']), 'utf8')) : undefined;
  const { rows, summary } = reviewIdentities(candidates, snapshot, { producerResearch });
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
