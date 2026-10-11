import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, realpath, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewIdentities } from './review_identities.mjs';

const execFileAsync = promisify(execFile);

function parseEnvelope(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('Database query returned no JSON');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < stdout.length; index++) {
    const char = stdout[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(stdout.slice(start, index + 1));
  }
  throw new Error('Database query returned incomplete JSON');
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--project-ref' || args[2] !== '--out-dir' ||
      !/^[a-z0-9]{20}$/.test(args[1])) {
    throw new Error('Usage: capture_identity_snapshot.mjs --project-ref LINKED_PROJECT_REF --out-dir EXISTING_PRIVATE_DIRECTORY');
  }
  const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const outDir = await realpath(args[3]);
  const inRepo = relative(repoRoot, outDir);
  if (inRepo === '' || (!inRepo.startsWith('..') && !isAbsolute(inRepo))) {
    throw new Error('Private identity snapshot must be outside the repository');
  }
  const output = resolve(outDir, 'identity_snapshot.json');
  try {
    await access(output);
    throw new Error(`Refusing to overwrite identity snapshot: ${output}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { stdout } = await execFileAsync('npm', ['run', 'supabase', '--', 'db', 'query',
    '--linked', '--project-ref', args[1], '--output-format', 'json', '--file',
    resolve(repoRoot, 'scripts/drinking_window/identity_snapshot.sql')],
  { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 });
  const envelope = parseEnvelope(stdout);
  const snapshot = envelope.rows?.[0]?.snapshot;
  if (!snapshot) throw new Error('Database query returned no identity snapshot');
  reviewIdentities([], snapshot);
  await writeFile(output, `${JSON.stringify({ ...snapshot, project_ref: args[1] }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ generated_at: snapshot.generated_at,
    producers: snapshot.producers.length, products: snapshot.products.length,
    releases: snapshot.releases.length, places: snapshot.places.length,
    output_directory: outDir }, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
