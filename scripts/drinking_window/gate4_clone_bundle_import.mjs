import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProducerResearchPackage } from './producer_research_package.mjs';

// Generates a private SQL file for a *disposable local clone only*. The file
// contains the complete owner-supplied research documents; keep it outside Git.
export async function buildCloneBundleImport(directory) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  const statements = [];
  let proposals = 0;
  for (const name of names) {
    const raw = await readFile(resolve(directory, name), 'utf8');
    const document = JSON.parse(raw);
    const validation = validateProducerResearchPackage(document);
    proposals += validation.exact_calibration_count;
    const json = JSON.stringify(document);
    statements.push(`select public.import_drinking_window_profile_exchange('${json.replaceAll("'", "''")}'::jsonb) ->> 'id' as imported_profile_id;`);
  }
  if (names.length !== 46 || proposals !== 461) {
    throw new Error(`Expected the 46-file/461-row owner bundle, got ${names.length}/${proposals}`);
  }
  return [
    '-- PRIVATE OWNER DATA. Run only in a disposable local restored database.',
    'begin;',
    'set local standard_conforming_strings = on;',
    `select set_config('request.jwt.claim.sub', (
      select user_id::text from public.enrichment_curator_eligibilities
      where 'drinking-window' = any(profile_scopes) order by user_id limit 1
    ), true) is not null as curator_context_set;`,
    'set local role authenticated;',
    ...statements,
    'reset role;',
    `select count(*) as archived_profiles, coalesce(sum(jsonb_array_length(document -> 'exact_release_calibrations')),0) as archived_proposals
       from private.drinking_window_profile_exchanges;`,
    'commit;',
    '',
  ].join('\n');
}

async function main(args) {
  if (args.length !== 2) throw new Error(
    'Usage: node gate4_clone_bundle_import.mjs PRIVATE_46_JSON_DIRECTORY PRIVATE_OUTPUT.sql');
  const [directory, output] = args;
  await writeFile(output, await buildCloneBundleImport(directory), { mode: 0o600 });
  process.stdout.write('Prepared private 46-profile import SQL for a disposable local clone only.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
